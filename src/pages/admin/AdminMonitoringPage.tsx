import { useCallback, useEffect, useState } from 'react';

import { fetchComponents, uiComponent } from '../../api/monitoring';
import type { Component, ComponentStatus } from '../../api/monitoring';
import type { SessionUser } from '../../api/session';
import refreshIcon from '../../assets/refresh-cw.svg';
import { AppShell } from '../../components/AppShell';
import { AdminSidebar } from '../../components/AdminSidebar';
import { shellUser } from '../../session/user';
import styles from './AdminMonitoringPage.module.css';

export interface AdminMonitoringPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const STATUS_LABEL: Record<ComponentStatus, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  DOWN: 'Down',
};

/** Each of the platform's services, and what it last said about itself. */
export function AdminMonitoringPage({ session, onSignOut }: AdminMonitoringPageProps) {
  const [components, setComponents] = useState<Component[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    fetchComponents()
      // The browser speaks for itself; the server cannot see it.
      .then((fromServer) => setComponents([...fromServer, uiComponent()]))
      .catch((cause: unknown) => {
        // The service is what could not be read; the interface is plainly up.
        setComponents([uiComponent()]);
        setError(cause instanceof Error ? cause.message : 'Could not read the component status.');
      })
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(load, [load]);

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="monitoring" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Monitoring</h1>
            <p className={styles.subtitle}>System health and component status.</p>
          </div>
          <button type="button" className={styles.refresh} onClick={load} disabled={refreshing}>
            <img src={refreshIcon} alt="" width={14} height={14} />
            {refreshing ? 'Checking…' : 'Refresh Stats'}
          </button>
        </header>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {components === null && error === null && <p className={styles.notice}>Checking…</p>}

        <div className={styles.components}>
          {components?.map((component) => (
            <article key={component.name} className={styles.component}>
              <div className={styles.componentTop}>
                <div className={styles.identity}>
                  <span className={statusDot(component.status)} aria-hidden="true" />
                  <h2 className={styles.componentName}>{component.name}</h2>
                </div>
                <span className={statusBadge(component.status)}>{STATUS_LABEL[component.status]}</span>
              </div>

              <p className={styles.description}>{component.description}</p>

              <hr className={styles.divider} />

              <dl className={styles.metrics}>
                <div className={styles.metric}>
                  <dt className={styles.metricLabel}>Version</dt>
                  <dd className={styles.metricValue}>{formatVersion(component.version)}</dd>
                </div>
                <div className={styles.metric}>
                  <dt className={styles.metricLabel}>Last checked</dt>
                  <dd className={styles.metricMuted}>{formatRelative(component.lastCheckedAt)}</dd>
                </div>
                <div className={styles.metric}>
                  <dt className={styles.metricLabel}>Detail</dt>
                  <dd className={styles.metricMuted}>{component.detail}</dd>
                </div>
              </dl>

              {component.dependencies.length > 0 && (
                <ul className={styles.dependencies}>
                  {component.dependencies.map((dependency) => (
                    <li key={dependency.name} className={styles.dependency}>
                      <span
                        className={dependency.reachable ? styles.depDotUp : styles.depDotDown}
                        aria-hidden="true"
                      />
                      <span className={styles.depName}>{dependency.name}</span>
                      <span className={styles.depDescription}>{dependency.description}</span>
                      <span className={styles.depDetail}>{dependency.detail}</span>
                      {/* Its own screen, where it has one worth going to. */}
                      {dependency.url != null && dependency.url !== '' && (
                        <a
                          className={styles.depLink}
                          href={dependency.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

/** Green while it answers, amber when something it needs does not, red when it is gone. */
function statusDot(status: ComponentStatus): string {
  switch (status) {
    case 'HEALTHY':
      return `${styles.statusDot} ${styles.dotHealthy}`;
    case 'DEGRADED':
      return `${styles.statusDot} ${styles.dotDegraded}`;
    case 'DOWN':
      return `${styles.statusDot} ${styles.dotDown}`;
  }
}

function statusBadge(status: ComponentStatus): string {
  switch (status) {
    case 'HEALTHY':
      return `${styles.badge} ${styles.badgeHealthy}`;
    case 'DEGRADED':
      return `${styles.badge} ${styles.badgeDegraded}`;
    case 'DOWN':
      return `${styles.badge} ${styles.badgeDown}`;
  }
}

/** "1.0.0-SNAPSHOT" -> "v1.0.0-SNAPSHOT"; a service that did not answer has none. */
function formatVersion(version: string | null): string {
  if (version === null || version.trim() === '') return '—';
  return version.startsWith('v') ? version : `v${version}`;
}

/** "just now", "2 min ago" — the check is as fresh as the page. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
