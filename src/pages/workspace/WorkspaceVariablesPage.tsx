import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import {
  VARIABLE_TYPES,
  createVariable,
  createVariableCatalog,
  deleteVariable,
  deleteVariableCatalog,
  fetchVariableCatalogs,
  fetchVariables,
  renameVariableCatalog,
  revealVariable,
  updateVariable,
} from '../../api/variables';
import type { Variable, VariableCatalog, VariableKind, VariableType } from '../../api/variables';
import checkIcon from '../../assets/check.svg';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import folderOpenIcon from '../../assets/folder-open.svg';
import folderIcon from '../../assets/folder.svg';
import penIcon from '../../assets/pen.svg';
import panelCollapseIcon from '../../assets/panel-collapse.svg';
import plusIcon from '../../assets/plus.svg';
import searchIcon from '../../assets/search.svg';
import trashIcon from '../../assets/trash-grey.svg';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { RevealToggle } from '../../components/RevealToggle';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceMemoryPage.module.css';
import table from './WorkspaceVariablesPage.module.css';

export interface WorkspaceVariablesPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** A catalog is a page's worth; the search box narrows what is already there. */
const PAGE_SIZE = 50;

/** What a row holds while it is being edited, before anything is sent. */
interface Draft {
  name: string;
  description: string;
  type: VariableType;
  /** Empty on a secret means "leave what is stored". */
  value: string;
}

const EMPTY: Draft = { name: '', description: '', type: 'STRING', value: '' };

/**
 * What the row holds before anybody edits it.
 *
 * @param revealed what a secret turned out to hold, once somebody uncovered it.
 *   Passed in rather than assumed empty, because revealing is not a change: a
 *   row that showed Save the moment you looked at it would be lying about what
 *   is pending.
 */
function draftOf(variable: Variable, revealed?: string): Draft {
  return {
    name: variable.name,
    description: variable.description ?? '',
    type: variable.type,
    // A value is already known, so it is there to edit; a secret is empty until
    // somebody uncovers it, and then it is whatever came back.
    value: variable.kind === 'VALUE' ? (variable.value ?? '') : (revealed ?? ''),
  };
}

/**
 * The workspace's variables: catalogs on the left, what is in the selected one
 * on the right, in two tables — values above, secrets below.
 *
 * Edited in the row rather than in a window. A variable is four short fields,
 * and a dialog to change one of them is a dialog for every rename; the row is
 * already the right shape for it. Adding is the same act: a blank row appears
 * where the new variable will be, under the table it belongs to.
 *
 * A value is read from the list, because a channel name or a threshold is only
 * awkward hidden. A secret is not: its box stays covered until somebody presses
 * Show, which the audit log records.
 */
