import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  authLabel,
  connectionTypeLabel,
  fetchMcpServers,
  fetchWorkspaceConnections,
  statusLabel,
} from '../../api/integrations';
import type { ConnectionStatus, McpServer, WorkspaceConnection } from '../../api/integrations';
import type { SessionUser } from '../../api/session';
import settingsIcon from '../../assets/settings-14.svg';
import { AppShell } from '../../components/AppShell';
import { ConnectionIcon } from '../../components/ConnectionIcon';
import { Loader } from '../../components/Loader';
import { McpServerDialog } from '../../components/McpServerDialog';
import { WorkspaceConnectionDialog } from '../../components/WorkspaceConnectionDialog';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceIntegrationsPage.module.css';

export interface WorkspaceIntegrationsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** Green once the service answered, red when a check failed, grey until then. */
function statusDot(status: ConnectionStatus): string {
  switch (status) {
    case 'CONNECTED':
      return styles.dotConnected;
    case 'FAILED':
      return styles.dotFailed;
    default:
      return styles.dotIdle;
  }
}

export function WorkspaceIntegrationsPage({ session, onSignOut }: WorkspaceIntegrationsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [connections, setConnections] = useState<WorkspaceConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingServer, setAddingServer] = useState(false);
  const [addingConnection, setAddingConnection] = useState(false);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setError(null);
    Promise.all([fetchMcpServers(workspaceId), fetchWorkspaceConnections(workspaceId)])
      .then(([loadedServers, loadedConnections]) => {
        setServers(loadedServers);
        setConnections(loadedConnections);
      })
      .catch((cause: unknown) => {
        setServers(null);
        setConnections(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the integrations.');
      });
  }, [workspaceId]);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.contentHeader}>
        <h1 className={styles.title}>Integrations</h1>
        <p className={styles.subtitle}>Manage external service connections and MCP servers</p>
      </header>

      {error !== null && (
        <p className={styles.pageError} role="alert">
          {error}
        </p>
      )}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>MCP Servers</h2>
          <button type="button" className={styles.addButton} onClick={() => setAddingServer(true)}>
            + Add Server
          </button>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colName}>Name</span>
          <span className={styles.colGrow}>Address</span>
          <span className={styles.colMeta}>Auth</span>
          <span className={styles.colActions}>Actions</span>
        </div>

        {servers === null && error === null && <p className={styles.notice}><Loader /></p>}
        {servers?.length === 0 && <p className={styles.notice}>No MCP servers yet.</p>}

        {servers?.map((server) => (
          <div
            key={server.id}
            className={`${styles.row} ${styles.rowOpens}`}
            onClick={() => navigate(`/workspace/${workspaceId}/integrations/servers/${server.id}`)}
          >
            <Link
              className={`${styles.colName} ${styles.serverName} ${styles.openName}`}
              to={`/workspace/${workspaceId}/integrations/servers/${server.id}`}
            >
              {server.name}
            </Link>
            <span className={`${styles.colGrow} ${styles.address}`}>{server.address}</span>
            <span className={`${styles.colMeta} ${styles.meta}`}>
              {authLabel(server.authType, server.secretSet)}
            </span>
            <span className={styles.colActions}>
              <Link
                className={styles.rowAction}
                to={`/workspace/${workspaceId}/integrations/servers/${server.id}`}
                aria-label={`Settings for ${server.name}`}
                title={`Settings for ${server.name}`}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitles}>
            <h2 className={styles.cardTitle}>Connections</h2>
            <p className={styles.cardSubtitle}>
              Connections inherited from admin defaults. Override credentials per connection.
            </p>
          </div>
          <button type="button" className={styles.addButton} onClick={() => setAddingConnection(true)}>
            + Add Connection
          </button>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colName}>Name</span>
          <span className={styles.colGrow}>Type</span>
          <span className={styles.colMeta}>Status</span>
          <span className={styles.colActions}>Actions</span>
        </div>

        {connections === null && error === null && <p className={styles.notice}><Loader /></p>}
        {connections?.length === 0 && <p className={styles.notice}>No connections yet.</p>}

        {connections?.map((connection) => (
          // The whole row opens it: a cog at the far right is a small target
          // for the only thing anybody wants from a row.
          <div
            key={connection.id}
            className={`${styles.row} ${styles.rowOpens}`}
            onClick={() => navigate(`/workspace/${workspaceId}/integrations/connections/${connection.id}`)}
          >
            <Link
              className={`${styles.colName} ${styles.openName}`}
              to={`/workspace/${workspaceId}/integrations/connections/${connection.id}`}
            >
              <ConnectionIcon type={connection.type} bare />
              <span className={styles.connectionName}>{connection.name}</span>
            </Link>
            <span
              className={`${styles.colGrow} ${connection.status === 'CONNECTED' ? styles.type : styles.typeMuted}`}
            >
              {connectionTypeLabel(connection.type)}
            </span>
            <span className={`${styles.colMeta} ${styles.status}`} title={connection.lastCheckMessage ?? undefined}>
              <span className={statusDot(connection.status)} aria-hidden="true" />
              {statusLabel(connection.status)}
            </span>
            <span className={styles.colActions}>
              <Link
                className={styles.rowAction}
                to={`/workspace/${workspaceId}/integrations/connections/${connection.id}`}
                aria-label={`Settings for ${connection.name}`}
                title={`Settings for ${connection.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}
      </section>

      <McpServerDialog
        open={addingServer}
        workspaceId={workspaceId}
        onClose={() => setAddingServer(false)}
        onCreated={() => {
          setAddingServer(false);
          load();
        }}
      />
      <WorkspaceConnectionDialog
        open={addingConnection}
        workspaceId={workspaceId}
        onClose={() => setAddingConnection(false)}
        onCreated={() => {
          setAddingConnection(false);
          load();
        }}
      />
    </AppShell>
  );
}
