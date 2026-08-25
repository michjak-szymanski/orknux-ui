import { useCallback, useEffect, useState } from 'react';

import { VERDICT_LABEL, fetchDoctor } from '../../api/doctor';
import type { DoctorCheck } from '../../api/doctor';
import type { SessionUser } from '../../api/session';
import refreshIcon from '../../assets/refresh-cw.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminDoctorPage.module.css';
import { t } from '../../i18n';

export interface AdminDoctorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * Whether this installation is configured correctly.
 *
 * Deliberately a different screen from Monitoring, because it answers a different
 * question. Monitoring asks whether things can be reached; everything can be
 * reachable and the installation still be broken. The encryption key is the case
 * that proved it: read on first use, so a server without one starts, reports itself
 * healthy, and fails the first time somebody saves a credential — which was found
 * once by reading a stack trace, forty minutes after it started happening.
 *
 * Each row is a sentence rather than a status light. Somebody reading this is
 * already wondering what is wrong, and "FAIL" on its own does not help them.
 */
export function AdminDoctorPage({ session, onSignOut }: AdminDoctorPageProps) {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchDoctor()
      .then((found) => {
        setChecks(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setChecks(null);
        setError(cause instanceof Error ? cause.message : t('Could not run the checks.'));
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  const failing = checks?.filter((check) => check.verdict === 'FAIL').length ?? 0;
  const warning = checks?.filter((check) => check.verdict === 'WARN').length ?? 0;

  return (
    <AppShell
      user={shellUser(session)}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      scrollContent
      sidebar={<AdminSidebar active="doctor" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{t('Doctor')}</h1>
            <p className={styles.subtitle}>
              {t('Whether this installation is configured correctly — which is not the same question as whether it can reach things. Monitoring answers that one.')}
            </p>
          </div>
          <button type="button" className={styles.refresh} onClick={load} title={t('Run the checks again')}>
            <img src={refreshIcon} alt="" width={14} height={14} />
            {t('Run again')}
          </button>
        </header>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {/*
          The summary says whether anything needs doing before the list says what.
          A page of green rows should be readable at a glance as "nothing to do".
        */}
        {checks !== null && (
          <p className={failing > 0 ? styles.summaryBad : warning > 0 ? styles.summaryWarn : styles.summaryOk}>
            {failing > 0
              ? `${failing} thing${failing === 1 ? '' : 's'} will fail as configured.`
              : warning > 0
                ? `Nothing is broken, but ${warning} setting${warning === 1 ? ' is' : 's are'} worth a look.`
                : t('Everything checked is configured correctly.')}
          </p>
        )}

        <div className={styles.checks}>
          {loading && (
            <p className={styles.notice}>
              <Loader />
            </p>
          )}

          {checks?.map((check) => (
            <div key={check.name} className={styles.check}>
              <span className={styles[`verdict${check.verdict}` as keyof typeof styles]}>
                {VERDICT_LABEL[check.verdict]}
              </span>
              <span className={styles.name}>{check.name}</span>
              <span className={styles.detail}>{check.detail}</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
