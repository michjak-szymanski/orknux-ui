import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';

import { updateAgent } from '../api/agents';
import type { Agent } from '../api/agents';
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
      });
      setMcpServers(updated.mcpServers);
      setOrknuxAccess(updated.orknuxAccess);
      setShellAccess(updated.shellAccess);
      setMemoryCatalogs(updated.memoryCatalogs);
      setSkillCatalogs(updated.skillCatalogs);
      setTools(updated.tools);
      setModelId(updated.modelId ?? '');
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
            <div className={`${styles.inputWrapper} ${own.inputWrapperPrompt}`}>
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
        <button type="submit" className={styles.filled} disabled={name.trim() === '' || saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
