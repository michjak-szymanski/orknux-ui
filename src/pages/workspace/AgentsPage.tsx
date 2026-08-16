import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import { agentTypeLabel, fetchWorkspaceAgents, setAgentEnabled } from '../../api/agents';
import type { Agent } from '../../api/agents';
import settingsIcon from '../../assets/settings-14.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import { CreateAgentDialog } from '../../components/CreateAgentDialog';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './AgentsPage.module.css';

export interface AgentsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 5;

export function AgentsPage({ session, onSignOut }: AgentsPageProps) {
  const { workspaceId = '' } = useParams();

  const [agents, setAgents] = useState<PageOf<Agent> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceAgents(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        setAgents(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setAgents(null);
        setError(cause instanceof Error ? cause.message : 'Could not load agents.');
        setLoading(false);
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

  async function toggle(agent: Agent) {
    await setAgentEnabled(agent.id, !agent.enabled);
    load();
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="agents" />}
    >
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Agents</h1>
          <p className={styles.subtitle}>Configure and manage AI agents for your workspace</p>
        </div>
        <button type="button" className={styles.createAgent} onClick={() => setCreating(true)}>
          + Create Agent
        </button>
      </header>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colGrow}>Agent</span>
          <span className={styles.colGrow}>Description</span>
          <span className={styles.colStatus}>Status</span>
          <span className={styles.colActions}>Actions</span>
        </div>

        {loading && <p className={styles.notice}><Loader /></p>}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && agents?.content.length === 0 && (
          <p className={styles.notice}>No agents yet.</p>
        )}

        {agents?.content.map((agent) => (
          <div key={agent.id} className={styles.row}>
            <span className={`${styles.colGrow} ${styles.agentCell}`}>
              <Link className={styles.agentName} to={`/workspace/${workspaceId}/agents/${agent.id}/settings`}>
                {agent.name}
              </Link>
              <span className={styles.agentType}>{agentTypeLabel(agent.type)}</span>
            </span>
            <span className={`${styles.colGrow} ${styles.description}`}>{agent.description ?? '—'}</span>
            <span className={styles.colStatus}>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void toggle(agent)}
                role="switch"
                aria-checked={agent.enabled}
                aria-label={`${agent.enabled ? 'Disable' : 'Enable'} ${agent.name}`}
                title={agent.enabled ? 'Disable' : 'Enable'}
              >
                <img src={agent.enabled ? toggleOnIcon : toggleOffIcon} alt="" width={36} height={20} data-keeps-colour />
              </button>
            </span>
            <span className={styles.colActions}>
              <Link
                className={styles.settings}
                to={`/workspace/${workspaceId}/agents/${agent.id}/settings`}
                aria-label={`Settings for ${agent.name}`}
                title={`Settings for ${agent.name}`}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}

        <CompactPagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={agents?.totalElements ?? 0}
          unit="agents"
          onPageChange={setPage}
        />
      </section>

      <CreateAgentDialog
        open={creating}
        workspaceId={workspaceId}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setPage(1);
          load();
        }}
      />
    </AppShell>
  );
}
