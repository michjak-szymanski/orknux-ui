import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import type { ComponentTemplate } from '../../api/templates';
import { contentsSummary, fetchComponentTemplates } from '../../api/templates';
import infoIcon from '../../assets/info.svg';
import plusIcon from '../../assets/plus.svg';
import settingsIcon from '../../assets/settings.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminTemplatesPage.module.css';

export interface AdminTemplatesPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * The components this installation publishes, for every workspace to take.
 *
 * A template is an exported component kept under a name — the same file the
 * Export control on a catalogue page downloads. Nothing on this page describes a
 * second format, and nothing here creates components: what a row holds is read
 * out of its stored envelope, and Use template on a workspace's own page is the
 * import that already existed, pointed at the row.
 *
 * The sentence that matters most on this screen is that a template is a copy.
 * Everybody who sees a list of named things next to the things they were made
 * from assumes the two follow each other; these do not, and being told once here
 * is cheaper than finding out when a fix does not travel.
 */
export function AdminTemplatesPage({ session, onSignOut }: AdminTemplatesPageProps) {
  const [templates, setTemplates] = useState<ComponentTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchComponentTemplates()
      .then((result) => {
        setTemplates(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setTemplates(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the templates.');
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  const listed = templates ?? [];

  return (
    <AppShell
      user={shellUser(session)}
      section="admin"
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="templates" />}
    >
      <header className={styles.titleBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Templates</h1>
          <p className={styles.subtitle}>
            Components published for the whole installation. Any workspace can take one from Use
            template on its own Functions, Objects, Conditions, Tools or Skills page, which creates
            copies there and changes nothing that is already in it.
          </p>
        </div>
        <Link className={styles.addTemplate} to="/admin/templates/new">
          <img src={plusIcon} alt="" width={14} height={14} />
          New Template
        </Link>
      </header>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <div className={styles.colName}>Name</div>
          <div className={styles.colHolds}>Holds</div>
          <div className={styles.colVersion}>Format</div>
          <div className={styles.colWho}>Published by</div>
          <div className={styles.colActions} />
        </div>

        {loading && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && listed.length === 0 && (
          <p className={styles.notice}>
            No templates yet. Export a function, an object, a condition, a tool or a skill from a
            workspace and publish the file here — or use Save as template on the component itself.
          </p>
        )}

        {listed.map((template) => (
          <div className={styles.row} key={template.id}>
            <div className={styles.colName}>
              <span className={styles.name}>{template.name}</span>
              {template.description !== null && (
                <span className={styles.description}>{template.description}</span>
              )}
            </div>
            <div className={styles.colHolds}>
              <span className={styles.holds}>{contentsSummary(template)}</span>
            </div>
            <div className={styles.colVersion}>
              {/*
                A template written by a newer Orknux than this one is still
                listed. It says so here rather than throwing out of the button
                somebody presses on it a week later.
              */}
              {template.usable ? (
                <span className={styles.version}>Version {template.formatVersion}</span>
              ) : (
                <span className={styles.unusable} title={template.problem ?? undefined}>
                  Cannot be read
                </span>
              )}
            </div>
            <div className={styles.colWho}>
              <span className={styles.who}>{template.createdBy}</span>
            </div>
            <div className={styles.colActions}>
              <Link
                className={styles.rowAction}
                to={`/admin/templates/${template.id}`}
                aria-label={`Edit ${template.name}`}
                title="Edit"
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </div>
          </div>
        ))}
      </section>

      <p className={styles.disclaimer}>
        <img src={infoIcon} alt="" width={14} height={14} />
        A template holds a copy of the components as they were when it was published, and follows
        nothing: editing the function one was made from does not change the template, and deleting a
        template does not touch what it has already created in a workspace. Replacing its file is how
        one is brought up to date. Nothing secret is ever inside — a variable a function is handed
        travels as a name, and the workspace it lands in supplies its own value.
      </p>
    </AppShell>
  );
}
