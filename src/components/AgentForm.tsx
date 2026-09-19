import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { fetchMemoryBudget, updateAgent } from '../api/agents';
import type { Agent, SessionMemoryBudget } from '../api/agents';
import { fetchPluginTools } from '../api/plugins';
import { fetchMcpServers, fetchWorkspaceConnections } from '../api/integrations';
import type { McpServer, WorkspaceConnection } from '../api/integrations';
import { fetchMemoryCatalogs } from '../api/memory';
import type { MemoryCatalog } from '../api/memory';
import { answers, fetchModels } from '../api/models';
import type { Model } from '../api/models';
import { fetchPluginSkillCatalogs, fetchSkillCatalogs } from '../api/skills';
import { fetchWorkspaceTools } from '../api/tools';
import chevronDownIcon from '../assets/chevron-down.svg';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { CatalogueNote, useCatalogue } from './Catalogue';
import type { Catalogue } from './Catalogue';
import { FieldHint } from './FieldHint';
import { IconField } from './IconField';
import { OpenDefinitionIcon } from './OpenDefinitionIcon';
import { segments } from './searchMatches';
import own from './AgentForm.module.css';
import { t } from '../i18n';

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
  /**
   * A label with something on the far side of the row from it, which here is
   * always the way out to what the field names.
   */
  labelRow: string;
  /**
   * The mark on that way out. Both frames already had the class, for the
   * trigger and condition forms they also hold - this form is the one that
   * named nothing it pointed at.
   */
  jump: string;
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
 * One row of the Tools grant: a workspace tool, or a tool a plugin offers.
 *
 * The two are one list because they are one grant. A name in `Agent.tools` may
 * be a plugin tool's as well as a workspace tool's, and either way the agent
 * is offered it as a tool - so a second box would be two lists feeding one
 * field, and the count over each would be a lie about the other. What tells
 * them apart is the row's muted word: the plugin's name, where a tool has
 * `off`.
 */
interface GrantableTool {
  /** The tool's id, or the plugin tool's name behind a prefix so the two cannot collide. */
  id: string;
  /** What the grant is stored under, for both kinds alike. */
  name: string;
  /** The plugin that offers it, or null for the workspace's own tools. */
  plugin: string | null;
  /** Only a workspace tool can be switched off; a plugin's tool is on while its plugin is loaded. */
  off: boolean;
  /** The row's own page: the tool editor, or the page of the function a plugin tool fronts. Null where it has none. */
  link: string | null;
}

/**
 * A skill catalog an agent can be granted: the workspace's own, or a plugin's.
 *
 * One list for the same reason the tools are one list - it is one grant. A
 * name in `Agent.skillCatalogs` may be a workspace catalog's or a plugin's
 * key, and the agent draws on it either way, so a second box would be two
 * lists feeding one field. What tells them apart is the row's muted word: the
 * plugin's name, where a workspace catalog shows how many skills it holds.
 */
