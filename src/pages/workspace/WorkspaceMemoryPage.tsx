import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import {
  createMemoryCatalog,
  deleteMemory,
  deleteMemoryCatalog,
  fetchMemories,
  fetchMemoryAuthors,
  fetchMemoryCatalogs,
  memoryDate,
  renameMemoryCatalog,
} from '../../api/memory';
import type { Memory, MemoryCatalog, MemorySort } from '../../api/memory';
import type { SessionUser } from '../../api/session';
import arrowDownIcon from '../../assets/arrow-down-narrow-wide.svg';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import folderOpenIcon from '../../assets/folder-open.svg';
import folderIcon from '../../assets/folder.svg';
import penIcon from '../../assets/pen.svg';
import plusIcon from '../../assets/plus.svg';
import searchIcon from '../../assets/search.svg';
import slidersIcon from '../../assets/sliders-horizontal.svg';
// The grey trash from the design, not the red one the delete dialogs use: on a
// row it sits beside an edit pencil as one action among several, and a red icon
// on every card reads as a warning about the card rather than about deleting it.
import trashIcon from '../../assets/trash-grey.svg';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceMemoryPage.module.css';
import { t } from '../../i18n';

export interface WorkspaceMemoryPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** What the grid can be ordered by, and what the control calls each one. */
const SORTS: { value: MemorySort; label: string }[] = [
  { value: 'LAST_MODIFIED', label: t('Last Modified') },
  { value: 'CREATED', label: t('Date Added') },
  { value: 'TITLE', label: 'Title' },
];

/** Five to a page, as the design shows. */
const PAGE_SIZE = 5;

/**
 * The workspace's memory: catalogs on the left, what is in the selected one on
 * the right.
 *
 * Filtering, sorting and paging are the server's — the catalog is the unit that
 * is paged through, and doing it here would mean holding every memory in the
 * browser to show five of them.
 */
