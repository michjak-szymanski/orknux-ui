import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';

import { fetchMemoryBudget, updateAgent } from '../api/agents';
import type { Agent, SessionMemoryBudget } from '../api/agents';
import { fetchMemoryCatalogs } from '../api/memory';
import type { MemoryCatalog } from '../api/memory';
import { answers, fetchModels } from '../api/models';
import type { Model } from '../api/models';
import { fetchSkillCatalogs } from '../api/skills';
import type { SkillCatalog } from '../api/skills';
import { fetchWorkspaceTools } from '../api/tools';
import type { Tool } from '../api/tools';
import chevronDownIcon from '../assets/chevron-down.svg';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import xCircleIcon from '../assets/x-circle.svg';
import { CatalogueNote, useCatalogue } from './Catalogue';
import type { Catalogue } from './Catalogue';
import { FieldHint } from './FieldHint';
import { IconField } from './IconField';
import { segments } from './searchMatches';
import own from './AgentForm.module.css';

/**
 * The class names the form paints itself with.
 *
 * Handed in rather than imported, for the reason `TriggerForm` asks for the
 * same: this form is shown on two surfaces that are not alike - a card on the
 * agent's own settings page, and a panel down the left of the workflow editor -
 * and the fields are identical in both, so there is one form and the look
 * belongs to whichever frame is holding it.
 */
export interface AgentFormStyles {
  /** The form itself: a settings card, or a panel's body. */
  body: string;
  fields: string;
  field: string;
  label: string;
  input: string;
  select: string;
  inputWrapper: string;
  inputWrapperTall: string;
  textarea: string;
  /*
   * There is no `fieldHint` here any more, and its absence is the point.
   *
   * It named the class the two printed paragraphs were drawn in - the argument
   * beside it was that the consequence of ticking a box must not be hidden
   * behind a hover. Issue #173 settled that the other way, and
   * UI-DESIGN-RULES.md now says so in as many words: a consequence worth
   * knowing before granting a permission belongs in the (?) beside that
   * permission. Taking the slot away leaves the next person nothing to print a
   * paragraph with.
   */
  error: string;
  actions: string;
  ghost: string;
  filled: string;
  /** Where a frame wants "Saved." said in the actions row rather than by itself. */
  savedNote?: string;
}

export interface AgentFormProps {
  workspaceId: string;
  /** The agent being edited. Making one is a name and a description, elsewhere. */
  agent: Agent;
  styles: AgentFormStyles;
  /** A heading inside the card, where the frame has no other place for one. */
  heading?: ReactNode;
  onSaved: (agent: Agent) => void;
  /** Left out where the frame already offers a way back, as a page's breadcrumb does. */
  onCancel?: () => void;
}

/** The whole of a workspace's tools fits in the list. */
const TOOL_PAGE_SIZE = 100;

/**
 * How many rows a group must hold before it grows a search box.
 *
 * A workspace with four tools should not be handed a control for finding one
 * of four, and the box is not free: it costs a row of the height this change
 * is about. Eight is roughly what the scroll box shows without scrolling, so
 * the search arrives at the point the list stops being readable whole.
 */
const SEARCH_FROM = 8;

/**
 * The widest share the slider offers.
 *
 * The server's own ceiling, and it is the server that enforces it: a share past
 * this comes back refused, in a sentence saying why. This is the track's end,
 * not a second copy of the rule - nothing here decides what may be saved.
 */
const MAX_SHARE = 50;

/**
 * Where the track reads "Default" - the position that means nothing is set.
 *
 * Zero rather than a checkbox beside the slider, because the two states are one
 * question: an agent either has a share of its own or takes whatever it is
 * given, and dragging off the end of the track into "no share" is that question
 * asked once. It is also the only honest resting place for a slider with
 * nothing set - any other position would be a percentage nobody chose.
 *
 * What being given means changed under it: an agent at Default now follows its
 * workspace's default where there is one, and only falls to the built-in
 * allowance where there is not. The position did not move; the figures under it
 * say which of the two it landed on.
 */
const DEFAULT_SHARE = 0;

/**
 * How long the slider must be still before its preview is asked for.
 *
 * A range input fires on every step of a drag, and each one of these is a round
 * trip. Long enough that dragging across the track is one request and not
 * fifty; short enough that letting go shows the figures immediately.
 */
