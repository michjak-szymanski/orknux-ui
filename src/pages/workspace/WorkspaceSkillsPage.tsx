import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import {
  createSkill,
  createSkillCatalog,
  deleteSkill,
  deleteSkillCatalog,
  fetchSkillCatalogs,
  fetchWorkspaceSkills,
  renameSkillCatalog,
  setSkillEnabled,
} from '../../api/skills';
import type { Skill, SkillCatalog } from '../../api/skills';
import { timeAgo } from '../../api/tools';
import folderOpenIcon from '../../assets/folder-open.svg';
import folderIcon from '../../assets/folder.svg';
import penIcon from '../../assets/pen.svg';
import panelCollapseIcon from '../../assets/panel-collapse.svg';
import plusIcon from '../../assets/plus.svg';
import searchIcon from '../../assets/search.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import trashIcon from '../../assets/trash-grey.svg';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { NameDialog } from '../../components/NameDialog';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceMemoryPage.module.css';

export interface WorkspaceSkillsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** A catalog is a page's worth; the search box filters what is already here. */
const PAGE_SIZE = 50;

/**
 * The workspace's skills: catalogs on the left, what is in the selected one on
 * the right.
 *
 * The same shape as Memory, and deliberately the same stylesheet — the two
 * screens answer the same question about different things, and a second layout
 * for it would be a second thing to keep in step. The catalog is the unit an
 * agent is granted, which is why it is the unit shown.
 */
