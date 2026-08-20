import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { fetchAgent, updateAgent } from '../../api/agents';
import type { Agent } from '../../api/agents';
import type { SessionUser } from '../../api/session';
import chevronDownIcon from '../../assets/chevron-down.svg';
import xCircleIcon from '../../assets/x-circle.svg';
import { fetchMemoryCatalogs } from '../../api/memory';
import { fetchSkillCatalogs } from '../../api/skills';
import { fetchWorkspaceTools } from '../../api/tools';
import type { Tool } from '../../api/tools';
import type { SkillCatalog } from '../../api/skills';
import type { MemoryCatalog } from '../../api/memory';
import { answers, fetchModels } from '../../api/models';
import type { Model } from '../../api/models';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { DeleteAgentDialog } from '../../components/DeleteAgentDialog';
import { IconField } from '../../components/IconField';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './AgentSettingsPage.module.css';

export interface AgentSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

export function AgentSettingsPage({ session, onSignOut }: AgentSettingsPageProps) {
  const { workspaceId = '', agentId = '' } = useParams();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  /** Whether it may ask orknux about orknux; the built-in server. */
  const [orknuxAccess, setOrknuxAccess] = useState(false);
  const [shellAccess, setShellAccess] = useState(false);
  const [modelId, setModelId] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [memoryCatalogs, setMemoryCatalogs] = useState<string[]>([]);
  const [skillCatalogs, setSkillCatalogs] = useState<string[]>([]);
  const [skillFolders, setSkillFolders] = useState<SkillCatalog[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [workspaceTools, setWorkspaceTools] = useState<Tool[]>([]);
  const [catalogs, setCatalogs] = useState<MemoryCatalog[]>([]);
  const [icon, setIcon] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(true);
  const [addingServer, setAddingServer] = useState(false);
  const [newServer, setNewServer] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const newServerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAgent(agentId)
      .then((found) => {
        if (found === null) {
          setLoadError('That agent does not exist, or you do not have access to it.');
          return;
        }
        setAgent(found);
        setName(found.name);
        setDescription(found.description ?? '');
        setSystemPrompt(found.systemPrompt ?? '');
        setMcpServers(found.mcpServers);
        setOrknuxAccess(found.orknuxAccess);
        setShellAccess(found.shellAccess);
        setMemoryCatalogs(found.memoryCatalogs);
        setSkillCatalogs(found.skillCatalogs);
        setTools(found.tools);
        setModelId(found.modelId ?? '');
        setIcon(found.icon ?? null);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the agent.');
      });
  }, [agentId]);

  // What this workspace can offer the agent: its models, and its catalogs.
  useEffect(() => {
    if (workspaceId === '') return;
    fetchModels(workspaceId).then(setModels).catch(() => setModels([]));
    fetchMemoryCatalogs(workspaceId).then(setCatalogs).catch(() => setCatalogs([]));
    fetchSkillCatalogs(workspaceId).then(setSkillFolders).catch(() => setSkillFolders([]));
    fetchWorkspaceTools(workspaceId, 0, 100)
      .then((page) => setWorkspaceTools(page.content))
      .catch(() => setWorkspaceTools([]));
  }, [workspaceId]);

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
      const updated = await updateAgent(agentId, {
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
      setAgent(updated);
      setMcpServers(updated.mcpServers);
      setOrknuxAccess(updated.orknuxAccess);
      setShellAccess(updated.shellAccess);
      setMemoryCatalogs(updated.memoryCatalogs);
      setSkillCatalogs(updated.skillCatalogs);
      setTools(updated.tools);
      setModelId(updated.modelId ?? '');
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the agent.');
    } finally {
      setSaving(false);
    }
  }


  return (
    <AppShell
      title={agent?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/agents`} label="Agents" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/agents`}>
            Agents
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{agent?.name ?? '…'}</span>
        </p>
        <h1 className={styles.pageTitle}>Agent Settings</h1>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : (
        <>
          <form className={styles.card} onSubmit={handleSave}>
            <h2 className={styles.sectionHeading}>General</h2>

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
                className={styles.promptToggle}
                onClick={() => setPromptOpen((open) => !open)}
                aria-expanded={promptOpen}
                aria-controls="agent-system-prompt"
              >
                <img
                  className={promptOpen ? styles.chevron : `${styles.chevron} ${styles.chevronClosed}`}
                  src={chevronDownIcon}
                  alt=""
                  width={16}
                  height={16}
                />
                System Prompt
              </button>
              {promptOpen && (
                <div className={`${styles.inputWrapper} ${styles.inputWrapperPrompt}`}>
                  <textarea
                    id="agent-system-prompt"
                    name="systemPrompt"
                    className={`${styles.input} ${styles.textarea} ${styles.promptInput}`}
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
                  {models
                    .filter(answers)
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
            </div>

            {/*
              What this agent may read of what the workspace knows. A grant:
              an agent given none reads none.
            */}
            <div className={styles.field}>
              <span className={styles.label}>Memory Catalogs</span>
              <div className={styles.checkList}>
                {catalogs.length === 0 && <p className={styles.emptyNote}>No catalogs in this workspace yet.</p>}
                {catalogs.map((catalog) => (
                  <label key={catalog.id} className={styles.checkRow}>
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
                    <span className={styles.checkCount}>{catalog.memoryCount}</span>
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
              <div className={styles.checkList}>
                {skillFolders.length === 0 && (
                  <p className={styles.emptyNote}>No skill catalogs in this workspace yet.</p>
                )}
                {skillFolders.map((catalog) => (
                  <label key={catalog.id} className={styles.checkRow}>
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
                    <span className={styles.checkCount}>{catalog.skillCount}</span>
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
              <div className={styles.checkList}>
                {workspaceTools.length === 0 && (
                  <p className={styles.emptyNote}>No tools in this workspace yet.</p>
                )}
                {workspaceTools.map((tool) => (
                  <label key={tool.id} className={styles.checkRow}>
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
                    {!tool.enabled && <span className={styles.checkCount}>off</span>}
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
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={orknuxAccess}
                  onChange={(event) => setOrknuxAccess(event.target.checked)}
                />
                <span>Let this agent ask orknux about orknux</span>
              </label>
              <p className={styles.hint}>
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
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={shellAccess}
                  onChange={(event) => setShellAccess(event.target.checked)}
                />
                <span>Let this agent open a shell and run commands on it</span>
              </label>
              <p className={styles.hint}>
                It opens a session on one of the machines an administrator set up under Admin →
                Shell, gets a working directory of its own on it, and runs commands there. What
                contains that is the machine and the account named on it, not anything here: an
                agent given this can do whatever that account can. Every command is written down in
                the audit log under this agent&apos;s name.
              </p>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>MCP Servers</span>
              <p className={styles.hint}>External tool servers this agent can connect to</p>
              <div className={styles.servers}>
                {mcpServers.map((server) => (
                  <span key={server} className={styles.chip}>
                    {server}
                    <button
                      type="button"
                      className={styles.chipRemove}
                      onClick={() => setMcpServers((current) => current.filter((name) => name !== server))}
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
                    className={styles.newServer}
                    type="text"
                    value={newServer}
                    placeholder="server-name"
                    onChange={(event) => setNewServer(event.target.value)}
                    onKeyDown={handleServerKeyDown}
                    onBlur={addServer}
                    aria-label="New MCP server"
                  />
                ) : (
                  <button type="button" className={styles.addServer} onClick={() => setAddingServer(true)}>
                    + Add Server
                  </button>
                )}
              </div>
            </div>

            {saveError !== null && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}

            <div className={styles.cardActions}>
              {saved && saveError === null && <p className={styles.savedNote}>Saved.</p>}
              <button type="submit" className={styles.save} disabled={name.trim() === '' || saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <h2 className={styles.dangerHeading}>Danger Zone</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <p className={styles.dangerTitle}>Delete Agent</p>
                <p className={styles.dangerMessage}>Permanently remove this agent and its configuration.</p>
              </div>
              <button type="button" className={styles.delete} onClick={() => setConfirmingDelete(true)}>
                Delete Agent
              </button>
            </div>
          </section>
        </>
      )}

      <DeleteAgentDialog
        agent={confirmingDelete ? agent : null}
        onClose={() => setConfirmingDelete(false)}
        onDeleted={() => navigate(`/workspace/${workspaceId}/agents`)}
      />
    </AppShell>
  );
}
