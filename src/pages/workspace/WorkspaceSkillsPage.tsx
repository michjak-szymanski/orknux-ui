import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import {
  createSkill,
  createSkillCatalog,
  deleteSkill,
  deleteSkillCatalog,
  fetchPluginSkillCatalogs,
  fetchSkillCatalogs,
  fetchWorkspaceSkills,
  renameSkillCatalog,
  setSkillEnabled,
} from '../../api/skills';
import type { PluginSkillCatalog, Skill, SkillCatalog } from '../../api/skills';
import { timeAgo } from '../../api/tools';
import folderOpenIcon from '../../assets/folder-open.svg';
import folderIcon from '../../assets/folder.svg';
import penIcon from '../../assets/pen.svg';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import plusIcon from '../../assets/plus.svg';
import puzzleIcon from '../../assets/puzzle.svg';
import searchIcon from '../../assets/search.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import trashIcon from '../../assets/trash-grey.svg';
import { AppShell } from '../../components/AppShell';
import {
  ExportComponentButton,
  ImportComponentsButton,
  SaveAsTemplateButton,
  UseTemplateButton,
} from '../../components/ComponentTransfer';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { NameDialog } from '../../components/NameDialog';
import { UsedBy } from '../../components/UsedBy';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceMemoryPage.module.css';
import { t } from '../../i18n';

export interface WorkspaceSkillsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * How a plugin's catalog is spelled in `selected`.
 *
 * A workspace catalog is selected by its numeric id and a plugin's has none,
 * so the prefix is what keeps one field able to hold either.
 */
