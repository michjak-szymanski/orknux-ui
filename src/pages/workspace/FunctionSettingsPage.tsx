import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { ValueType } from '../../api/actions';
import {
  RETURN_TYPES,
  deleteFunction,
  fetchFunction,
  fetchWorkspaceFunctions,
  namesObject,
  timeAgo,
  updateFunction,
  valueTypeLabel,
} from '../../api/functions';
import type { ScriptImport, WorkspaceFunction } from '../../api/functions';
import { fetchWorkspaceLibraries, localName } from '../../api/libraries';
import type { ScriptLibrary, ScriptLibraryImport } from '../../api/libraries';
import { fetchWorkspaceObjects } from '../../api/objects';
import type { WorkflowObject } from '../../api/objects';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import plusIcon from '../../assets/plus.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { OpenDefinitionIcon } from '../../components/OpenDefinitionIcon';
import { UsedBy } from '../../components/UsedBy';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './AgentSettingsPage.module.css';
/*
 * The row rules, borrowed rather than written again.
 *
 * An import row is a select, a name and a ×, and it looked the way it looked
 * because somebody measured it in the editor's panel; a second copy of those
 * rules here would be a second look to keep in step with the first. The classes
 * are flat - none of them is nested under `.panel` - so they carry across
 * unchanged, and this page only ever gives them more room than they had.
 */
import rows from './FunctionEditorPage.module.css';
import { t } from '../../i18n';

export interface FunctionSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** As many as a picker can search without asking the server. */
const FUNCTION_PAGE_SIZE = 100;
const OBJECT_PAGE_SIZE = 100;

/**
 * What a function is wired to, at a URL of its own.
 *
 * The editor used to be the only place a function existed, and everything about
 * one was stacked down a 380px column beside the code: name, test run,
 * parameters, externals, imports, libraries, return type, history, and where it
 * was used. Nine sections, and the seventh of them started 1,364px down a
 * thousand-pixel column. Every other component here already has the shape that
 * fixes it - a workflow is drawn on `/editor` and configured on `/settings`, an
 * agent's form has a page rather than only a panel - so a function gets it too.
 *
 * **The line is what the code column needs beside it.** Four things write into
 * the editor's value and cannot be a route away from it: the name rewrites the
 * `export default function` declaration as it is typed, adding a parameter
 * rewrites the signature, removing an external rewrites it again, and restoring
 * a version replaces the whole of it. Those stay. What is left is the function's
 * wiring - what it may call, and what it hands back - which is chosen once and
 * then read, and reads far better on a page than in a column.
 *
 * So this page holds imports, libraries and the return type, the answer to where
 * the function is used, and the way to be rid of it. The editor keeps the code
 * and the four controls that write into it.
 *
 * It does not edit the code, and it saves on its own. Two forms over one row is
 * a real risk - the last save wins - and the way that is kept honest is that
 * neither form sends a field the other one owns: `updateFunction` leaves out
 * what it is not given, so saving here cannot write back a stale source and
 * saving there cannot write back stale imports.
 */
