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
import { FieldHint } from './FieldHint';
import { IconField } from './IconField';
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
  /**
   * What a field has to say for itself where that is not an explanation of it.
   * What a field means sits behind the (?) beside its label; what is printed
   * under one is the consequence of ticking it, which a hover must not hide.
   */
  fieldHint: string;
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

  const models: Model[] = modelCatalogue.items;
  const catalogs: MemoryCatalog[] = memoryCatalogue.items;
  const skillFolders: SkillCatalog[] = skillCatalogue.items;
  const workspaceTools: Tool[] = toolCatalogue.items;

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
        <div className={styles.field}>
          <span className={styles.label}>Memory Catalogs</span>
          <div className={own.checkList}>
            <CatalogueNote
              catalogue={memoryCatalogue}
              className={own.emptyNote}
              empty="No catalogs in this workspace yet."
            />
            {catalogs.map((catalog) => (
              <label key={catalog.id} className={own.checkRow}>
                <input
                  type="checkbox"
                  checked={memoryCatalogs.includes(catalog.name)}
                  onChange={(event) =>
                    setMemoryCatalogs((present) =>
                      event.target.checked
                        ? [...present, catalog.name]
                        : present.filter((one) => one !== catalog.name),
                    )
                  }
                />
                <span>{catalog.name}</span>
                <span className={own.checkCount}>{catalog.memoryCount}</span>
              </label>
            ))}
          </div>
        </div>

        {/*
          And what it may draw on of how the workspace goes about things.
          Granted per catalog, like memory: what an agent is expected to know
          is decided once rather than once per skill.
        */}
        <div className={styles.field}>
          <span className={styles.label}>Skill Catalogs</span>
          <div className={own.checkList}>
            <CatalogueNote
              catalogue={skillCatalogue}
              className={own.emptyNote}
              empty="No skill catalogs in this workspace yet."
            />
            {skillFolders.map((catalog) => (
              <label key={catalog.id} className={own.checkRow}>
                <input
                  type="checkbox"
                  checked={skillCatalogs.includes(catalog.name)}
                  onChange={(event) =>
                    setSkillCatalogs((present) =>
                      event.target.checked
                        ? [...present, catalog.name]
                        : present.filter((one) => one !== catalog.name),
                    )
                  }
                />
                <span>{catalog.name}</span>
                <span className={own.checkCount}>{catalog.skillCount}</span>
              </label>
            ))}
          </div>
        </div>

        {/*
          And what it may *do*. The strictest of the grants: a skill is a
          page this agent reads, a tool is code it runs.
        */}
        <div className={styles.field}>
          <span className={styles.label}>Tools</span>
          <div className={own.checkList}>
            <CatalogueNote catalogue={toolCatalogue} className={own.emptyNote} empty="No tools in this workspace yet." />
            {workspaceTools.map((tool) => (
              <label key={tool.id} className={own.checkRow}>
                <input
                  type="checkbox"
                  checked={tools.includes(tool.name)}
                  onChange={(event) =>
                    setTools((present) =>
                      event.target.checked
                        ? [...present, tool.name]
                        : present.filter((one) => one !== tool.name),
                    )
                  }
                />
                <span>{tool.name}</span>
                {!tool.enabled && <span className={own.checkCount}>off</span>}
              </label>
            ))}
          </div>
        </div>

        {/*
          Orknux itself, kept apart from the servers below on purpose: those
          are addresses somebody registered, and this is the application the
          agent is already inside. It never appears in that list.
        */}
        <div className={styles.field}>
          <span className={styles.label}>Orknux</span>
          <label className={own.checkRow}>
            <input
              type="checkbox"
              checked={orknuxAccess}
              onChange={(event) => setOrknuxAccess(event.target.checked)}
            />
            <span>Let this agent ask orknux about orknux</span>
          </label>
          {/*
            Printed rather than behind the (?): the second sentence is a
            consequence of ticking the box, and a loop nothing here breaks
            is not something to find out about after granting it.
          */}
          <p className={styles.fieldHint}>
            Its workspace’s workflows, runs and agents — and it can start a workflow, which really runs
            it. An agent that starts a workflow which asks an agent is a loop nothing here breaks.
          </p>
        </div>

        {/*
          Beside Orknux because it is the same kind of switch - a grant of
          something the agent is not otherwise offered - and plural on
          purpose. An agent asks for a shell rather than for a named
          machine; which one it gets is decided when the session opens.
        */}
        <div className={styles.field}>
          <span className={styles.label}>Shells</span>
          <label className={own.checkRow}>
            <input
              type="checkbox"
              checked={shellAccess}
              onChange={(event) => setShellAccess(event.target.checked)}
            />
            <span>Let this agent open a shell and run commands on it</span>
          </label>
          {/*
            Printed for the same reason. "Can do whatever that account can"
            is the whole of what this switch hands over, and hiding it
            behind a hover is hiding the reason to think before ticking.
          */}
          <p className={styles.fieldHint}>
            It opens a session on one of the machines an administrator set up under Admin →
            Shell, gets a working directory of its own on it, and runs commands there. What
            contains that is the machine and the account named on it, not anything here: an
            agent given this can do whatever that account can. Every command is written down in
            the audit log under this agent&apos;s name.
          </p>
        </div>

        <div className={styles.field}>
          <span className={own.labelWithHint}>
            <span className={styles.label}>MCP Servers</span>
            <FieldHint label="MCP Servers">External tool servers this agent can connect to.</FieldHint>
          </span>
          <div className={own.servers}>
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