const PREVIEW_PAUSE = 150;

/** Grouped the way the server groups them in its own sentences. */
function thousands(count: number): string {
  return count.toLocaleString('en-US');
}

interface GrantListProps<Item> {
  /** The heading, spelled as the panel spells it: `Tools`, `Skill Catalogs`. */
  label: string;
  /**
   * The same thing mid-sentence - `tools`, `skill catalogs`. It is what the
   * search box is called, and a screen reader reads it as *Search tools*.
   */
  what: string;
  /** The frame's class names; this group is one of its fields. */
  styles: AgentFormStyles;
  /** Everything the workspace has of this kind, and whether it could be read. */
  catalogue: Catalogue<Item>;
  /** What to say when the workspace really has none - not when a search found none. */
  empty: string;
  keyOf: (item: Item) => string;
  /** The name the grant is stored under, which is also the name searched. */
  nameOf: (item: Item) => string;
  /** The muted word at the end of a row: how much it holds, or `off`. */
  metaOf?: (item: Item) => ReactNode;
  /** The names granted now. */
  granted: string[];
  onChange: (granted: string[]) => void;
}

/**
 * One kind of grant: everything the workspace offers of it, and which of them
 * this agent has.
 *
 * The three grant groups on this form - memory catalogs, skill catalogs, tools -
 * were the same twenty-five lines three times over, and so were three copies of
 * what issue #172 was filed about: every row drawn at full height with no bound,
 * and no way to find one but to scroll and read. One component with three call
 * sites, so the next thing that is wrong with a grant list is wrong in one place.
 *
 * Two rules it keeps that a plain filter would not.
 *
 * **A granted row is always drawn.** Rows are filtered by what somebody typed,
 * except that a ticked one survives whatever they typed. A search that can hide
 * a grant is how the same tool gets granted twice and how one fails to be
 * revoked: the box is unticked because the row is not there, not because the
 * grant is not there, and nothing on the screen tells those apart.
 *
 * Kept *in place*, rather than pinned above the results, which was the other way
 * to keep them visible. Pinning reorders the list on the press: a row that jumps
 * to the top the moment it is ticked moves out from under the pointer that
 * ticked it, and the next click - landing on whatever slid into that spot -
 * grants something nobody chose. That is the same double-grant hazard read from
 * the other end. Here nothing ever moves; rows appear and disappear, and the
 * ones that cannot disappear are the ones that matter.
 *
 * **A row kept against the search says so.** It is drawn dashed, so a list
 * answering `slack` with four rows of which one matched does not read as a
 * filter that is broken.
 */
