import { useCallback, useEffect, useState } from 'react';

import type { PageOf } from '../../api/client';
import { connectionTypeLabel, fetchConnections } from '../../api/integrations';
import type { Connection } from '../../api/integrations';
import type { SessionUser } from '../../api/session';
import plusIcon from '../../assets/plus.svg';
import settingsIcon from '../../assets/settings.svg';
import { AppShell } from '../../components/AppShell';
import { ConnectionDialog } from '../../components/ConnectionDialog';
import { ConnectionIcon } from '../../components/ConnectionIcon';
import { FieldHint } from '../../components/FieldHint';
import { AdminSidebar } from '../../components/AdminSidebar';
import { Loader } from '../../components/Loader';
import { Pagination } from '../../components/Pagination';
import { shellUser } from '../../session/user';
import styles from './AdminIntegrationsPage.module.css';

export interface AdminIntegrationsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 4;

/** The admin's default connections, assigned to workspaces as they are created. */
export function AdminIntegrationsPage({ session, onSignOut }: AdminIntegrationsPageProps) {
  const [connections, setConnections] = useState<PageOf<Connection> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // False when closed, true when adding, the connection itself when editing.
  const [dialog, setDialog] = useState<boolean | Connection>(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchConnections(page - 1, PAGE_SIZE)
      .then((result) => {
        setConnections(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setConnections(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the connections.');
        setLoading(false);
      });
  }, [page]);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="integrations" />}
    >
      <header className={styles.titleBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            <span className={styles.titleWithHint}>
              Integrations
              {/*
                What was a footer under the table, carrying the same information
                behind the same kind of control as every other explanation in
                the product. Two icon conventions for one job is the
                inconsistency this is here to end.
              */}
              <FieldHint label="Integrations">
                Default connections are automatically provisioned when a new workspace is created.
                Workspaces can override credentials in their own integration settings.
              </FieldHint>
            </span>
          </h1>
          <p className={styles.subtitle}>Define default connections that are automatically assigned to new workspaces</p>
        </div>
        <button type="button" className={styles.addConnection} onClick={() => setDialog(true)}>
          <img src={plusIcon} alt="" width={14} height={14} />
          Add Default Connection
        </button>
      </header>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colName}>Name</span>
          <span className={styles.colType}>Type</span>
          <span className={styles.colUrl}>URL</span>
          <span className={styles.colActions}>Actions</span>
        </div>

        {loading && <p className={styles.notice}><Loader /></p>}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && connections?.content.length === 0 && (
          <p className={styles.notice}>No default connections yet.</p>
        )}

        {connections?.content.map((connection) => (
          <div key={connection.id} className={styles.row}>
            <span className={styles.colName}>
              <ConnectionIcon type={connection.type} />
              <span className={styles.name}>{connection.name}</span>
            </span>
            <span className={`${styles.colType} ${styles.type}`}>{connectionTypeLabel(connection.type)}</span>
            <span className={`${styles.colUrl} ${styles.url}`}>{connection.url}</span>
            <span className={styles.colActions}>
              <button
                type="button"
                className={styles.rowAction}
                onClick={() => setDialog(connection)}
                aria-label={`Settings for ${connection.name}`}
                title={`Settings for ${connection.name}`}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </button>
            </span>
          </div>
        ))}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={connections?.totalElements ?? 0}
          onPageChange={setPage}
          label="default connections"
        />
      </section>

      <ConnectionDialog
        open={dialog}
        onClose={() => setDialog(false)}
        onSaved={() => {
          setDialog(false);
          load();
        }}
      />
    </AppShell>
  );
}