export function WorkspaceVariablesPage({ session, onSignOut }: WorkspaceVariablesPageProps) {
  const { workspaceId = '' } = useParams();

  const [catalogs, setCatalogs] = useState<VariableCatalog[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [variables, setVariables] = useState<PageOf<Variable> | null>(null);
  const [search, setSearch] = useState('');
  /**
   * The order the rows are held in, by id.
   *
   * A list arrives sorted by name, so a variable added or renamed would jump
   * the moment it was saved — out from under the cursor that had just typed it,
   * to wherever the new name belongs. So the order is settled when the catalog
   * is opened and then kept for as long as it stays open: a row saved keeps its
   * place, and a row added stays at the foot of its table, where the blank row
   * that made it was. Opening the catalog again sorts, which is the point:
   * sorting is right for reading a list and wrong for watching one change.
   */
  const [arrangement, setArrangement] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Whether the catalog column is folded away; the list is not always the work. */
  const [foldedCatalogs, setFoldedCatalogs] = useState(false);

  const current = catalogs?.find((catalog) => catalog.id === selected) ?? null;

  async function guard(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be done.');
    }
  }

  const loadCatalogs = useCallback(
    async (keep?: string) => {
      if (workspaceId === '') return;
      const held = await fetchVariableCatalogs(workspaceId);
      setCatalogs(held);
      setSelected((current) => keep ?? current ?? held[0]?.id ?? null);
    },
    [workspaceId],
  );

  /**
   * Reads the selected catalog.
   *
   * @param options.keepOrder whether the rows already on screen keep the places
   *   they have. Passed by everything that follows a change; opening a catalog
   *   does not pass it, and takes the sorted order.
   * @param options.made the variable just created, kept even when the page it
   *   sorted onto is not the first one — a catalog longer than a page would
   *   otherwise swallow the row somebody had just typed.
   */
  const loadVariables = useCallback(
    async (options: { keepOrder?: boolean; made?: Variable } = {}) => {
      if (workspaceId === '' || selected === null) {
        setVariables(null);
        setArrangement([]);
        return;
      }
      const held = await fetchVariables(workspaceId, { catalogId: selected, size: PAGE_SIZE });
      const made = options.made;
      const content =
        made !== undefined && !held.content.some((one) => one.id === made.id)
          ? [...held.content, made]
          : held.content;
      setVariables({ ...held, content });
      setArrangement((current) =>
        options.keepOrder === true
          ? [
              // What is still there keeps its place; what has appeared since
              // goes to the end, which is where the row that made it was.
              ...current.filter((id) => content.some((one) => one.id === id)),
              ...content.filter((one) => !current.includes(one.id)).map((one) => one.id),
            ]
          : content.map((one) => one.id),
      );
    },
    [workspaceId, selected],
  );

  useEffect(() => {
    void guard(() => loadCatalogs());
  }, [loadCatalogs]);

  useEffect(() => {
    void guard(() => loadVariables());
  }, [loadVariables]);

  async function handleNewCatalog() {
    const name = window.prompt('Name the catalog');
    if (name === null || name.trim() === '') return;
    await guard(async () => {
      const made = await createVariableCatalog(workspaceId, name.trim());
      await loadCatalogs(made.id);
    });
  }

  async function handleRenameCatalog() {
    if (current === null) return;
    const name = window.prompt('Rename the catalog', current.name);
    if (name === null || name.trim() === '') return;
    await guard(async () => {
      await renameVariableCatalog(current.id, name.trim());
      await loadCatalogs(current.id);
    });
  }

  async function handleDeleteCatalog() {
    if (current === null) return;
    if (!window.confirm(`Delete ${current.name}?`)) return;
    await guard(async () => {
      await deleteVariableCatalog(current.id);
      setSelected(null);
      await loadCatalogs();
    });
  }

  function matches(name: string): boolean {
    const looking = search.trim().toLowerCase();
    return looking === '' || name.toLowerCase().includes(looking);
  }

  async function afterChange(made?: Variable) {
    /*
     * The search box is cleared when what was just added would not survive it.
     * A row that vanishes the moment it is saved reads as a save that failed,
     * and the person can see the box they typed in and put it back.
     */
    if (made !== undefined && !matches(made.name)) setSearch('');
    await loadVariables({ keepOrder: true, made });
    await loadCatalogs(selected ?? undefined);
  }

  /*
   * In the order the catalog was opened in, rather than the one it arrives in:
   * see `arrangement`. Anything the list has gained since — added here, or
   * added by somebody else and picked up by a reload — falls to the end.
   */
  const place = new Map(arrangement.map((id, at) => [id, at]));
  const ordered = (variables?.content ?? [])
    .map((variable, at) => ({ variable, at: place.get(variable.id) ?? arrangement.length + at }))
    .sort((one, other) => one.at - other.at)
    .map((held) => held.variable);

  // Filtered here rather than by the server: a catalog is a page's worth, and
  // the box is for finding one you can already see.
  const showing = ordered.filter((variable) => matches(variable.name));

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="variables" />}
    >
      <div className={styles.split}>
        <aside className={foldedCatalogs ? `${styles.catalogs} ${styles.catalogsCollapsed}` : styles.catalogs}>
          <header className={styles.catalogsHeader}>
            {!foldedCatalogs && <p className={styles.catalogsTitle}>CATALOGS</p>}
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
            {catalogs === null && (
              <p className={styles.sidebarNote}>
                <Loader />
              </p>
            )}
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
                  <span className={open ? styles.countCurrent : styles.count}>{catalog.variableCount}</span>
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
                ? 'Add a catalog to start keeping values in it.'
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
                    placeholder="Search variables..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Search variables"
                  />
                </div>
              </div>

              {/*
                Values first, then secrets: one is configuration read at a
                glance, the other is a thing somebody hopes never to look at.
                Each table adds its own kind, so nothing has to ask which.
              */}
              <VariableTable
                title="Values"
                note="Read and edited here: configuration rather than credentials."
                addLabel="+ Add Value"
                kind="VALUE"
                workspaceId={workspaceId}
                catalogId={current.id}
                variables={showing.filter((variable) => variable.kind === 'VALUE')}
                onChanged={(made) => guard(() => afterChange(made))}
                onError={setError}
              />

              <VariableTable
                title="Secrets"
                note="Kept out of sight. Show one to read it; the audit log records that you did."
                addLabel="+ Add Secret"
                kind="SECRET"
                workspaceId={workspaceId}
                catalogId={current.id}
                variables={showing.filter((variable) => variable.kind === 'SECRET')}
                onChanged={(made) => guard(() => afterChange(made))}
                onError={setError}
              />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/**
 * One list of variables, edited in place.
 *
 * The same table for both kinds, because they are read the same way. What
 * differs is one column: a value arrives with the list, a secret has to be
 * asked for — and each table adds its own kind, so nothing has to ask which.
 */