function GrantList<Item>({
  label,
  what,
  styles,
  catalogue,
  empty,
  keyOf,
  nameOf,
  metaOf,
  granted,
  onChange,
}: GrantListProps<Item>) {
  const [search, setSearch] = useState('');
  const items = catalogue.items;
  const needle = search.trim().toLowerCase();

  /*
   * Worked out on the way past rather than memoised. This is one `includes` per
   * row over a list the server caps at a hundred, which is nothing beside the
   * render it is part of - and a memo here would want the caller's `nameOf`
   * closure in its dependencies, a new function on every render, so it would
   * miss every time and cost the comparison as well.
   */
  const rows = items.map((item) => {
    const name = nameOf(item);
    return {
      item,
      name,
      ticked: granted.includes(name),
      matches: needle === '' || name.toLowerCase().includes(needle),
    };
  });

  const shown = rows.filter((row) => row.matches || row.ticked);
  const matching = rows.filter((row) => row.matches).length;
  const here = rows.filter((row) => row.ticked).length;

  return (
    <div className={styles.field} data-grants={what}>
      <span className={own.grantHead}>
        <span className={styles.label}>{label}</span>
        {/*
          Printed rather than put behind a (?), and that is the rule rather than
          an exception to it: this is the state of the thing being looked at, not
          an explanation of it - see UI-DESIGN-RULES.md. It is also the question
          somebody opening this panel came to ask.
        */}
        {items.length > 0 && (
          <span className={own.grantCount} data-grant-count="">
            {here} of {items.length} granted
            {needle !== '' && ` · ${matching} matching`}
          </span>
        )}
      </span>

      {/*
        Above the box rather than inside it: a list that could not be fetched
        must not be able to scroll the reason out of sight.
      */}
      <CatalogueNote catalogue={catalogue} className={own.emptyNote} empty={empty} />

      {items.length >= SEARCH_FROM && (
        <input
          className={own.grantSearch}
          type="search"
          value={search}
          spellCheck={false}
          placeholder={`Search ${what}…`}
          aria-label={`Search ${what}`}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}

      {items.length > 0 && (
        <div className={own.checkList} data-grant-rows="">
          {shown.map((row) => {
            const meta = metaOf?.(row.item);
            return (
              <label
                key={keyOf(row.item)}
                className={row.matches ? own.checkRow : `${own.checkRow} ${own.checkRowKept}`}
                data-grant-name={row.name}
                /*
                  What a check finds a kept row by. CSS modules hash the class
                  names this project writes, so the class cannot be asked for
                  from outside the bundle; `searchMatches` marks its hits with an
                  attribute for the same reason.
                */
                data-kept={row.matches ? undefined : ''}
              >
                <input
                  type="checkbox"
                  checked={row.ticked}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...granted, row.name]
                        : granted.filter((one) => one !== row.name),
                    )
                  }
                />
                {/*
                  The typed part picked out, by the matcher the manual's search
                  already uses - so the two cannot disagree about what matched.
                */}
                <span className={own.grantName}>
                  {segments(row.name, search).map((part, index) =>
                    part.match ? (
                      <mark key={index} className={own.grantMark}>
                        {part.text}
                      </mark>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </span>
                {meta !== undefined && meta !== null && meta !== false && (
                  <span className={own.checkCount}>{meta}</span>
                )}
              </label>
            );
          })}
          {shown.length === 0 && <p className={own.emptyNote}>Nothing by that name.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Everything an agent is: what it is called, what it is briefed with, the model
 * it answers on, and each grant of what it may read, run and reach.
 *
 * Nothing here resets. The state is read from `agent` as it mounts, and the
 * frames mount it fresh - the page keys it by which agent it is showing, the
 * panel renders it only while open - so following one agent to another starts
 * the form over instead of leaving the previous one's values in it.
 */
export function AgentForm({ workspaceId, agent, styles, heading, onSaved, onCancel }: AgentFormProps) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt ?? '');
  const [mcpServers, setMcpServers] = useState<string[]>(agent.mcpServers);
  /** Whether it may ask orknux about orknux; the built-in server. */
  const [orknuxAccess, setOrknuxAccess] = useState(agent.orknuxAccess);
  const [shellAccess, setShellAccess] = useState(agent.shellAccess);
  const [modelId, setModelId] = useState(agent.modelId ?? '');
  const [memoryCatalogs, setMemoryCatalogs] = useState<string[]>(agent.memoryCatalogs);
  const [skillCatalogs, setSkillCatalogs] = useState<string[]>(agent.skillCatalogs);
  const [tools, setTools] = useState<string[]>(agent.tools);
  const [icon, setIcon] = useState<string | null>(agent.icon ?? null);
  /**
   * The share of the model's window a session may take back, or null to follow
   * the workspace's default - issue #226.
   */
  const [share, setShare] = useState<number | null>(agent.memoryShare);
  /** What that share works out to, as the server works it out. Null until asked. */
  const [budget, setBudget] = useState<SessionMemoryBudget | null>(null);

  const [promptOpen, setPromptOpen] = useState(true);
  const [addingServer, setAddingServer] = useState(false);
  const [newServer, setNewServer] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const newServerRef = useRef<HTMLInputElement>(null);

  /*
   * What this workspace can offer the agent: its models, and its catalogs.
   *
   * Four lists, four grants, and each one used to end `.catch(() => setX([]))` -
   * so a server that had stopped answering drew four boxes saying this
   * workspace has nothing to grant, which is the one thing they could not
   * possibly know. They keep their failure now, and each box says which of the
   * two states it is in.
   */
  const noWorkspace = workspaceId === '';
  const modelCatalogue = useCatalogue('models in this workspace', () => fetchModels(workspaceId), [workspaceId], {
    skip: noWorkspace,
  });
  const memoryCatalogue = useCatalogue('memory catalogs', () => fetchMemoryCatalogs(workspaceId), [workspaceId], {
    skip: noWorkspace,
  });
  const skillCatalogue = useCatalogue('skill catalogs', () => fetchSkillCatalogs(workspaceId), [workspaceId], {
    skip: noWorkspace,
  });
  const toolCatalogue = useCatalogue<Tool>(
    'tools',
    async () => (await fetchWorkspaceTools(workspaceId, 0, TOOL_PAGE_SIZE)).content,
    [workspaceId],
    { skip: noWorkspace },
  );

  /*
   * Only the models are unpacked here. The three grant lists are handed the
   * catalogue itself rather than the rows out of it, because each of them draws
   * the failure and the empty state as well as the list, and those are three
   * fields on one value.
   */
  const models: Model[] = modelCatalogue.items;

  /**
   * Whether there is a window to take a share of at all.
   *
   * The model *in the form*, not the one on the agent: this form may have
   * changed it in the same edit, and a share previewed against the stored model
   * would answer for the model this agent used to have.
   */
  const chosenModel = modelId === '' ? null : modelId;

  /**
   * What is actually asked for and saved, which is null while no model is
   * chosen.
   *
   * The typed value is kept rather than cleared, so choosing a model again
   * brings the share back. What it must not do is stay in force: the server
   * refuses a share with no model to take it from - rightly, since a share of
   * nothing is nothing - and a slider disabled at 20% with a refusal under it
   * would be a form that cannot be saved and offers no way out of it.
   */
  const asked = chosenModel === null ? null : share;

  /*
   * What the share works out to, asked of the server and never worked out here.
   *
   * Debounced rather than sent on every step of the drag, and cancelled on the
   * way out so a slow answer to a share nobody is asking for any more cannot
   * land on top of a newer one.
   */
  useEffect(() => {
    if (noWorkspace) return;

    let current = true;
    const timer = setTimeout(() => {
      fetchMemoryBudget(workspaceId, chosenModel, asked)
        .then((found) => {
          if (current) setBudget(found);
        })
        .catch(() => {
          // The preview is not the setting. A failure here leaves the figures
          // off rather than putting a second error on a form that has its own.
          if (current) setBudget(null);
        });
    }, PREVIEW_PAUSE);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [workspaceId, noWorkspace, chosenModel, asked]);

  /**
   * Why this share cannot be saved, in the server's words, or null.
   *
   * Printed as it arrives and never reworded: it names the model and its
   * numbers, and it is the same sentence the mutation would raise.
   *
   * Only where the share is this agent's own. Once an agent that sets nothing
   * falls through to its workspace's default, the preview can come back refused
   * about a share this form never asked for - most ordinarily on an agent with
   * no model yet, where the answer is "choose a model first" - and that is not
   * a reason to refuse the save. `updateAgent` agrees: it judges `memoryShare`
   * only when one was sent, so a form disabling Save here would be refusing
   * what the server would have accepted. What happens to a refused inherited
   * share is written below, where it is drawn.
   */
  const refusal = asked === null ? null : (budget?.refusal ?? null);

  /**
   * The same sentence when it is about the share this agent inherits.
   *
   * Not a refusal of anything on this form, so it neither hides the figures nor
   * stops the save - it is why the figures below are the built-in allowance's
   * rather than the workspace's share, which would otherwise be a silent
   * disagreement between this card and the workspace's settings page.
   */
  const inheritedRefusal = asked === null ? (budget?.refusal ?? null) : null;

  useEffect(() => {
    if (addingServer) newServerRef.current?.focus();
  }, [addingServer]);

  function addServer() {
    const value = newServer.trim();
    if (value !== '' && !mcpServers.includes(value)) {
      setMcpServers((current) => [...current, value]);
    }
    setNewServer('');
    setAddingServer(false);
  }

  function handleServerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addServer();
    } else if (event.key === 'Escape') {
      setNewServer('');
      setAddingServer(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updateAgent(agent.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        // Empty is "none chosen", which the server stores as null.
        modelId: modelId === '' ? null : modelId,
        mcpServers,
        orknuxAccess,
        shellAccess,
        memoryCatalogs,
        skillCatalogs,
        tools,
        icon,
        // Sent every save rather than left out, which is what lets the slider
        // put it back to the default.
        memoryShare: asked,
      });
      setMcpServers(updated.mcpServers);
      setOrknuxAccess(updated.orknuxAccess);
      setShellAccess(updated.shellAccess);
      setMemoryCatalogs(updated.memoryCatalogs);
      setSkillCatalogs(updated.skillCatalogs);
      setTools(updated.tools);
      setModelId(updated.modelId ?? '');
      setShare(updated.memoryShare);
      setSaved(true);
      onSaved(updated);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the agent.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.body} onSubmit={handleSave}>
      {heading}

      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="agent-name">
            Agent Name
          </label>
          <div className={styles.inputWrapper}>
            <input
              id="agent-name"
              name="agentName"
              className={styles.input}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="agent-description">
            Description
          </label>
          <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
            <textarea
              id="agent-description"
              name="agentDescription"
              className={`${styles.input} ${styles.textarea}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>

        <IconField
          value={icon}
          onChange={setIcon}
          hint="Nodes drawn from this agent start with it; each node can change its own."
        />

        <div className={styles.field}>
          <button
            type="button"
            className={own.promptToggle}
            onClick={() => setPromptOpen((open) => !open)}
            aria-expanded={promptOpen}
            aria-controls="agent-system-prompt"
          >
            <img
              className={promptOpen ? own.chevron : `${own.chevron} ${own.chevronClosed}`}
              src={chevronDownIcon}
              alt=""
              width={16}
              height={16}
            />
            System Prompt
          </button>
          {promptOpen && (
            <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
              <textarea
                id="agent-system-prompt"
                name="systemPrompt"
                className={`${styles.input} ${styles.textarea} ${own.promptInput}`}
                placeholder="You are a research agent specialized in web search and data synthesis…"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
              />
            </div>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="agent-model">
            Model
          </label>
          <div className={styles.inputWrapper}>
            <select
              id="agent-model"
              className={`${styles.input} ${styles.select}`}
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">None — this agent cannot run</option>
              {/* An agent talks; these hear and read rather than answer. */}
              {models.filter(answers).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </div>
          {/*
            No empty state here on purpose: a workspace with no models says so
            through the one option the select is left with. A workspace whose
            models could not be fetched looks exactly the same from outside,
            which is what this line is for.
          */}
          <CatalogueNote catalogue={modelCatalogue} className={own.emptyNote} />
        </div>

        {/*
          How much of that model's window a session may take back - issue #226.

          Under the model picker because it is a share of what that picker
          chose, and the two are read together: change the model and the figures
          under this change with it.

          One slider and not five boxes. The five numbers that used to be
          constants in the server - how many turns come back, how much of them,
          how much of what the tools returned, how much of any one result - are
          all worked out from this one, because somebody setting it is answering
          "how much conversation should it carry" and not five separate
          questions.

          Nothing is worked out here. The figures, the turn count and the
          refusal all come from `memoryBudget`, which is the same calculation
          the mutation judges a share with; a second copy in the browser would
          eventually disagree with it, and the one that drifted would be this.
        */}
        <div className={styles.field}>
          <span className={own.labelWithHint}>
            <label className={styles.label} htmlFor="agent-memory-share">
              Session Memory
            </label>
            <FieldHint label="Session Memory">
              How much of the chosen model&rsquo;s context window one of this agent&rsquo;s sessions may
              hand back on its next turn: what was said in it, and what its tools last returned. At
              Default this agent follows whatever its workspace has decided for the agents in it, and
              where the workspace has decided nothing either, a fixed built-in allowance that knows
              nothing of the window; the figures below say which of the two it is. A share is worked out
              from the window, which is why a model has to be chosen before one can be set. Token
              figures are approximate — they are counted in characters and reported at four characters
              to the token.
            </FieldHint>
          </span>

          <div className={own.shareRow}>
            <input
              id="agent-memory-share"
              className={own.shareSlider}
              type="range"
              min={DEFAULT_SHARE}
              max={MAX_SHARE}
              step={1}
              value={asked ?? DEFAULT_SHARE}
              /*
                A share means nothing without a window to be a share of, so with
                no model chosen there is nothing to drag. It reads Default while
                it is like that, which is also what would be saved.
              */
              disabled={chosenModel === null}
              onChange={(event) => {
                const at = Number(event.target.value);
                setShare(at === DEFAULT_SHARE ? null : at);
              }}
              aria-valuetext={asked === null ? 'Default' : `${asked}%`}
            />
            <output className={own.shareValue} htmlFor="agent-memory-share">
              {asked === null ? 'Default' : `${asked}%`}
            </output>
          </div>

          {/*
            The refusal, or the figures - never both. Where a share is refused
            the server answers with the built-in default's numbers rather than
            with nothing, and printing those under a refusal would show figures
            this agent is not going to get.
          */}
          {refusal !== null ? (
            <p className={own.shareRefusal} role="alert">
              {refusal}
            </p>
          ) : (
            budget !== null && (
              <dl className={own.budget}>
                {/*
                  Where the figures below are coming from, and only at Default.

                  Default used to mean one thing - the built-in allowance - and
                  now means whichever of two things the workspace has decided.
                  An agent sitting at Default in a workspace with a default of
                  25% is being shown that workspace's 25% worked out against
                  this model, not the built-in allowance, and the difference is
                  the only thing on this card a reader cannot get at by looking:
                  it is `inherited` on the budget, and this row is the one place
                  it is said. Where the agent has a share of its own the source
                  is the slider directly above, so the row would be restating
                  the control.
                */}
                {asked === null && (
                  <div className={own.budgetRow}>
                    <dt>Default is</dt>
                    <dd>
                      {budget.inherited && budget.share !== null && budget.refusal === null
                        ? `the workspace's ${budget.share}%`
                        : 'the built-in allowance'}
                    </dd>
                  </div>
                )}
                <div className={own.budgetRow}>
                  <dt>Altogether</dt>
                  <dd>{thousands(budget.totalTokens)} tokens</dd>
                </div>
                <div className={own.budgetRow}>
                  <dt>Conversation</dt>
                  <dd>
                    {thousands(budget.conversationTokens)} tokens, {budget.turns} turns
                  </dd>
                </div>
                <div className={own.budgetRow}>
                  <dt>Tool results</dt>
                  <dd>
                    {thousands(budget.toolResultTokens)} tokens, longest{' '}
                    {thousands(budget.longestResultTokens)}
                  </dd>
                </div>
              </dl>
            )
          )}

          {/*
            Why the row above says the built-in allowance in a workspace that
            has a default: this model cannot give that default, so this agent
            does not get it. The server's own sentence, printed plainly rather
            than as an alert - nothing here is refused, and there is nothing on
            this form to put right except the model above it.
          */}
          {refusal === null && inheritedRefusal !== null && (
            <p className={own.inheritedNote}>{inheritedRefusal}</p>
          )}
        </div>

        {/*
          What this agent may read of what the workspace knows. A grant:
          an agent given none reads none.
        */}
        <GrantList<MemoryCatalog>
          label="Memory Catalogs"
          what="memory catalogs"
          styles={styles}
          catalogue={memoryCatalogue}
          empty="No catalogs in this workspace yet."
          keyOf={(catalog) => catalog.id}
          nameOf={(catalog) => catalog.name}
          metaOf={(catalog) => catalog.memoryCount}
          granted={memoryCatalogs}
          onChange={setMemoryCatalogs}
        />

        {/*
          And what it may draw on of how the workspace goes about things.
          Granted per catalog, like memory: what an agent is expected to know
          is decided once rather than once per skill.
        */}
        <GrantList<SkillCatalog>
          label="Skill Catalogs"
          what="skill catalogs"
          styles={styles}
          catalogue={skillCatalogue}
          empty="No skill catalogs in this workspace yet."
          keyOf={(catalog) => catalog.id}
          nameOf={(catalog) => catalog.name}
          metaOf={(catalog) => catalog.skillCount}
          granted={skillCatalogs}
          onChange={setSkillCatalogs}
        />

        {/*
          And what it may *do*. The strictest of the grants: a skill is a
          page this agent reads, a tool is code it runs.
        */}
        <GrantList<Tool>
          label="Tools"
          what="tools"
          styles={styles}
          catalogue={toolCatalogue}
          empty="No tools in this workspace yet."
          keyOf={(tool) => tool.id}
          nameOf={(tool) => tool.name}
          metaOf={(tool) => (tool.enabled ? null : 'off')}
          granted={tools}
          onChange={setTools}
        />

        {/*
          Orknux itself, kept apart from the servers below on purpose: those
          are addresses somebody registered, and this is the application the
          agent is already inside. It never appears in that list.
        */}
        <div className={styles.field}>
          <span className={styles.label}>Orknux</span>
          {/*
            The (?) sits on the row and not on the heading above it, because the
            row is the thing being granted - UI-DESIGN-RULES.md says to put it
            beside that where the two differ, and here they do: the heading names
            the application, the row is the permission.

            It is a sibling of the <label> rather than a child of one. A button
            inside a label is a press the browser forwards to the control that
            label is for, so asking what the grant means would grant it.
          */}
          <div className={own.checkRow}>
            <label className={own.grantToggle}>
              <input
                type="checkbox"
                checked={orknuxAccess}
                onChange={(event) => setOrknuxAccess(event.target.checked)}
              />
              <span>Let this agent ask orknux about orknux</span>
            </label>
            <FieldHint label="Orknux">
              Its workspace’s workflows, runs and agents — and it can start a workflow, which really
              runs it. An agent that starts a workflow which asks an agent is a loop nothing here
              breaks.
            </FieldHint>
          </div>
        </div>

        {/*
          Beside Orknux because it is the same kind of switch - a grant of
          something the agent is not otherwise offered - and plural on
          purpose. An agent asks for a shell rather than for a named
          machine; which one it gets is decided when the session opens.
        */}
        <div className={styles.field}>
          <span className={styles.label}>Shells</span>
          {/*
            Beside the row for the same reason, and this is the one where it
            matters most: what the note says is what an account on that machine
            can do, which is a sentence about the tick rather than about the
            word "Shells" above it.
          */}
          <div className={own.checkRow}>
            <label className={own.grantToggle}>
              <input
                type="checkbox"
                checked={shellAccess}
                onChange={(event) => setShellAccess(event.target.checked)}
              />
              <span>Let this agent open a shell and run commands on it</span>
            </label>
            <FieldHint label="Shells">
              It opens a session on one of the machines an administrator set up under Admin →
              Shell, gets a working directory of its own on it, and runs commands there. What
              contains that is the machine and the account named on it, not anything here: an
              agent given this can do whatever that account can. Every command is written down in
              the audit log under this agent&apos;s name.
            </FieldHint>
          </div>
        </div>

        <div className={styles.field} data-grants="mcp servers">
          <span className={own.labelWithHint}>
            <span className={styles.label}>MCP Servers</span>
            <FieldHint label="MCP Servers">External tool servers this agent can connect to.</FieldHint>
          </span>
          <div className={own.servers}>
            {/*
              Bounded like the grant lists above, and for the same reason - but
              without a search, because there is nothing here to search for. The
              lists above draw the whole workspace and mark what is granted; this
              draws only what is granted, so a box that narrowed it would only
              ever hide grants. The count is the length of the list, which is
              already on the screen.

              The way to add one is outside the box on purpose: put inside it, it
              would scroll away with the chips the moment there were enough of
              them to need scrolling.
            */}
            {mcpServers.length > 0 && (
              <div className={own.serverChips} data-grant-rows="">
                {mcpServers.map((server) => (
                  <span key={server} className={own.chip}>
                    {server}
                    <button
                      type="button"
                      className={own.chipRemove}
                      onClick={() => setMcpServers((current) => current.filter((named) => named !== server))}
                      aria-label={`Remove ${server}`}
                      title={`Remove ${server}`}
                    >
                      <img src={xCircleIcon} alt="" width={8} height={8} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {addingServer ? (
              <input
                ref={newServerRef}
                className={own.newServer}
                type="text"
                value={newServer}
                placeholder="server-name"
                onChange={(event) => setNewServer(event.target.value)}
                onKeyDown={handleServerKeyDown}
                onBlur={addServer}
                aria-label="New MCP server"
              />
            ) : (
              <button type="button" className={own.addServer} onClick={() => setAddingServer(true)}>
                + Add Server
              </button>
            )}
          </div>
        </div>
      </div>

      {saveError !== null && (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}

      <div className={styles.actions}>
        {saved && saveError === null && styles.savedNote !== undefined && (
          <p className={styles.savedNote}>Saved.</p>
        )}
        {onCancel !== undefined && (
          <button type="button" className={styles.ghost} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        {/*
          A refused share stops the save here as well as at the server. Not
          instead of: the mutation refuses it from the same calculation, and
          this is only the form saying so before the press rather than after.
        */}
        <button
          type="submit"
          className={styles.filled}
          disabled={name.trim() === '' || saving || refusal !== null}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