export function FunctionSettingsPage({ session, onSignOut }: FunctionSettingsPageProps) {
  const { workspaceId = '', functionId = '' } = useParams();
  const navigate = useNavigate();

  const [fn, setFn] = useState<WorkspaceFunction | null>(null);
  const [imports, setImports] = useState<ScriptImport[]>([]);
  const [libraries, setLibraries] = useState<ScriptLibraryImport[]>([]);
  const [returnType, setReturnType] = useState<ValueType>('MAP');
  const [returnObjectId, setReturnObjectId] = useState<string | null>(null);

  const [importable, setImportable] = useState<WorkspaceFunction[]>([]);
  const [loadable, setLoadable] = useState<ScriptLibrary[]>([]);
  const [objects, setObjects] = useState<WorkflowObject[]>([]);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const list = `/workspace/${workspaceId}/functions`;
  const editor = `/workspace/${workspaceId}/functions/${functionId}`;

  useEffect(() => {
    if (functionId === '') return;
    let current = true;

    fetchFunction(functionId)
      .then((found) => {
        if (!current) return;
        if (found === null) {
          setLoadError(t('That function no longer exists.'));
          return;
        }
        setFn(found);
        setImports(found.imports);
        setLibraries(found.libraries);
        setReturnType(found.returnType);
        setReturnObjectId(found.returnObjectId);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : t('Could not load the function.'));
      });

    return () => {
      current = false;
    };
  }, [functionId]);

  /*
   * What this function may import: the workspace's own, and not itself. A
   * plugin's is left out because the server refuses one, and offering a choice
   * that is always refused is worse than not offering it.
   */
  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceFunctions(workspaceId, 0, FUNCTION_PAGE_SIZE)
      .then((page) => setImportable(page.content.filter((held) => held.scope !== 'PLUGIN' && held.id !== functionId)))
      .catch(() => setImportable([]));
  }, [workspaceId, functionId]);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceLibraries(workspaceId)
      .then(setLoadable)
      .catch(() => setLoadable([]));
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceObjects(workspaceId, 0, OBJECT_PAGE_SIZE)
      .then((page) => setObjects(page.content))
      .catch(() => setObjects([]));
  }, [workspaceId]);

  /** What an object is called, for the link that has to name it. */
  const objectNameOf = (objectId: string | null | undefined): string | null =>
    objects.find((held) => held.id === objectId)?.name ?? null;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      /*
       * The three fields this page owns, and no others. `updateFunction` leaves
       * out what it is not handed, so nothing the editor is holding is written
       * back from here.
       */
      const updated = await updateFunction(functionId, {
        returnType,
        returnObjectId: namesObject(returnType) ? returnObjectId : null,
        imports: imports.map((held) => ({ functionId: held.functionId, name: held.name })),
        libraries: libraries.map((held) => ({ libraryId: held.libraryId, name: held.name })),
      });
      setFn(updated);
      setImports(updated.imports);
      setLibraries(updated.libraries);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not save the function.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteFunction(functionId);
      navigate(list);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : t('Could not delete the function.'));
      setRemoving(false);
    }
  }

  const called = fn?.name ?? '…';

  return (
    <AppShell
      title={fn?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={editor} label={called} />
          <Link className={styles.crumbLink} to={list}>{t('Functions')}</Link>
          <span className={styles.crumbSeparator}>/</span>
          {/* The name opens the code, which is where somebody came from. */}
          <Link className={styles.crumbLink} to={editor}>{called}</Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{t('Settings')}</span>
        </p>
        <h1 className={styles.pageTitle}>{t('Function Settings')}</h1>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
          <Link className={styles.crumbLink} to={list}>{t('Back to Functions')}</Link>
        </section>
      ) : fn === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <>
          <form className={styles.card} onSubmit={(event) => void handleSave(event)}>
            {/*
              What this function calls, as opposed to what it is handed.

              Reached through the sandbox's `imports` object rather than through
              the signature, so a row here changes what the code may call and not
              what it has to accept - which is why it is not a kind of parameter.

              Only the workspace's own functions are offered. The server refuses a
              plugin's, refuses a loop and refuses this function itself; the first
              two of those are not worth offering, and its refusal is what says so
              for the third.
            */}
            <div className={styles.field}>
              <span className={rows.headingWithHint}>
                <h2 className={styles.sectionHeading}>{t('Imports')}</h2>
                <FieldHint label={t('Imports')}>
                  The workspace’s other functions this one may call, as <code>imports.name(…)</code>. The name is
                  this code’s own word for it: renaming the function it points at changes nothing here. A
                  plugin’s function cannot be imported, and neither can a loop back to this one.
                </FieldHint>
              </span>
              <div className={rows.paramList}>
                {imports.map((held, index) => (
                  <div key={index} className={rows.paramRow}>
                    <select
                      className={`${rows.paramName} ${rows.inputMono}`}
                      value={held.functionId}
                      aria-label={`Import ${index + 1} function`}
                      onChange={(event) => {
                        const chosen = importable.find((one) => one.id === event.target.value);
                        setImports((current) =>
                          current.map((row, at) =>
                            at === index
                              ? {
                                  ...row,
                                  functionId: event.target.value,
                                  /*
                                   * Only ever filled in, never rewritten. The name
                                   * is what the code already says, and moving an
                                   * import to another function is not a request to
                                   * go through the code renaming the calls.
                                   */
                                  name: row.name.trim() === '' ? (chosen?.name ?? '') : row.name,
                                }
                              : row,
                          ),
                        );
                        setSaved(false);
                      }}
                    >
                      {/*
                        What it points at now, when that is not on offer: a
                        function deleted out from under this one, or the list not
                        yet fetched. Without it the select would show the first
                        option and read as though the import had been quietly moved.
                      */}
                      {!importable.some((one) => one.id === held.functionId) && (
                        <option value={held.functionId}>{held.function?.name ?? '—'}</option>
                      )}
                      {importable.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${rows.paramName} ${rows.inputMono}`}
                      type="text"
                      value={held.name}
                      aria-label={`Import ${index + 1} name`}
                      onChange={(event) => {
                        setImports((current) =>
                          current.map((row, at) => (at === index ? { ...row, name: event.target.value } : row)),
                        );
                        setSaved(false);
                      }}
                    />
                    <button
                      type="button"
                      className={rows.removeParam}
                      aria-label={`Remove ${held.name || `import ${index + 1}`}`}
                      onClick={() => {
                        setImports((current) => current.filter((_, at) => at !== index));
                        setSaved(false);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={rows.addParam}
                  disabled={importable.length === 0}
                  title={
                    importable.length === 0
                      ? t('This workspace has no other functions to import')
                      : t('Call one of the workspace’s other functions from this one')
                  }
                  onClick={() => {
                    /*
                      One that is not imported already, so the row arrives pointing
                      at something and under a name the server would take.
                    */
                    const next =
                      importable.find((one) => !imports.some((held) => held.functionId === one.id)) ?? importable[0];
                    if (next === undefined) return;
                    setImports((current) => [...current, { functionId: next.id, name: next.name, function: null }]);
                    setSaved(false);
                  }}
                >
                  <img src={plusIcon} alt="" width={14} height={14} />
                  {t('Add Import')}
                </button>
              </div>
            </div>

            {/*
              The installation's libraries, directly after the workspace's own
              functions, because at run time they are the same thing: both arrive
              on `imports` under the local name chosen here, and the code cannot
              tell which is which.

              What differs is where they come from and who loads them - a library
              is loaded once for the whole installation by an administrator - so
              they are picked from a list of their own rather than mixed into the
              one above.
            */}
            <div className={styles.field}>
              <span className={rows.headingWithHint}>
                <h2 className={styles.sectionHeading}>{t('Libraries')}</h2>
                <FieldHint label={t('Libraries')}>
                  The installation’s libraries this function may use, reached as <code>imports.name</code>.
                  The name is this code’s own word for it and is seeded from the library’s key the first
                  time a row points at one. An administrator loads them, on Admin → Libraries.
                </FieldHint>
              </span>
              <div className={rows.paramList}>
                {libraries.map((held, index) => (
                  <div key={index} className={rows.paramRow}>
                    <select
                      className={`${rows.paramName} ${rows.inputMono}`}
                      value={held.libraryId}
                      aria-label={`Library ${index + 1}`}
                      onChange={(event) => {
                        const picked = loadable.find((one) => one.id === event.target.value);
                        setLibraries((current) =>
                          current.map((row, at) =>
                            at === index
                              ? {
                                  ...row,
                                  libraryId: event.target.value,
                                  library: null,
                                  /*
                                   * Only ever filled in, never rewritten - the same
                                   * rule an import's name follows, for the same
                                   * reason: the code already says `imports.dateFns`.
                                   */
                                  name:
                                    row.name.trim() === ''
                                      ? picked === undefined
                                        ? ''
                                        : localName(picked.key)
                                      : row.name,
                                }
                              : row,
                          ),
                        );
                        setSaved(false);
                      }}
                    >
                      {/*
                        What it points at now, when that is not on offer: one
                        removed out from under this function, or the list not yet
                        fetched.
                      */}
                      {!loadable.some((one) => one.id === held.libraryId) && (
                        <option value={held.libraryId}>{held.library?.key ?? '—'}</option>
                      )}
                      {loadable.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.key}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${rows.paramName} ${rows.inputMono}`}
                      type="text"
                      value={held.name}
                      aria-label={`Library ${index + 1} name`}
                      onChange={(event) => {
                        setLibraries((current) =>
                          current.map((row, at) => (at === index ? { ...row, name: event.target.value } : row)),
                        );
                        setSaved(false);
                      }}
                    />
                    <button
                      type="button"
                      className={rows.removeParam}
                      aria-label={`Remove ${held.name || `library ${index + 1}`}`}
                      onClick={() => {
                        setLibraries((current) => current.filter((_, at) => at !== index));
                        setSaved(false);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={rows.addParam}
                  disabled={loadable.length === 0}
                  title={
                    loadable.length === 0
                      ? t('No libraries are loaded into this installation')
                      : t('Use one of the installation’s libraries from this function')
                  }
                  onClick={() => {
                    const next =
                      loadable.find((one) => !libraries.some((held) => held.libraryId === one.id)) ?? loadable[0];
                    if (next === undefined) return;
                    setLibraries((current) => [
                      ...current,
                      { libraryId: next.id, name: localName(next.key), library: null },
                    ]);
                    setSaved(false);
                  }}
                >
                  <img src={plusIcon} alt="" width={14} height={14} />
                  {t('Add Library')}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <span className={rows.headingWithHint}>
                <h2 className={styles.sectionHeading}>{t('Return Type')}</h2>
                <FieldHint label={t('Return Type')}>
                  An object names a shape this workspace defines, and the editor checks the code against it. Map
                  is for a structure with no defined shape.
                </FieldHint>
              </span>
              <div className={rows.selectWrapper}>
                <select
                  className={`${rows.input} ${rows.inputMono}`}
                  value={returnType}
                  aria-label={t('Return type')}
                  onChange={(event) => {
                    const type = event.target.value as ValueType;
                    setReturnType(type);
                    // Same rule as a parameter's: naming an object means naming one.
                    setReturnObjectId(namesObject(type) ? (returnObjectId ?? objects[0]?.id ?? null) : null);
                    setSaved(false);
                  }}
                >
                  {RETURN_TYPES.map((type) => (
                    <option key={type} value={type} disabled={namesObject(type) && objects.length === 0}>
                      {valueTypeLabel(type)}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>

              {namesObject(returnType) && (
                <div className={rows.paramObjectLine}>
                  <div className={rows.selectWrapper}>
                    <select
                      className={`${rows.input} ${rows.inputMono}`}
                      value={returnObjectId ?? ''}
                      aria-label={t('Returned object')}
                      onChange={(event) => {
                        setReturnObjectId(event.target.value);
                        setSaved(false);
                      }}
                    >
                      {objects.map((held) => (
                        <option key={held.id} value={held.id}>
                          {held.name} · {held.propertyCount} fields
                        </option>
                      ))}
                    </select>
                    <img src={chevronDown12Icon} alt="" width={12} height={12} />
                  </div>
                  {returnObjectId !== null && returnObjectId !== '' && (
                    <Link
                      className={rows.jump}
                      to={`/workspace/${workspaceId}/objects/${returnObjectId}`}
                      target="_blank"
                      rel="noreferrer"
                      title={t('Opens the object\'s definition in a new tab')}
                      aria-label={`Open definition of ${objectNameOf(returnObjectId) ?? 'the returned object'}`}
                    >
                      <OpenDefinitionIcon />
                    </Link>
                  )}
                </div>
              )}

              {/*
                What the workspace has, which is a state and not an explanation:
                what an object type *means* has gone behind the (?) on the
                heading, and this says only that there are none to name yet.
              */}
              {objects.length === 0 && (
                <p className={rows.paramHint}>
                  {t('There are no objects in this workspace yet, so define one first or use map.')}{' '}
                  <Link
                    className={rows.shortcutLink}
                    to={`/workspace/${workspaceId}/objects`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('Open Objects')}
                  </Link>
                </p>
              )}
            </div>

            {saveError !== null && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}

            <div className={styles.cardActions}>
              {saved && <span className={styles.savedNote}>{t('Saved.')}</span>}
              <button type="submit" className={styles.save} disabled={saving}>
                {saving ? t('Saving…') : t('Save Changes')}
              </button>
            </div>
          </form>

          <section className={styles.card}>
            <div className={styles.field}>
              <p className={styles.label}>{t('Last modified')}</p>
              <p className={styles.hint}>
                {timeAgo(fn.lastModifiedAt)} by <strong>{fn.lastModifiedBy}</strong>
              </p>
            </div>
          </section>

          {/*
            What leans on it, above the way to take it away. A function is the
            most-pointed-at thing this product has - actions call it, conditions
            ask it, webhooks authenticate with it, other functions and tools
            import it - so being refused a delete was the only way anybody found
            out.
          */}
          <section className={styles.card}>
            <UsedBy kind="FUNCTION" componentId={functionId} />
          </section>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <h2 className={styles.dangerHeading}>{t('Danger Zone')}</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <p className={styles.dangerTitle}>Delete {fn.name}</p>
                <p className={styles.dangerMessage}>
                  {confirmingDelete
                    ? `Delete ${fn.name}? Everything above says what would break, and nothing puts the code back.`
                    : t('Remove this function from the workspace')}
                </p>
                {removeError !== null && (
                  <p className={styles.error} role="alert">
                    {removeError}
                  </p>
                )}
              </div>
              {confirmingDelete ? (
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => setConfirmingDelete(false)}
                    disabled={removing}
                  >{t('Keep')}</button>
                  <button
                    type="button"
                    className={styles.delete}
                    onClick={() => void handleDelete()}
                    disabled={removing}
                  >
                    {removing ? t('Deleting…') : t('Delete Function')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.delete}
                  onClick={() => setConfirmingDelete(true)}
                  disabled={removing}
                >{t('Delete Function')}</button>
              )}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