export function WorkspaceSkillsPage({ session, onSignOut }: WorkspaceSkillsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [catalogs, setCatalogs] = useState<SkillCatalog[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [skills, setSkills] = useState<PageOf<Skill> | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Whether the catalog column is folded away; the list is not always the work. */
  const [foldedCatalogs, setFoldedCatalogs] = useState(false);
  const [creating, setCreating] = useState(false);

  const current = catalogs?.find((catalog) => catalog.id === selected) ?? null;

  const loadCatalogs = useCallback(
    async (keep?: string) => {
      const found = await fetchSkillCatalogs(workspaceId);
      setCatalogs(found);
      // Keep the catalog that was open where it still exists; otherwise the
      // first, so the panel is never showing nothing while catalogs exist.
      setSelected((held) => {
        const wanted = keep ?? held;
        return found.find((catalog) => catalog.id === wanted)?.id ?? found[0]?.id ?? null;
      });
    },
    [workspaceId],
  );

  useEffect(() => {
    if (workspaceId === '') return;
    loadCatalogs().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load the skill catalogs.');
    });
  }, [loadCatalogs, workspaceId]);

  const loadSkills = useCallback(async () => {
    if (selected === null) {
      setSkills(null);
      return;
    }
    setSkills(await fetchWorkspaceSkills(workspaceId, 0, PAGE_SIZE, selected));
  }, [workspaceId, selected]);

  useEffect(() => {
    loadSkills().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load the skills.');
    });
  }, [loadSkills]);

  async function guard(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    }
  }

  async function handleNewCatalog() {
    const name = window.prompt('Name the catalog');
    if (name === null || name.trim() === '') return;
    await guard(async () => {
      const created = await createSkillCatalog(workspaceId, name.trim());
      await loadCatalogs(created.id);
    });
  }

  async function handleRenameCatalog() {
    if (current === null) return;
    const name = window.prompt('Rename the catalog', current.name);
    if (name === null || name.trim() === '' || name.trim() === current.name) return;
    await guard(async () => {
      await renameSkillCatalog(current.id, name.trim());
      await loadCatalogs(current.id);
    });
  }

  async function handleDeleteCatalog() {
    if (current === null) return;
    const held = current.skillCount;
    const warning =
      held === 0
        ? `Delete ${current.name}?`
        : `Delete ${current.name} and the ${held} ${held === 1 ? 'skill' : 'skills'} in it?`;
    if (!window.confirm(warning)) return;
    await guard(async () => {
      await deleteSkillCatalog(current.id);
      await loadCatalogs();
    });
  }

  async function handleDeleteSkill(skill: Skill) {
    if (!window.confirm(`Delete "${skill.name}"?`)) return;
    await guard(async () => {
      await deleteSkill(skill.id);
      await loadSkills();
      await loadCatalogs(selected ?? undefined);
    });
  }

  // Filtered here rather than by the server: a catalog is a page's worth, and
  // the box is for finding one you can already see.
  const showing = (skills?.content ?? []).filter((skill) =>
    search.trim() === ''
      ? true
      : `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="skills" />}
    >
      <div className={styles.split}>
        <aside className={foldedCatalogs ? `${styles.catalogs} ${styles.catalogsCollapsed}` : styles.catalogs}>
          <header className={styles.catalogsHeader}>
            {!foldedCatalogs && <p className={styles.catalogsTitle}>SKILL CATALOGS</p>}
            <button
              type="button"
              className={styles.collapseCatalogs}
              onClick={() => setFoldedCatalogs((folded) => !folded)}
              aria-expanded={!foldedCatalogs}
              aria-label={foldedCatalogs ? 'Show catalogs' : 'Hide catalogs'}
              title={foldedCatalogs ? 'Show catalogs' : 'Hide catalogs'}
            >
              <span
                className={
                  foldedCatalogs
                    ? `${styles.collapseIcon} ${styles.collapseIconOpen}`
                    : styles.collapseIcon
                }
                style={{
                  maskImage: `url("${panelCollapseIcon}")`,
                  WebkitMaskImage: `url("${panelCollapseIcon}")`,
                }}
              />
            </button>
            {!foldedCatalogs && (
            <button
              type="button"
              className={styles.newCatalog}
              onClick={() => void handleNewCatalog()}
              aria-label="New catalog"
              title="New catalog"
            >
              <img src={plusIcon} alt="" width={10} height={10} />
            </button>
            )}
          </header>

          {!foldedCatalogs && (
          <div className={styles.catalogsList}>
            {catalogs === null && <p className={styles.sidebarNote}><Loader /></p>}
            {catalogs?.length === 0 && <p className={styles.sidebarNote}>No catalogs yet.</p>}
            {catalogs?.map((catalog) => {
              const open = catalog.id === selected;
              return (
                <button
                  key={catalog.id}
                  type="button"
                  className={open ? styles.catalogCurrent : styles.catalog}
                  onClick={() => setSelected(catalog.id)}
                  aria-current={open ? 'true' : undefined}
                >
                  <img src={open ? folderOpenIcon : folderIcon} alt="" width={14} height={14} />
                  <span className={styles.catalogName}>{catalog.name}</span>
                  <span className={open ? styles.countCurrent : styles.count}>{catalog.skillCount}</span>
                </button>
              );
            })}
          </div>
          )}
        </aside>

        <section className={styles.panel}>
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {current === null ? (
            <p className={styles.empty}>
              {catalogs?.length === 0
                ? 'Add a catalog to start writing skills.'
                : 'Choose a catalog to see what is in it.'}
            </p>
          ) : (
            <>
              <header className={styles.catalogHeader}>
                <h1 className={styles.catalogHeading}>{current.name}</h1>
                <div className={styles.catalogActions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => void handleRenameCatalog()}
                    aria-label={`Rename ${current.name}`}
                    title="Rename"
                  >
                    <img src={penIcon} alt="" width={14} height={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => void handleDeleteCatalog()}
                    aria-label={`Delete ${current.name}`}
                    title="Delete"
                  >
                    <img src={trashIcon} alt="" width={14} height={14} />
                  </button>
                </div>
              </header>
              <div className={styles.rule} />

              <div className={styles.toolbar}>
                <div className={styles.searchBox}>
                  <img src={searchIcon} alt="" width={14} height={14} />
                  <input
                    className={styles.searchInput}
                    type="search"
                    placeholder="Search skills..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Search skills"
                  />
                </div>
                <button type="button" className={styles.addMemory} onClick={() => setCreating(true)}>
                  + Add Skill
                </button>
              </div>

              <div className={styles.stats}>
                <p className={styles.statsText}>
                  {showing.length === 0
                    ? `Nothing in ${current.name} yet`
                    : `Showing ${showing.length} ${showing.length === 1 ? 'skill' : 'skills'} in ${current.name}`}
                </p>
              </div>

              <div className={styles.cards}>
                {showing.length === 0 && (
                  <p className={styles.empty}>
                    {search !== '' ? 'Nothing here matches that.' : 'No skills in this catalog yet.'}
                  </p>
                )}
                {showing.map((skill) => (
                  <article key={skill.id} className={styles.card}>
                    <header className={styles.cardHeader}>
                      <h2 className={styles.cardTitle}>
                        <Link className={styles.cardTitleLink} to={`/workspace/${workspaceId}/skills/${skill.id}`}>
                          {skill.name}
                        </Link>
                      </h2>
                      <div className={styles.cardActions}>
                        {/* A skill can be left defined but out of reach, which is
                            what the toggle is for; which catalog it is in does
                            not change either way. */}
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() =>
                            void guard(async () => {
                              await setSkillEnabled(skill.id, !skill.enabled);
                              await loadSkills();
                            })
                          }
                          role="switch"
                          aria-checked={skill.enabled}
                          aria-label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`}
                          title={skill.enabled ? 'Disable' : 'Enable'}
                        >
                          <img
                            src={skill.enabled ? toggleOnIcon : toggleOffIcon}
                            alt=""
                            width={36}
                            height={20}
                            data-keeps-colour
                          />
                        </button>
                        <Link
                          className={styles.iconButton}
                          to={`/workspace/${workspaceId}/skills/${skill.id}`}
                          aria-label={`Edit ${skill.name}`}
                          title="Edit"
                        >
                          <img src={penIcon} alt="" width={14} height={14} />
                        </Link>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => void handleDeleteSkill(skill)}
                          aria-label={`Delete ${skill.name}`}
                          title="Delete"
                        >
                          <img src={trashIcon} alt="" width={14} height={14} />
                        </button>
                      </div>
                    </header>
                    <p className={styles.cardBody}>{skill.description ?? 'No description'}</p>
                    <footer className={styles.cardFooter}>
                      <span className={styles.author}>
                        <span className={styles.avatar} aria-hidden="true">
                          {skill.lastModifiedBy.slice(0, 1).toUpperCase()}
                        </span>
                        {timeAgo(skill.lastModifiedAt)} by {skill.lastModifiedBy}
                      </span>
                    </footer>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <NameDialog
        open={creating}
        title="Create Skill"
        message="A skill is markdown telling an agent how to go about something."
        nameLabel="Name"
        namePlaceholder="codeReviewGuidelines"
        descriptionPlaceholder="Guidelines for thorough and consistent code reviews"
        submitLabel="Create Skill"
        onClose={() => setCreating(false)}
        onSubmit={async (name, description) => {
          const created = await createSkill(workspaceId, {
            name,
            description: description || undefined,
            // Into the catalog that is open, which is the one being looked at.
            catalogId: selected ?? undefined,
          });
          navigate(`/workspace/${workspaceId}/skills/${created.id}`);
        }}
      />
    </AppShell>
  );
}