export function WorkspaceMemoryPage({ session, onSignOut }: WorkspaceMemoryPageProps) {
  const { workspaceId = '' } = useParams();
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

  const [catalogs, setCatalogs] = useState<MemoryCatalog[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [search, setSearch] = useState('');
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState<MemorySort>('LAST_MODIFIED');
  const [page, setPage] = useState(0);

  const [error, setError] = useState<string | null>(null);

  const current = catalogs?.find((catalog) => catalog.id === selected) ?? null;

  const loadCatalogs = useCallback(
    async (keep?: string) => {
      const found = await fetchMemoryCatalogs(workspaceId);
      setCatalogs(found);
      // Keep the catalog that was open where it still exists; then the one the
      // address asked for, which is only ever the first time round; then the
      // first, so the panel is never showing nothing while catalogs exist.
      setSelected((present) => {
        const wanted = keep ?? present ?? asked;
        return found.find((catalog) => catalog.id === wanted)?.id ?? found[0]?.id ?? null;
      });
    },
    [workspaceId, asked],
  );

  useEffect(() => {
    loadCatalogs().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t('Could not load the memory catalogs.'));
    });
  }, [loadCatalogs]);

  const loadMemories = useCallback(async () => {
    if (selected === null) {
      setMemories([]);
      setTotal(0);
      setTotalPages(0);
      return;
    }
    const found = await fetchMemories(selected, { search, author, sort, page, size: PAGE_SIZE });
    setMemories(found.content);
    setTotal(found.totalElements);
    setTotalPages(found.totalPages);
  }, [selected, search, author, sort, page]);

  useEffect(() => {
    loadMemories().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t('Could not load the memories.'));
    });
  }, [loadMemories]);

  // The filter offers the authors of this catalog, so it changes with it.
  useEffect(() => {
    if (selected === null) {
      setAuthors([]);
      return;
    }
    fetchMemoryAuthors(selected).then(setAuthors).catch(() => setAuthors([]));
  }, [selected, total]);

  /** Anything that changes what is being shown starts again at the first page. */
  function choose(catalogId: string) {
    setSelected(catalogId);
    setSearch('');
    setAuthor('');
    setPage(0);
  }

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
      const created = await createMemoryCatalog(workspaceId, name.trim());
      await loadCatalogs(created.id);
    });
  }

  async function handleRenameCatalog() {
    if (current === null) return;
    const name = window.prompt(t('Rename the catalog'), current.name);
    if (name === null || name.trim() === '' || name.trim() === current.name) return;
    await guard(async () => {
      await renameMemoryCatalog(current.id, name.trim());
      await loadCatalogs(current.id);
    });
  }

  async function handleDeleteCatalog() {
    if (current === null) return;
    const held = current.memoryCount;
    const warning =
      held === 0
        ? `Delete ${current.name}?`
        : `Delete ${current.name} and the ${held} ${held === 1 ? 'memory' : 'memories'} in it?`;
    if (!window.confirm(warning)) return;
    await guard(async () => {
      await deleteMemoryCatalog(current.id);
      await loadCatalogs();
    });
  }

  async function handleDeleteMemory(memory: Memory) {
    if (!window.confirm(`Delete "${memory.title}"?`)) return;
    await guard(async () => {
      await deleteMemory(memory.id);
      await loadMemories();
      await loadCatalogs(selected ?? undefined);
    });
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <div className={styles.split}>
        <aside className={styles.catalogs}>
          <header className={styles.catalogsHeader}>
            <p className={styles.catalogsTitle}>{t('MEMORY CATALOGS')}</p>
            <button
              type="button"
              className={styles.newCatalog}
              onClick={() => void handleNewCatalog()}
              aria-label={t('New catalog')}
              title={t('New catalog')}
            >
              <img src={plusIcon} alt="" width={10} height={10} />
            </button>
          </header>

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
                  onClick={() => choose(catalog.id)}
                  aria-current={open ? 'true' : undefined}
                >
                  <img src={open ? folderOpenIcon : folderIcon} alt="" width={14} height={14} />
                  <span className={styles.catalogName}>{catalog.name}</span>
                  <span className={open ? styles.countCurrent : styles.count}>{catalog.memoryCount}</span>
                </button>
              );
            })}
          </div>
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
                ? t('Add a catalog to start writing things down.')
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
                    placeholder={t('Search memories...')}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(0);
                    }}
                    aria-label={t('Search memories')}
                  />
                </div>
                <div className={styles.selectBox}>
                  <img src={slidersIcon} alt="" width={14} height={14} />
                  <select
                    className={styles.select}
                    value={author}
                    onChange={(event) => {
                      setAuthor(event.target.value);
                      setPage(0);
                    }}
                    aria-label={t('Filter by author')}
                  >
                    <option value="">{t('All Authors')}</option>
                    {authors.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={10} height={10} />
                </div>
                <Link
                  className={styles.addMemory}
                  to={`/workspace/${workspaceId}/memory/new?catalog=${current.id}`}
                >{t('+ Add Memory')}</Link>
              </div>

              <div className={styles.stats}>
                <p className={styles.statsText}>
                  {total === 0
                    ? `Nothing in ${current.name} yet`
                    : `Showing ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} in ${current.name}`}
                </p>
                <div className={styles.sortBy}>
                  <span className={styles.statsText}>{t('Sort by:')}</span>
                  <select
                    className={styles.sortSelect}
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as MemorySort);
                      setPage(0);
                    }}
                    aria-label={t('Sort memories')}
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <img src={arrowDownIcon} alt="" width={10} height={10} />
                </div>
              </div>

              <div className={styles.cards}>
                {memories.length === 0 && (
                  <p className={styles.empty}>
                    {search !== '' || author !== ''
                      ? t('Nothing here matches that.')
                      : t('Nothing written down here yet.')}
                  </p>
                )}
                {memories.map((memory) => (
                  <article key={memory.id} className={styles.card}>
                    <header className={styles.cardHeader}>
                      <h2 className={styles.cardTitle}>
                        <Link className={styles.cardTitleLink} to={`/workspace/${workspaceId}/memory/${memory.id}`}>
                          {memory.title}
                        </Link>
                      </h2>
                      <div className={styles.cardActions}>
                        <Link
                          className={styles.iconButton}
                          to={`/workspace/${workspaceId}/memory/${memory.id}`}
                          aria-label={`Edit ${memory.title}`}
                          title={t('Edit')}
                        >
                          <img src={penIcon} alt="" width={14} height={14} />
                        </Link>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => void handleDeleteMemory(memory)}
                          aria-label={`Delete ${memory.title}`}
                          title={t('Delete')}
                        >
                          <img src={trashIcon} alt="" width={14} height={14} />
                        </button>
                      </div>
                    </header>
                    <p className={styles.cardBody}>{memory.content}</p>
                    <footer className={styles.cardFooter}>
                      <span className={styles.author}>
                        <span className={styles.avatar} aria-hidden="true">
                          {memory.createdBy.slice(0, 1).toUpperCase()}
                        </span>
                        Added by {memory.createdBy}
                      </span>
                      <span className={styles.date}>{memoryDate(memory.createdAt)}</span>
                    </footer>
                  </article>
                ))}
              </div>

              <div className={styles.pagination}>
                <p className={styles.statsText}>
                  {total === 0 ? t('No memories') : `Showing ${from}-${to} of ${total} memories`}
                </p>
                <div className={styles.pageControls}>
                  <button
                    type="button"
                    className={styles.pageButton}
                    onClick={() => setPage((present) => Math.max(0, present - 1))}
                    disabled={page === 0}
                  >{t('Previous')}</button>
                  {Array.from({ length: totalPages }, (_, index) => index).map((index) => (
                    <button
                      key={index}
                      type="button"
                      className={index === page ? styles.pageCurrent : styles.pageButton}
                      onClick={() => setPage(index)}
                      aria-current={index === page ? 'page' : undefined}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.pageButton}
                    onClick={() => setPage((present) => Math.min(totalPages - 1, present + 1))}
                    disabled={page >= totalPages - 1}
                  >{t('Next')}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

    </AppShell>
  );
}