const PLUGIN_PREFIX = 'plugin:';

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
  /**
   * Which catalog to open on, where somebody arrived pointed at one.
   *
   * A catalog is what an agent is granted, so the grant list on an agent's
   * settings links to it - and a link that lands on whichever catalog happens
   * to be first is a link that names one thing and opens another. Issue #251.
   * It is an opening position and not a filter: choosing another in the column
   * leaves the address alone, because a catalog somebody is reading is not a
   * place they asked to be sent.
   */
  const [addressed] = useSearchParams();
  const asked = addressed.get('catalog');

  const [catalogs, setCatalogs] = useState<SkillCatalog[] | null>(null);
  /**
   * The catalogs the loaded plugins bring, read once.
   *
   * Beside the workspace's own in the rail rather than on a screen of their
   * own: what somebody wants to know is what an agent could be given, and
   * that is one list. They are not rows — nothing here can be renamed,
   * deleted, added to or edited — so the panel draws them read-only.
   */
  const [pluginCatalogs, setPluginCatalogs] = useState<PluginSkillCatalog[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [skills, setSkills] = useState<PageOf<Skill> | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Whether the catalog column is folded away; the list is not always the work. */
  const [foldedCatalogs, setFoldedCatalogs] = useState(false);
  const [creating, setCreating] = useState(false);

  const current = catalogs?.find((catalog) => catalog.id === selected) ?? null;
  /** A plugin's catalog is selected by name behind a prefix, so ids cannot clash. */
  const currentPlugin =
    selected?.startsWith(PLUGIN_PREFIX) === true
      ? pluginCatalogs?.find((catalog) => catalog.name === selected.slice(PLUGIN_PREFIX.length)) ?? null
      : null;

  const loadCatalogs = useCallback(
    async (keep?: string) => {
      const found = await fetchSkillCatalogs(workspaceId);
      setCatalogs(found);
      // Keep the catalog that was open where it still exists; then the one the
      // address asked for, which is only ever the first time round; then the
      // first, so the panel is never showing nothing while catalogs exist.
      setSelected((held) => {
        const wanted = keep ?? held ?? asked;
        return found.find((catalog) => catalog.id === wanted)?.id ?? found[0]?.id ?? null;
      });
    },
    [workspaceId, asked],
  );

  useEffect(() => {
    if (workspaceId === '') return;
    loadCatalogs().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t('Could not load the skill catalogs.'));
    });
  }, [loadCatalogs, workspaceId]);

  const loadSkills = useCallback(async () => {
    // A plugin's catalog is not a folder in this workspace, so there is
    // nothing here to page through: its skills arrived with the catalog.
    if (selected === null || selected.startsWith(PLUGIN_PREFIX)) {
      setSkills(null);
      return;
    }
    setSkills(await fetchWorkspaceSkills(workspaceId, 0, PAGE_SIZE, selected));
  }, [workspaceId, selected]);

  useEffect(() => {
    /*
     * Its own effect, and its own failure. A plugin's catalogs being
     * unreadable is not a reason for the workspace's own to go missing, so
     * this one sets a list or leaves it empty rather than raising the error
     * the page shows.
     */
    fetchPluginSkillCatalogs()
      .then(setPluginCatalogs)
      .catch(() => setPluginCatalogs([]));
  }, []);

  useEffect(() => {
    loadSkills().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t('Could not load the skills.'));
    });
  }, [loadSkills]);

  async function guard(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That did not work.'));
    }
  }

  async function handleNewCatalog() {
    const name = window.prompt(t('Name the catalog'));
    if (name === null || name.trim() === '') return;
    await guard(async () => {
      const created = await createSkillCatalog(workspaceId, name.trim());
      await loadCatalogs(created.id);
    });
  }

  async function handleRenameCatalog() {
    if (current === null) return;
    const name = window.prompt(t('Rename the catalog'), current.name);
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
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <div className={styles.split}>
        <aside className={foldedCatalogs ? `${styles.catalogs} ${styles.catalogsCollapsed}` : styles.catalogs}>
          <header className={styles.catalogsHeader}>
            {!foldedCatalogs && <p className={styles.catalogsTitle}>{t('SKILL CATALOGS')}</p>}
            {!foldedCatalogs && (
            <button
              type="button"
              className={styles.newCatalog}
              onClick={() => void handleNewCatalog()}
              aria-label={t('New catalog')}
              title={t('New catalog')}
            >
              <img src={plusIcon} alt="" width={10} height={10} />
            </button>
            )}
          </header>

          {!foldedCatalogs && (
          <div className={styles.catalogsList}>
            {catalogs === null && <p className={styles.sidebarNote}><Loader /></p>}
            {catalogs?.length === 0 && <p className={styles.sidebarNote}>{t('No catalogs yet.')}</p>}
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

            {/*
              And what the plugins bring, under a rule so the two kinds read
              as two kinds. A plugin's catalog is granted the same way and
              carries the same skills; what it cannot do is be edited, which
              the panel says rather than the rail.
            */}
            {pluginCatalogs !== null && pluginCatalogs.length > 0 && (
              <>
                <p className={styles.sidebarNote}>{t('FROM PLUGINS')}</p>
                {pluginCatalogs.map((catalog) => {
                  const at = `${PLUGIN_PREFIX}${catalog.name}`;
                  const open = at === selected;
                  return (
                    <button
                      key={catalog.name}
                      type="button"
                      className={open ? styles.catalogCurrent : styles.catalog}
                      onClick={() => setSelected(at)}
                      aria-current={open ? 'true' : undefined}
                      title={`${catalog.name} — from the ${catalog.plugin} plugin`}
                    >
                      <img src={puzzleIcon} alt="" width={14} height={14} />
                      <span className={styles.catalogName}>{catalog.name}</span>
                      <span className={open ? styles.countCurrent : styles.count}>
                        {catalog.skills.length}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
          )}
        </aside>
        {/*
          Outside the panel, because the panel scrolls - a handle straddling
          its edge from the inside would be clipped. Same reasoning, and the
          same drawing, as the shell handle one level up (issue #118).
        */}
          <button
            type="button"
            className={foldedCatalogs ? `${styles.collapseCatalogs} ${styles.collapseCatalogsShut}` : styles.collapseCatalogs}
            onClick={() => setFoldedCatalogs((folded) => !folded)}
            aria-expanded={!foldedCatalogs}
            aria-label={foldedCatalogs ? t('Show catalogs') : t('Hide catalogs')}
            title={foldedCatalogs ? t('Show catalogs') : t('Hide catalogs')}
          >
            <span
              className={
                foldedCatalogs
                  ? `${styles.collapseIcon} ${styles.collapseIconOpen}`
                  : styles.collapseIcon
              }
              style={{
                maskImage: `url("${chevronDown12Icon}")`,
                WebkitMaskImage: `url("${chevronDown12Icon}")`,
              }}
            />
          </button>

        <section className={styles.panel}>
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {currentPlugin !== null ? (
            /*
              A plugin's catalog, read-only and saying so.

              Every action a workspace skill has is missing here because none
              of them means anything: a plugin's skills are replaced wholesale
              the next time it is loaded, so an edit would be an edit somebody
              loses without being told. What is left is what somebody actually
              came for — what the agent would read, in full.
            */
            <>
              <header className={styles.catalogHeader}>
                <h1 className={styles.catalogHeading}>{currentPlugin.name}</h1>
              </header>
              <div className={styles.rule} />

              <div className={styles.stats}>
                {/* One line, and the whole of what is different here: where
                    it came from, and that it is granted like any other. */}
                <p className={styles.statsText}>
                  {t('From the plugin')} {currentPlugin.plugin} — {t('granted by name, and not edited here.')}
                </p>
              </div>

              <div className={styles.cards}>
                {currentPlugin.skills.length === 0 && (
                  <p className={styles.empty}>{t('This plugin brings no skills.')}</p>
                )}
                {currentPlugin.skills.map((skill) => (
                  <article key={skill.name} className={styles.card}>
                    <header className={styles.cardHeader}>
                      <h2 className={styles.cardTitle}>{skill.name}</h2>
                    </header>
                    <p className={styles.cardBody}>{skill.description ?? t('No description')}</p>
                    {/*
                      The page itself, folded away. A skill is long, and a
                      catalog of them opened flat is a screen nobody reads -
                      but what it says is the only thing worth coming here
                      for, so it is one click and not a page away.
                    */}
                    <details>
                      <summary className={styles.statsText}>{t('Read it')}</summary>
                      <Markdown>{skill.content}</Markdown>
                    </details>
                  </article>
                ))}
              </div>
            </>
          ) : current === null ? (
            <p className={styles.empty}>
              {catalogs?.length === 0
                ? t('Add a catalog to start writing skills.')
                : t('Choose a catalog to see what is in it.')}
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
                    title={t('Rename')}
                  >
                    <img src={penIcon} alt="" width={14} height={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => void handleDeleteCatalog()}
                    aria-label={`Delete ${current.name}`}
                    title={t('Delete')}
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
                    placeholder={t('Search skills...')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label={t('Search skills')}
                  />
                </div>
                <ImportComponentsButton
                  workspaceId={workspaceId}
                  onImported={() =>
                    void guard(async () => {
                      // The catalogs too: an imported skill names its folder, and
                      // a folder this workspace did not have was just made.
                      await loadCatalogs();
                      await loadSkills();
                    })
                  }
                />
                <UseTemplateButton
                  workspaceId={workspaceId}
                  kind="SKILL"
                  onImported={() =>
                    void guard(async () => {
                      // The catalogs too, for the reason Import gives above.
                      await loadCatalogs();
                      await loadSkills();
                    })
                  }
                />
                <button type="button" className={styles.addMemory} onClick={() => setCreating(true)}>{t('+ Add Skill')}</button>
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
                    {search !== '' ? t('Nothing here matches that.') : t('No skills in this catalog yet.')}
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
                        <ExportComponentButton
                          workspaceId={workspaceId}
                          kind="SKILL"
                          id={skill.id}
                          name={skill.name}
                          className={styles.iconButton}
                        />
                        <SaveAsTemplateButton
                          workspaceId={workspaceId}
                          kind="SKILL"
                          id={skill.id}
                          name={skill.name}
                          className={styles.iconButton}
                          canPublish={session.admin}
                        />
                        <Link
                          className={styles.iconButton}
                          to={`/workspace/${workspaceId}/skills/${skill.id}`}
                          aria-label={`Edit ${skill.name}`}
                          title={t('Edit')}
                        >
                          <img src={penIcon} alt="" width={14} height={14} />
                        </Link>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => void handleDeleteSkill(skill)}
                          aria-label={`Delete ${skill.name}`}
                          title={t('Delete')}
                        >
                          <img src={trashIcon} alt="" width={14} height={14} />
                        </button>
                      </div>
                    </header>
                    <p className={styles.cardBody}>{skill.description ?? t('No description')}</p>
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

              {/*
                Which agents are granted this catalog, under what is in it.

                The folder is what an agent is granted, so the folder is what
                the question is asked about - the same unit the delete guard
                refuses on. Under the skills rather than over them: somebody
                opens a catalog to read it, and this is what they want at the
                point they are thinking of taking it away.
              */}
              <section className={styles.card}>
                <UsedBy key={current.id} kind="SKILL_CATALOG" componentId={current.id} />
              </section>
            </>
          )}
        </section>
      </div>

      <NameDialog
        open={creating}
        title={t('Create Skill')}
        message={t("A skill is markdown telling an agent how to go about something.")}
        nameLabel="Name"
        namePlaceholder="codeReviewGuidelines"
        descriptionPlaceholder={t("Guidelines for thorough and consistent code reviews")}
        submitLabel={t("Create Skill")}
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