interface GrantableCatalog {
  /** The catalog's id, or the plugin's key behind a prefix so the two cannot collide. */
  id: string;
  /** What the grant is stored under, for both kinds alike. */
  name: string;
  /** How many skills it holds. */
  count: number;
  /** The plugin that brought it, or null for the workspace's own. */
  plugin: string | null;
  /** The catalog's own page, or the plugin's. */
  link: string;
}

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
  /**
   * Where the row's own page is, or null where it has none.
   *
   * A grant list names things the workspace defines elsewhere, and deciding
   * whether to tick one means knowing what it is - which until now meant
   * finding the page by hand. Issue #251.
   */
  linkOf?: (item: Item) => string | null;
  /**
   * The (?) beside the heading, where the kind of grant needs a word of
   * explanation. The catalogs do not; MCP servers do, because the word says
   * nothing about what connecting to one lets the agent do - and Tools does
   * now that its list mixes the workspace's own with what plugins brought.
   */
  hint?: ReactNode;
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
  linkOf,
  hint,
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

  /*
   * A grant the catalogue has no row for still gets one.
   *
   * The rule above - a ticked row is never hidden - was written about the
   * search box, but the catalogue can hide a grant just as easily: the thing
   * was renamed, or deleted, or the list did not arrive. The grant is still
   * stored and still sent to the agent, so a list that draws only what the
   * workspace currently has shows an agent with fewer grants than it has, and
   * the only way to drop one becomes editing something else. Drawn last, marked
   * as unknown, and revocable - which is the one thing anybody wants from it.
   */
  const orphans = granted.filter((name) => !rows.some((row) => row.name === name));

  const shown = rows.filter((row) => row.matches || row.ticked);
  const matching = rows.filter((row) => row.matches).length;
  const here = rows.filter((row) => row.ticked).length + orphans.length;

  return (
    <div className={styles.field} data-grants={what}>
      <span className={own.grantHead}>
        <span className={own.labelWithHint}>
          <span className={styles.label}>{label}</span>
          {hint !== undefined && <FieldHint label={label}>{hint}</FieldHint>}
        </span>
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

      {(items.length > 0 || orphans.length > 0) && (
        <div className={own.checkList} data-grant-rows="">
          {shown.map((row) => {
            const meta = metaOf?.(row.item);
            const opens = linkOf?.(row.item) ?? null;
            return (
              /*
                A row rather than one big <label>, now that it carries a way out
                as well as a tick. The label is only the part that toggles: a
                press on a link inside a label is a press the browser can
                forward to the checkbox, and going to read what a grant means
                would grant it - which is the rule the (?) beside Orknux and
                Shells is already written to.
              */
              <div
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
                <label className={own.grantToggle}>
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
                </label>
                {meta !== undefined && meta !== null && meta !== false && (
                  <span className={own.checkCount}>{meta}</span>
                )}
                {opens !== null && (
                  <Link
                    className={own.grantJump}
                    to={opens}
                    target="_blank"
                    rel="noreferrer"
                    title={`Opens ${row.name} in a new tab`}
                    aria-label={`Open ${row.name}`}
                  >
                    <OpenDefinitionIcon />
                  </Link>
                )}
              </div>
            );
          })}

          {/*
            The grants the workspace has no row for, drawn last so they cannot
            be mistaken for part of the list above, and marked with what is
            wrong: the name is granted and nothing here is called that. The tick
            is on and unticking it is the only thing it does - there is nothing
            to link to and nothing to search.
          */}
          {orphans.map((name) => (
            <div key={`orphan:${name}`} className={`${own.checkRow} ${own.checkRowKept}`} data-grant-name={name} data-grant-unknown="">
              <label className={own.grantToggle}>
                <input
                  type="checkbox"
                  checked
                  onChange={() => onChange(granted.filter((one) => one !== name))}
                />
                <span className={own.grantName}>{name}</span>
              </label>
              <span className={own.checkCount}>{t('not in this workspace')}</span>
            </div>
          ))}
          {shown.length === 0 && <p className={own.emptyNote}>{t('Nothing by that name.')}</p>}
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
  /** Which of the workspace's connections it may name, by id - see the grant list below. */
  const [connectionIds, setConnectionIds] = useState<string[]>(agent.connectionIds);
  const [icon, setIcon] = useState<string | null>(agent.icon ?? null);
  /**
   * The share of the model's window a session may take back, or null to follow
   * the workspace's default - issue #226.
   */
  const [share, setShare] = useState<number | null>(agent.memoryShare);
  /** What that share works out to, as the server works it out. Null until asked. */
  const [budget, setBudget] = useState<SessionMemoryBudget | null>(null);

  const [promptOpen, setPromptOpen] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

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
  /*
   * The workspace's skill catalogs and the ones its plugins bring, as one
   * list - see `GrantableCatalog` for why it is one. A workspace catalog
   * shadows a plugin's of the same name on the server, so the shadowed row is
   * left out here rather than drawn as a tick that grants both.
   */
  const skillCatalogue = useCatalogue<GrantableCatalog>(
    'skill catalogs',
    async () => {
      const [held, brought] = await Promise.all([
        fetchSkillCatalogs(workspaceId),
        fetchPluginSkillCatalogs(),
      ]);
      const rows: GrantableCatalog[] = held.map((catalog) => ({
        id: catalog.id,
        name: catalog.name,
        count: catalog.skillCount,
        plugin: null,
        link: `/workspace/${workspaceId}/skills?catalog=${catalog.id}`,
      }));
      const taken = new Set(rows.map((row) => row.name));
      for (const offer of brought) {
        if (taken.has(offer.name)) continue;
        rows.push({
          // The key is the identity a plugin catalog has; the prefix keeps it
          // from colliding with a workspace catalog's numeric id.
          id: `ps:${offer.name}`,
          name: offer.name,
          count: offer.skills.length,
          plugin: offer.plugin,
          // Nothing to edit, so the way out is the plugin it came with.
          link: '/admin/plugins',
        });
      }
      return rows;
    },
    [workspaceId],
    { skip: noWorkspace },
  );
  /*
   * The workspace's tools and the tools its plugins offer, as one list - see
   * `GrantableTool` for why it is one. The plugin rows are the plugins'
   * `tools()` surface, which is the whole of what a plugin exposes to agents:
   * its functions belong to workflows, and one it wants a model to call is
   * fronted by a tool. A workspace tool shadows a plugin tool of the same
   * name on the server, so the shadowed row is left out here rather than
   * drawn as a tick that grants both.
   */
  const toolCatalogue = useCatalogue<GrantableTool>(
    'tools',
    async () => {
      const [held, offered] = await Promise.all([
        fetchWorkspaceTools(workspaceId, 0, TOOL_PAGE_SIZE),
        fetchPluginTools(),
      ]);
      const rows: GrantableTool[] = held.content.map((tool) => ({
        id: tool.id,
        name: tool.name,
        plugin: null,
        off: !tool.enabled,
        link: `/workspace/${workspaceId}/tools/${tool.id}`,
      }));
      const taken = new Set(rows.map((row) => row.name));
      for (const offer of offered) {
        if (taken.has(offer.name)) continue;
        rows.push({
          // The name is the identity a plugin tool has; the prefix keeps it
          // from colliding with a workspace tool's numeric id.
          id: `pt:${offer.name}`,
          name: offer.name,
          plugin: offer.plugin,
          off: false,
          // A tool fronting one of the plugin's functions has that function's
          // page to go to; one with a run of its own has no page.
          link: offer.functionId === null ? null : `/workspace/${workspaceId}/functions/${offer.functionId}`,
        });
      }
      return rows;
    },
    [workspaceId],
    { skip: noWorkspace },
  );
  /*
   * The registered servers, which this form asks for only to know where each
   * chip's own page is - issue #251.
   *
   * A grant is a name somebody typed, not a reference, so a chip may well name
   * nothing this workspace has: `serverPage` answers null for those rather than
   * pointing at a page that would say the server does not exist. Nothing else
   * on the form changes if this list never arrives - the chips are drawn from
   * the agent, and only the way out is missing.
   */
  const serverCatalogue = useCatalogue<McpServer>(t('MCP servers'), () => fetchMcpServers(workspaceId), [workspaceId], {
    skip: noWorkspace,
  });
  /*
   * The workspace's connections, for the grant list below.
   *
   * The grant is stored by id - a connection is referenced by id everywhere
   * else - but nobody grants "9", so the list draws names and this form
   * translates at its edges: ids to names going in, names back to ids in
   * onChange. A granted id whose connection is gone has no name to translate
   * to and is drawn as `#id`, which is also how it translates back, so it can
   * still be revoked.
   */
  const connectionCatalogue = useCatalogue<WorkspaceConnection>(
    t('connections'),
    () => fetchWorkspaceConnections(workspaceId),
    [workspaceId],
    { skip: noWorkspace },
  );
  const connectionName = (id: string) =>
    connectionCatalogue.items.find((held) => held.id === id)?.name ?? `#${id}`;

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
        connectionIds,
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
      setConnectionIds(updated.connectionIds);
      setModelId(updated.modelId ?? '');
      setShare(updated.memoryShare);
      setSaved(true);
      onSaved(updated);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not save the agent.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.body} onSubmit={handleSave}>
      {heading}

      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="agent-name">{t('Agent Name')}</label>
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
          <label className={styles.label} htmlFor="agent-description">{t('Description')}</label>
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
          hint={t("Nodes drawn from this agent start with it; each node can change its own.")}
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
            {t('System Prompt')}
          </button>
          {promptOpen && (
            <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
              <textarea
                id="agent-system-prompt"
                name="systemPrompt"
                className={`${styles.input} ${styles.textarea} ${own.promptInput}`}
                placeholder={t('You are a research agent specialized in web search and data synthesis…')}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
              />
            </div>
          )}
        </div>

        <div className={styles.field}>
          {/*
            The way out to the model this agent answers on - issue #251, and the
            page the refusal under the slider below sends people to when a model
            has no context window recorded.

            Only once one is chosen: "None — this agent cannot run" names
            nothing to open. A tab of its own, like every other jump on these
            forms, because this one is reached in the middle of an edit.
          */}
          <span className={styles.labelRow}>
            <label className={styles.label} htmlFor="agent-model">{t('Model')}</label>
            {chosenModel !== null && (
              <Link
                className={styles.jump}
                to={`/workspace/${workspaceId}/models/${chosenModel}`}
                target="_blank"
                rel="noreferrer"
                title={t('Opens the model\'s settings in a new tab')}
                aria-label={t('Open the model\'s settings')}
              >
                <OpenDefinitionIcon />
              </Link>
            )}
          </span>
          <div className={styles.inputWrapper}>
            <select
              id="agent-model"
              className={`${styles.input} ${styles.select}`}
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">{t('None — this agent cannot run')}</option>
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
        {/*
          Named so a check can read this card and nothing else.

          What it says - the figures, the refusal, the note under them - used to
          be found by walking up to the enclosing form, which meant every
          paragraph anywhere on the form counted as this card having answered.
          It held while the form was mostly fields; it stopped holding the
          moment a grant list below grew an empty-state sentence of its own, and
          the check then read the figures before they had arrived.
        */}
        <div className={styles.field} data-check="session-memory">
          <span className={own.labelWithHint}>
            <label className={styles.label} htmlFor="agent-memory-share">
              {t('Session Memory')}
            </label>
            <FieldHint label={t('Session Memory')}>
              {t('How much of the chosen model’s context window one of this agent’s sessions may hand back on its next turn: what was said in it, and what its tools last returned. At Default this agent follows whatever its workspace has decided for the agents in it, and where the workspace has decided nothing either, a fixed built-in allowance that knows nothing of the window; the figures below say which of the two it is. A share is worked out from the window, which is why a model has to be chosen before one can be set. Token figures are approximate — they are counted in characters and reported at four characters to the token.')}
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
                    <dt>{t('Default is')}</dt>
                    <dd>
                      {budget.inherited && budget.share !== null && budget.refusal === null
                        ? `the workspace's ${budget.share}%`
                        : 'the built-in allowance'}
                    </dd>
                  </div>
                )}
                <div className={own.budgetRow}>
                  <dt>{t('Altogether')}</dt>
                  <dd>{thousands(budget.totalTokens)} tokens</dd>
                </div>
                <div className={own.budgetRow}>
                  <dt>{t('Conversation')}</dt>
                  <dd>
                    {thousands(budget.conversationTokens)} tokens, {budget.turns} turns
                  </dd>
                </div>
                <div className={own.budgetRow}>
                  <dt>{t('Tool results')}</dt>
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
          label={t('Memory Catalogs')}
          what="memory catalogs"
          styles={styles}
          catalogue={memoryCatalogue}
          empty={t("No catalogs in this workspace yet.")}
          keyOf={(catalog) => catalog.id}
          nameOf={(catalog) => catalog.name}
          metaOf={(catalog) => catalog.memoryCount}
          linkOf={(catalog) => `/workspace/${workspaceId}/memory?catalog=${catalog.id}`}
          granted={memoryCatalogs}
          onChange={setMemoryCatalogs}
        />

        {/*
          And what it may draw on of how the workspace goes about things.
          Granted per catalog, like memory: what an agent is expected to know
          is decided once rather than once per skill.
        */}
        <GrantList<GrantableCatalog>
          label={t('Skill Catalogs')}
          what="skill catalogs"
          styles={styles}
          catalogue={skillCatalogue}
          empty={t("No skill catalogs in this workspace yet.")}
          hint={t("The workspace's own catalogs, and the ones its plugins bring.")}
          keyOf={(catalog) => catalog.id}
          nameOf={(catalog) => catalog.name}
          metaOf={(catalog) => catalog.plugin ?? catalog.count}
          linkOf={(catalog) => catalog.link}
          granted={skillCatalogs}
          onChange={setSkillCatalogs}
        />

        {/*
          And what it may *do*. The strictest of the grants: a skill is a
          page this agent reads, a tool is code it runs. The rows bearing a
          plugin's name are the tools that plugin offers to agents, granted
          and stored the same way - one name in the same list.
        */}
        <GrantList<GrantableTool>
          label={t('Tools')}
          what="tools"
          styles={styles}
          catalogue={toolCatalogue}
          empty={t("No tools in this workspace yet.")}
          hint={t('The workspace\'s own tools, and the tools its plugins offer — a granted name is offered to the model either way.')}
          keyOf={(tool) => tool.id}
          nameOf={(tool) => tool.name}
          metaOf={(tool) => tool.plugin ?? (tool.off ? 'off' : null)}
          linkOf={(tool) => tool.link}
          granted={tools}
          onChange={setTools}
        />

        {/*
          And what it may point those tools at. The one grant that comes with a
          standing instruction rather than an ability: the briefing lists these
          and tells the agent to name one only when explicitly told to, so a
          tick here widens what the agent *may* do without changing what it
          does unprompted.
        */}
        <GrantList<WorkspaceConnection>
          label={t('Connections')}
          what="connections"
          styles={styles}
          catalogue={connectionCatalogue}
          empty={t('No connections in this workspace yet.')}
          hint={t('Connections the agent may name where a tool takes one. It is told to use one only when explicitly asked to, and to leave tools to their configured defaults otherwise.')}
          keyOf={(connection) => connection.id}
          nameOf={(connection) => connection.name}
          metaOf={(connection) => connection.type.toLowerCase()}
          linkOf={(connection) => `/workspace/${workspaceId}/integrations/connections/${connection.id}`}
          granted={connectionIds.map(connectionName)}
          onChange={(names) =>
            setConnectionIds(
              names.map(
                (name) =>
                  connectionCatalogue.items.find((held) => held.name === name)?.id ??
                  name.replace(/^#/, ''),
              ),
            )
          }
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
              <span>{t('Let this agent ask orknux about orknux')}</span>
            </label>
            <FieldHint label="Orknux">
              {t('Its workspace’s workflows, runs and agents — and it can start a workflow, which really runs it. An agent that starts a workflow which asks an agent is a loop nothing here breaks.')}
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
          <span className={styles.label}>{t('Shells')}</span>
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
              <span>{t('Let this agent open a shell and run commands on it')}</span>
            </label>
            <FieldHint label={t('Shells')}>
              {t('It opens a session on one of the machines an administrator set up under Admin → Shell, gets a working directory of its own on it, and runs commands there. What contains that is the machine and the account named on it, not anything here: an agent given this can do whatever that account can. Every command is written down in the audit log under this agent\'s name.')}
            </FieldHint>
          </div>
        </div>

        {/*
          The same list as Tools and the catalogs above, and for the reason
          issue #172 gave for those: this was a row of chips with a text box to
          type a name into, so granting a server meant knowing its name by heart
          and spelling it, and nothing on the screen said which ones there were.
          The workspace already knows. Requested 2026-09-06.
        */}
        <GrantList<McpServer>
          label={t('MCP Servers')}
          what="mcp servers"
          styles={styles}
          catalogue={serverCatalogue}
          empty={t('No MCP servers in this workspace yet.')}
          hint={t('External tool servers this agent can connect to.')}
          keyOf={(server) => server.id}
          nameOf={(server) => server.name}
          linkOf={(server) => `/workspace/${workspaceId}/integrations/servers/${server.id}`}
          granted={mcpServers}
          onChange={setMcpServers}
        />
      </div>

      {saveError !== null && (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}

      <div className={styles.actions}>
        {saved && saveError === null && styles.savedNote !== undefined && (
          <p className={styles.savedNote}>{t('Saved.')}</p>
        )}
        {onCancel !== undefined && (
          <button type="button" className={styles.ghost} onClick={onCancel} disabled={saving}>
            {t('Cancel')}
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
          {saving ? t('Saving…') : t('Save Changes')}
        </button>
      </div>
    </form>
  );
}