function VariableTable({
  title,
  note,
  addLabel,
  kind,
  workspaceId,
  catalogId,
  variables,
  onChanged,
  onError,
}: {
  title: string;
  note: string;
  addLabel: string;
  kind: VariableKind;
  workspaceId: string;
  catalogId: string;
  variables: Variable[];
  /**
   * Reloads the list; awaited, so a row can hold what was typed until it lands.
   *
   * @param made the variable this change created, so the page can keep it in
   *   view rather than leave it to sorting and the page size.
   */
  onChanged: (made?: Variable) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /**
   * What each uncovered secret turned out to hold.
   *
   * The value as well as the fact, because it is also the baseline: without it,
   * uncovering a secret would look exactly like typing a new one.
   */
  const [shown, setShown] = useState<Record<string, string>>({});
  /** The row being added, or null while there is not one. */
  const [adding, setAdding] = useState<Draft | null>(null);
  /**
   * Whether the secret being typed is shown.
   *
   * Its own flag, not part of the drafts map the saved rows use: those are keyed by
   * variable id and this one has no id yet. It is also a different decision — showing
   * a stored secret fetches it and is audited, while this value has never left the
   * page.
   */
  const [addingShown, setAddingShown] = useState(false);

  /*
   * Covered again once the row is gone, so the next secret starts hidden. Done here
   * rather than at each of the places that close the row — saving, Escape, Cancel —
   * because one of those would eventually be added without it.
   */
  useEffect(() => {
    if (adding === null) setAddingShown(false);
  }, [adding]);
  const [busy, setBusy] = useState<string | null>(null);

  function baseOf(variable: Variable): Draft {
    return draftOf(variable, shown[variable.id]);
  }

  function draftFor(variable: Variable): Draft {
    return drafts[variable.id] ?? baseOf(variable);
  }

  function edit(variable: Variable, change: Partial<Draft>) {
    setDrafts((held) => ({ ...held, [variable.id]: { ...draftFor(variable), ...change } }));
  }

  /** Whether this row holds anything not yet written down. */
  function dirty(variable: Variable): boolean {
    const draft = drafts[variable.id];
    if (draft === undefined) return false;

    const original = baseOf(variable);
    return (
      draft.name !== original.name ||
      draft.description !== original.description ||
      draft.type !== original.type ||
      draft.value !== original.value
    );
  }

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    onError(null);
    try {
      await work();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function save(variable: Variable) {
    const draft = draftFor(variable);
    if (draft.name.trim() === '') return;

    await run(variable.id, async () => {
      await updateVariable(variable.id, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        type: draft.type,
        // Empty leaves what is stored, which is what an untouched secret means.
        value: draft.value === '' && kind === 'SECRET' ? undefined : draft.value,
      });
      /*
       * The list first, the draft after.
       *
       * Dropping the draft before the reload landed put the row back on the
       * variable it still had — the old value — for as long as the query took,
       * so a save flickered through what it had just replaced.
       */
      await onChanged();
      setDrafts((held) => {
        const rest = { ...held };
        delete rest[variable.id];
        return rest;
      });
      /*
       * Covered again once it is saved. The draft was holding the revealed
       * text; dropping that while the row still counted as shown left a secret
       * rendered as an empty box, which reads as "the value is gone".
       */
      setShown((held) => {
        const rest = { ...held };
        delete rest[variable.id];
        return rest;
      });
    });
  }

  async function add() {
    if (adding === null || adding.name.trim() === '') return;

    await run('new', async () => {
      const made = await createVariable({
        workspaceId,
        catalogId,
        name: adding.name.trim(),
        description: adding.description.trim(),
        type: adding.type,
        kind,
        value: adding.value === '' ? undefined : adding.value,
      });
      // Handed on, so the row lands where the blank one was rather than where
      // its name sorts, and is still there when the catalog is a long one.
      await onChanged(made);
      setAdding(null);
    });
  }

  async function remove(variable: Variable) {
    if (!window.confirm(`Delete "${variable.name}"? Whatever it holds goes with it.`)) return;

    await run(variable.id, async () => {
      await deleteVariable(variable.id);
      await onChanged();
    });
  }

  async function show(variable: Variable) {
    await run(variable.id, async () => {
      const held = (await revealVariable(variable.id)) ?? '';
      setShown((current) => ({ ...current, [variable.id]: held }));
      // Into the draft as well, so the box shows it — and equal to the baseline
      // above, so looking at a secret is not mistaken for changing one.
      edit(variable, { value: held });
    });
  }

  /** Covers it again. What was typed stays; what was only revealed does not. */
  function cover(variable: Variable) {
    const typed = drafts[variable.id]?.value;
    setShown((held) => {
      const rest = { ...held };
      delete rest[variable.id];
      return rest;
    });
    if (typed !== undefined && typed === shown[variable.id]) {
      setDrafts((held) => {
        const rest = { ...held };
        delete rest[variable.id];
        return rest;
      });
    }
  }

  /** A name is what a function receives the value as, so it has to be one. */
  const nameable = (said: string) => said.replace(/[^A-Za-z0-9_]/g, '');

  return (
    <section className={table.section}>
      <header className={table.sectionHeader}>
        <div className={table.sectionTitles}>
          <h2 className={table.sectionTitle}>{title}</h2>
          <p className={table.sectionNote}>{note}</p>
        </div>
        <button
          type="button"
          className={table.addButton}
          onClick={() => setAdding((held) => held ?? { ...EMPTY })}
        >
          {addLabel}
        </button>
      </header>

      <div className={table.table}>
        <div className={table.tableHeader}>
          <span className={table.colName}>Name</span>
          <span className={table.colValue}>Value</span>
          <span className={table.colDescription}>Description</span>
          <span className={table.colType}>Type</span>
          <span className={table.colActions}>Actions</span>
        </div>

        {variables.length === 0 && adding === null && <p className={table.empty}>Nothing here yet.</p>}

        {variables.map((variable) => {
          const draft = draftFor(variable);
          const readable = kind === 'VALUE' || variable.id in shown;
          return (
            <div key={variable.id} className={table.row}>
              <input
                className={`${table.colName} ${table.cellInput} ${table.mono}`}
                value={draft.name}
                aria-label={`Name of ${variable.name}`}
                spellCheck={false}
                onChange={(event) => edit(variable, { name: nameable(event.target.value) })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save(variable);
                }}
              />

              <span className={`${table.colValue} ${table.valueCell}`}>
                {/*
                  A covered secret is read-only: typing into a box you cannot
                  see, into a value you cannot compare it with, is a change
                  nobody can check. The eye is the way in, and what it costs is
                  a line in the audit log — which is the honest price.
                */}
                <input
                  className={`${table.cellInput} ${table.mono}`}
                  type={readable ? 'text' : 'password'}
                  autoComplete="off"
                  value={draft.value}
                  readOnly={!readable}
                  placeholder={variable.valueSet ? 'Hidden' : 'Not set'}
                  title={readable ? undefined : 'Show it to edit'}
                  aria-label={`Value of ${variable.name}`}
                  onChange={(event) => edit(variable, { value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void save(variable);
                  }}
                />
                {/*
                  The usual eye. Uncovering fetches the secret, which the audit
                  log records; covering it again is only this screen's business,
                  so anything typed in the meantime stays.
                */}
                {kind === 'SECRET' && (variable.valueSet || readable) && (
                  <RevealToggle
                    shown={readable}
                    label={variable.name}
                    onToggle={() => (readable ? cover(variable) : void show(variable))}
                  />
                )}
              </span>

              <input
                className={`${table.colDescription} ${table.cellInput}`}
                value={draft.description}
                placeholder="What it is for"
                aria-label={`Description of ${variable.name}`}
                onChange={(event) => edit(variable, { description: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save(variable);
                }}
              />

              <span className={`${table.colType} ${table.typeCell}`}>
                <select
                  className={`${table.cellInput} ${table.mono}`}
                  value={draft.type}
                  aria-label={`Type of ${variable.name}`}
                  onChange={(event) => edit(variable, { type: event.target.value as VariableType })}
                >
                  {VARIABLE_TYPES.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate.toLowerCase()}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </span>

              <span className={table.colActions}>
                {/*
                  Only while there is something to save: nothing is written as
                  you type. A tick rather than the word, so it sits beside the
                  bin as one of a pair rather than a button next to an icon.
                */}
                {dirty(variable) && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={busy === variable.id || draft.name.trim() === ''}
                    onClick={() => void save(variable)}
                    aria-label={`Save ${variable.name}`}
                    title="Save"
                  >
                    <img src={checkIcon} alt="" width={14} height={14} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => void remove(variable)}
                  aria-label={`Delete ${variable.name}`}
                  title="Delete"
                >
                  <img src={trashIcon} alt="" width={14} height={14} />
                </button>
              </span>
            </div>
          );
        })}

        {adding !== null && (
          <div className={`${table.row} ${table.addRow}`}>
            <input
              className={`${table.colName} ${table.cellInput} ${table.mono}`}
              value={adding.name}
              placeholder="new_name"
              aria-label={`New ${kind === 'VALUE' ? 'value' : 'secret'} name`}
              spellCheck={false}
              autoFocus
              onChange={(event) => setAdding((held) => ({ ...(held ?? EMPTY), name: nameable(event.target.value) }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add();
                if (event.key === 'Escape') setAdding(null);
              }}
            />
            <span className={`${table.colValue} ${table.valueCell}`}>
              <input
                className={`${table.cellInput} ${table.mono}`}
                type={kind === 'VALUE' || addingShown ? 'text' : 'password'}
                autoComplete="off"
                value={adding.value}
                placeholder="Value"
                aria-label="New value"
                onChange={(event) => setAdding((held) => ({ ...(held ?? EMPTY), value: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void add();
                  if (event.key === 'Escape') setAdding(null);
                }}
              />
              {/*
                The same eye the saved rows have, and here it costs nothing: this
                value has not been stored yet, so showing it fetches nothing and
                there is nothing to write in the audit log. Somebody pasting a key
                they cannot read has no way to catch the paste that went wrong.
              */}
              {kind === 'SECRET' && (
                <RevealToggle
                  shown={addingShown}
                  label="the new secret"
                  onToggle={() => setAddingShown((held) => !held)}
                />
              )}
            </span>
            <input
              className={`${table.colDescription} ${table.cellInput}`}
              value={adding.description}
              placeholder="What it is for"
              aria-label="New description"
              onChange={(event) => setAdding((held) => ({ ...(held ?? EMPTY), description: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add();
                if (event.key === 'Escape') setAdding(null);
              }}
            />
            <span className={`${table.colType} ${table.typeCell}`}>
              <select
                className={`${table.cellInput} ${table.mono}`}
                value={adding.type}
                aria-label="New type"
                onChange={(event) =>
                  setAdding((held) => ({ ...(held ?? EMPTY), type: event.target.value as VariableType }))
                }
              >
                {VARIABLE_TYPES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate.toLowerCase()}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </span>
            <span className={table.colActions}>
              <button
                type="button"
                className={styles.iconButton}
                disabled={busy === 'new' || adding.name.trim() === ''}
                onClick={() => void add()}
                aria-label="Add this one"
                title="Add"
              >
                <img src={checkIcon} alt="" width={14} height={14} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setAdding(null)}
                aria-label="Discard this row"
                title="Discard"
              >
                <img src={trashIcon} alt="" width={14} height={14} />
              </button>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
