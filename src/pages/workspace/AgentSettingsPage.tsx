import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { fetchAgent } from '../../api/agents';
import type { Agent } from '../../api/agents';
import type { SessionUser } from '../../api/session';
import { AgentForm } from '../../components/AgentForm';
import type { AgentFormStyles } from '../../components/AgentForm';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { DeleteAgentDialog } from '../../components/DeleteAgentDialog';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './AgentSettingsPage.module.css';

export interface AgentSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** The page's own names for what the form needs. */
const FORM_STYLES: AgentFormStyles = {
  body: styles.card,
  fields: styles.fields,
  field: styles.field,
  label: styles.label,
  input: styles.input,
  select: styles.select,
  inputWrapper: styles.inputWrapper,
  inputWrapperTall: styles.inputWrapperTall,
  textarea: styles.textarea,
  fieldHint: styles.hint,
  error: styles.error,
  actions: styles.cardActions,
  ghost: styles.ghost,
  filled: styles.save,
  savedNote: styles.savedNote,
};

/**
 * Everything about one agent, at a URL.
 *
 * The form itself is `AgentForm`, which the workflow editor also shows in a
 * panel beside a graph - the fields are the same in both, so there is one form
 * and this page is the frame around it: a heading, a way back, and the Danger
 * Zone a panel has nowhere to put.
 */
export function AgentSettingsPage({ session, onSignOut }: AgentSettingsPageProps) {
  const { workspaceId = '', agentId = '' } = useParams();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    fetchAgent(agentId)
      .then((found) => {
        if (found === null) {
          setLoadError('That agent does not exist, or you do not have access to it.');
          return;
        }
        setAgent(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the agent.');
      });
  }, [agentId]);

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
      ) : agent === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <>
          {/*
            Keyed by which agent this is: the form reads its fields as it mounts,
            so following a link from one agent to another starts it over rather
            than leaving the previous one's values behind.
          */}
          <AgentForm
            key={agent.id}
            workspaceId={workspaceId}
            agent={agent}
            styles={FORM_STYLES}
            heading={<h2 className={styles.sectionHeading}>General</h2>}
            onSaved={setAgent}
          />

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
