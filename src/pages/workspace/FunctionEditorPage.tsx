import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { ValueType } from '../../api/actions';
import {
  RETURN_TYPES,
  VALUE_TYPES,
  createFunction,
  deleteFunction,
  fetchFunction,
  timeAgo,
  namesObject,
  starterSource,
  tsType,
  updateFunction,
  validateFunctionSource,
  valueTypeLabel,
  withParameters,
} from '../../api/functions';
import type { FunctionParam, WorkspaceFunction } from '../../api/functions';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import codeIcon from '../../assets/code.svg';
import plusIcon from '../../assets/plus.svg';
import { VARIABLE_TYPE_LABEL, fetchVariables } from '../../api/variables';
import type { Variable } from '../../api/variables';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { CodeEditor } from '../../components/CodeEditor';
import type { CodeEditorHandle } from '../../components/CodeEditor';
import { compile, declareObjects } from '../../components/monaco';
import { objectTypes } from '../../components/objectTypes';
import { fetchWorkspaceObjects } from '../../api/objects';
import type { WorkflowObject } from '../../api/objects';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { TrashIcon } from '../../components/TrashIcon';
import { matches, useFormatShortcut, useSaveShortcut } from '../../session/shortcut';
import { shellUser } from '../../session/user';
import styles from './FunctionEditorPage.module.css';

export interface FunctionEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** The whole of a workspace's shapes fits the picker. */
const OBJECT_PAGE_SIZE = 100;

/** A compiler's complaint, with the line if it knew one. */
function said(reason: string, line: number | null): string {
  return line === null ? reason : `Line ${line}: ${reason}`;
}

/**
 * One function: the code on the left, what it is on the right.
 *
 * The code is edited in Monaco, which brought line numbers, a caret that behaves,
 * Tab, brackets and an undo history with it — all of which used to be kept working
 * here by hand over a textarea.
 *
 * Validate is still the server's. Monaco's language service can report syntax
 * errors of its own, but the answer that matters is whether the parser which will
 * run this accepts it, and that one lives in the sandbox.
 */
/**
 * A name as a declaration can spell it.
 *
 * A function may be called anything - "Ticket reference", with a space in it -
 * and a declaration may not. Only the stub uses this: what the function is
 * called is its name, and the identifier in the code is nobody's business once
 * there is code.
 */
function identifier(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_$]/g, '');
  return cleaned === '' || /^[0-9]/.test(cleaned) ? 'newFunction' : cleaned;
}

export function FunctionEditorPage({ session, onSignOut }: FunctionEditorPageProps) {
  const { workspaceId = '', functionId = '' } = useParams();
  const navigate = useNavigate();
  /*
   * No id in the path: this page is writing a function that does not exist yet.
   *
   * The same page either way, deliberately. Creating one used to be a second,
   * thinner form - no code column, no way to take a parameter off again, no
   * saying which object a parameter or the return means - so the first thing
   * anybody did after creating a function was open it here and finish the job.
   * One form does both, and it is the one that can do everything.
   */
  const creating = functionId === '';

  const [fn, setFn] = useState<WorkspaceFunction | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  /** The left column: what somebody writes. */
  const [source, setSource] = useState('');
  /*
   * Map, not object, until something says otherwise.
   *
   * The stub returns a structure with no declared shape, which is what map
   * means, and it is what a new function goes on returning until somebody
   * decides otherwise. Starting at object would start every new function with a
   * choice already made and not yet answered - an object needs to name one, so
   * the first save would be refused for a shape nobody asked for. A function
   * that is opened rather than written has its own answer, which arrives with it.
   */
  const [returnType, setReturnType] = useState<ValueType>('MAP');
  const [params, setParams] = useState<FunctionParam[]>([]);
  /** The workspace's variables this function is handed, by id and in order. */
  const [externals, setExternals] = useState<string[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  /** What a parameter or a return type can name, and what the editor declares. */
  const [objects, setObjects] = useState<WorkflowObject[]>([]);
  const [returnObjectId, setReturnObjectId] = useState<string | null>(null);

  /*
   * What there is to choose from. Their values are not here and cannot be: an
   * external parameter is chosen by name, and read only inside the sandbox.
   */
  useEffect(() => {
    if (workspaceId === '') return;
    fetchVariables(workspaceId, { size: 100 })
      .then((page) => setVariables(page.content))
      .catch(() => setVariables([]));
  }, [workspaceId]);
  /*
   * The objects this workspace defines, fetched for two jobs at once: filling the
   * pickers, and being declared to the editor so an annotation naming one resolves.
   * Without the declaration every function taking an object would be underlined for
   * a type the language service had never heard of.
   */
  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceObjects(workspaceId, 0, OBJECT_PAGE_SIZE)
      .then((page) => setObjects(page.content))
      .catch(() => setObjects([]));
  }, [workspaceId]);

  useEffect(() => {
    declareObjects(objectTypes(objects));
  }, [objects]);

  /** What an object is called, for the annotation that has to name it. */
  const objectNameOf = (objectId: string | null | undefined): string | null =>
    objects.find((held) => held.id === objectId)?.name ?? null;

  /** What to call it at the top: its name, or what it is going to be. */
  const called = creating ? (name.trim() === '' ? 'New function' : name.trim()) : (fn?.name ?? '…');

  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [status, setStatus] = useState<{ ok: boolean; message: string }>({ ok: true, message: 'No errors' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useSaveShortcut();
  const format = useFormatShortcut();
  /** The editor itself, for the things only it can do — laying the code out. */
  const editor = useRef<CodeEditorHandle>(null);
  /** Read by the keyboard handler, which must not start a second save. */
  const savingRef = useRef(saving);
  savingRef.current = saving;
  /** False until the loaded function has been seen once, so opening one changes nothing. */
  const synced = useRef(false);
  /**
   * The last stub this page printed, or null before it has printed one.
   *
   * How it knows the code is somebody's own: not by listening for typing - the
   * editor reports a change when the stub itself is put in, which would make
   * every new function look written-in the instant it opened - but by comparing.
   * What is in the column either is the stub that was printed, or it is theirs.
   */
  const printed = useRef<string | null>(null);

  useEffect(() => {
    if (functionId === '') return;
    fetchFunction(functionId)
      .then((found) => {
        if (found === null) {
          setLoadError('That function does not exist, or you do not have access to it.');
          return;
        }
        setFn(found);
        setName(found.name);
        setDescription(found.description ?? '');
        /*
         * The TypeScript, or the JavaScript for a function stored before there was
         * any — JavaScript without annotations is TypeScript, so opening one of those
         * shows exactly what was written and compiling it changes nothing.
         */
        setSource(found.typescript ?? found.source);
        setReturnType(found.returnType);
        setReturnObjectId(found.returnObjectId);
        setParams(found.params);
        setExternals(found.externals.map((external) => external.variableId));
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the function.');
      });
  }, [functionId]);

  /**
   * The function's parameter list, as TypeScript would write it.
   *
   * Declared parameters first, then the workspace's variables — the same order the
   * sandbox passes them, which is what makes this the code's parameter list and not
   * just a label. Annotated, because the left column is TypeScript now: a parameter
   * added in the panel arrives in the code with the type the panel says it has, so
   * the language service can check the first line of the body against it.
   */
  const declarations = useMemo(
    () => [
      ...params
        .filter((param) => param.name.trim() !== '')
        .map((param) => `${param.name.trim()}: ${tsType(param.type, objectNameOf(param.objectId))}`),
      ...externals.map((variableId) => {
        const held = variables.find((candidate) => candidate.id === variableId);
        return held === undefined ? 'external: string' : `${held.name}: ${held.type.toLowerCase()}`;
      }),
    ],
    [params, externals, variables, objects],
  );

  /*
   * The code follows the panel.
   *
   * Adding a parameter here rewrites the declaration to take it, because the server
   * refuses to save a function whose code cannot accept everything it is handed —
   * and being refused for something the panel just did to you is not a useful way to
   * find that out.
   *
   * Skipped on the first pass after loading. A function stored before this existed
   * may already disagree with its own details, and rewriting it the moment somebody
   * opens it would mark the editor dirty without them touching anything.
   */
  useEffect(() => {
    if (fn === null && !creating) return;
    // Nothing has been opened when one is being written, so there is nothing to
    // leave alone: the first change is somebody's own and belongs in the code.
    if (!creating && !synced.current) {
      synced.current = true;
      return;
    }
    setSource((current) => {
      const next = withParameters(current, declarations);
      if (next !== current) setSaved(false);
      return next;
    });
  }, [fn, creating, declarations]);

  /*
   * What a new function says before anybody writes anything.
   *
   * Reprinted from the panel as it changes, so the name, the parameters and the
   * externals are already in the declaration when somebody starts typing. It
   * stops the moment they do: from then on the code is theirs, and only the
   * parameter list is kept in step, exactly as for a function that already
   * exists.
   */
  useEffect(() => {
    if (!creating) return;
    if (printed.current !== null && source !== printed.current) return;
    const next = starterSource(
      identifier(name),
      declarations,
      params.filter((param) => param.name.trim() !== '').map((param) => param.name.trim()),
    );
    printed.current = next;
    if (next !== source) setSource(next);
  }, [creating, name, declarations, params, source]);


  /*
   * Saving from the keyboard.
   *
   * Bound on the window in the capture phase, so it works with the caret inside
   * Monaco — the editor sees plenty of keys first, and this one has to reach here
   * whatever has focus. `preventDefault` is the point of binding it at all:
   * otherwise Ctrl+S is the browser offering to save the page as a file.
   *
   * `saving` is read from a ref rather than closed over, so a save cannot be
   * started twice by holding the key down.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (matches(event, format)) {
        // Prevented whatever it is bound to: the usual choice is a browser find,
        // and finding across a virtualised editor was never going to work anyway.
        event.preventDefault();
        editor.current?.format();
        return;
      }
      if (!matches(event, save)) return;
      event.preventDefault();
      if (!savingRef.current) void handleSave();
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // handleSave closes over the current fields; re-binding as they change is the
    // point, and the listener is cheap.
  });

  /**
   * The signature as it stands, not as it was saved.
   *
   * Computed here rather than read from the function, because the one the server
   * sent describes what is stored: add a parameter and it would go on describing
   * the version before it until a save. The externals are in it and marked, the
   * same way the server writes it — they are handed to the function after the
   * declared parameters, so a signature without them describes a call nobody makes.
   */
  const signature = useMemo(() => {
    const declared = params
      .filter((param) => param.name.trim() !== '')
      /*
       * An object parameter is shown by the object's name, the same way the code
       * annotates it and the same way the server writes the stored signature.
       * "payload: SlackMessage" is the useful sentence; "payload: object" is the one
       * that sends somebody looking for which object it meant.
       */
      .map((param) => `${param.name}: ${objectNameOf(param.objectId) ?? param.type.toLowerCase()}`);
    const handed = externals.map((variableId) => {
      const held = variables.find((candidate) => candidate.id === variableId);
      return held === undefined
        ? '…: external'
        : `${held.name}: ${held.type.toLowerCase()} (external)`;
    });
    return `(${[...declared, ...handed].join(', ')})`;
  }, [params, externals, variables, objects]);

  /**
   * The editor's Validate: parses on the server and says where it broke.
   *
   * Still the server's answer rather than the editor's, deliberately. Monaco can
   * report syntax errors of its own, but what matters is whether the parser that
   * will *run* this accepts it — and that one lives in the sandbox.
   */
  async function handleValidate() {
    try {
      /*
       * The compiled JavaScript is what is checked, because that is what the sandbox
       * will be handed. Compiled here rather than taken from the column: the column
       * is a moment behind, and validating the version before the last keystroke
       * would answer a question nobody asked.
       */
      const emitted = await compile(source);
      if (!emitted.ok) {
        setStatus({ ok: false, message: said(emitted.reason, emitted.line) });
        return;
      }

      const checked = await validateFunctionSource(workspaceId, emitted.javascript);
      setStatus(
        checked.valid
          ? { ok: true, message: 'No errors' }
          : {
              ok: false,
              message:
                checked.line === null
                  ? (checked.message ?? 'Could not be parsed')
                  : `Line ${checked.line}: ${checked.message ?? 'could not be parsed'}`,
            },
      );
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not validate.' });
    }
  }

  /**
   * Saves both halves, from one compile of what is on screen.
   *
   * This is the whole of the guarantee that the two are the same function. The
   * JavaScript that goes to the server is compiled here, now, from the exact
   * TypeScript going with it in the same mutation — never from anything cached, so
   * there is nothing that can be stale. The pair that is stored is always a
   * compiler's input and its output, and the server refuses either arriving alone.
   *
   * A refusal from the compiler stops the save. Storing output from code TypeScript
   * could not parse would put something in the sandbox that nobody wrote.
   */
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const emitted = await compile(source);
      if (!emitted.ok) {
        setStatus({ ok: false, message: said(emitted.reason, emitted.line) });
        return;
      }

      const details = {
        name: name.trim(),
        description,
        source: emitted.javascript,
        typescript: source,
        returnType,
        returnObjectId: namesObject(returnType) ? returnObjectId : null,
        params: params.filter((param) => param.name.trim() !== ''),
        externalVariableIds: externals,
      };

      const stored = creating
        ? await createFunction({ workspaceId, ...details })
        : await updateFunction(functionId, details);
      setFn(stored);
      setStatus({ ok: true, message: 'No errors' });
      setSaved(true);
      /*
       * The same page, now with somewhere to go back to. Replaced rather than
       * pushed: Back from a function that exists should be the list, not the
       * empty form it was written in, which would create a second one.
       */
      if (creating) navigate(`/workspace/${workspaceId}/functions/${stored.id}`, { replace: true });
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteFunction(functionId);
      navigate(`/workspace/${workspaceId}/functions`);
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not delete.' });
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="functions" />}
    >
      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : (
        <>
          <header className={styles.pageHeader}>
            <p className={styles.breadcrumb}>
              <BackLink to={`/workspace/${workspaceId}/functions`} label="Functions" />
              <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/functions`}>
                Functions
              </Link>
              <span className={styles.crumbSeparator}>/</span>
              <span className={styles.crumbCurrent}>{called}</span>
            </p>
            <div className={styles.headerRow}>
              <div className={styles.titleGroup}>
                <h1 className={styles.title}>{called}</h1>
                {/* Nothing is active until it has been saved once. */}
                {!creating && <span className={styles.activeBadge}>Active</span>}
              </div>
              <div className={styles.headerActions}>
                {!creating && (
                  <button type="button" className={styles.deleteButton} onClick={handleDelete}>
                    <TrashIcon />
                  </button>
                )}
                <button type="button" className={styles.ghostButton} onClick={handleValidate}>
                  Validate
                </button>
                <button
                  type="button"
                  className={styles.saveButton}
                  onClick={handleSave}
                  // A function has to be called something before it can be made.
                  disabled={saving || (creating && name.trim() === '')}
                >
                  {saving ? 'Saving…' : creating ? 'Create Function' : 'Save Changes'}
                </button>
              </div>
            </div>
          </header>

          <div className={styles.split}>
            <section className={styles.editorCard}>
              <header className={styles.editorHeader}>
                <span className={styles.editorTitle}>
                  <img src={codeIcon} alt="" width={16} height={16} />
                  Editor
                </span>
                {/*
                  What this function takes, as it stands. Follows the panel rather
                  than the last save, so adding a parameter or an external shows up
                  here immediately — which is the point of having it.
                */}
                <span className={styles.signature} title="What this function is handed, in order">
                  {creating ? identifier(name) : (fn?.name ?? 'function')}
                  {signature}
                </span>
                {/*
                  Monaco's own formatter, which is the language service. It belongs on
                  the editor rather than up with Save and Validate: those act on the
                  function — its name, its parameters, what is stored — and this acts
                  on the text in the box under it.

                  A button rather than something the save does: laying out somebody's
                  code unasked is a change they did not make, and it would turn up in
                  the diff of every save as though they had.
                */}
                <button
                  type="button"
                  className={styles.editorAction}
                  onClick={() => editor.current?.format()}
                  title={`Lay the code out again (${format})`}
                >
                  Format
                </button>
                <span className={styles.languageBadge}>TypeScript</span>
              </header>

              {/*
                One editor, and it is TypeScript.

                The JavaScript that actually runs is compiled from this when it is
                saved, and is not shown: it is the compiler's output, and a second
                column of it would be a second thing to read that nobody wrote and
                nobody can edit. What matters about it — that it is always the
                compile of exactly what was saved — is a property of the save, not
                something a reader has to check by eye.
              */}
              <div className={styles.codeArea}>
                <CodeEditor
                  ref={editor}
                  value={source}
                  language="typescript"
                  ariaLabel="Function source"
                  onChange={(next) => {
                    setSource(next);
                    setSaved(false);
                  }}
                  onCaretChange={(line, column) => setCaret({ line, column })}
                />
              </div>

              <footer className={styles.editorFooter}>
                <span className={styles.statusLeft}>
                  <span
                    className={`${styles.indicator} ${status.ok ? styles.indicatorOk : styles.indicatorBad}`}
                    aria-hidden="true"
                  />
                  <span className={status.ok ? styles.statusText : styles.statusTextBad}>
                    {saved && status.ok ? 'Saved. No errors' : status.message}
                  </span>
                </span>
                <span className={styles.caret}>
                  Ln {caret.line}, Col {caret.column}
                </span>
              </footer>
            </section>

            <aside className={styles.panel}>
              <section className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Function Details</h2>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="function-name">
                    Name
                  </label>
                  <input
                    id="function-name"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="text"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="function-description">
                    Description
                  </label>
                  <textarea
                    id="function-description"
                    className={`${styles.input} ${styles.textarea}`}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setSaved(false);
                    }}
                  />
                </div>

                {/*
                  The binding as it actually is, read from the same setting the
                  handler obeys — so somebody who changed it in Preferences is told
                  what they chose rather than what the default happens to be.
                */}
                <p className={styles.shortcutHint}>
                  <kbd className={styles.shortcutKey}>{save}</kbd> saves,{' '}
                  <kbd className={styles.shortcutKey}>{format}</kbd> formats.{' '}
                  <Link className={styles.shortcutLink} to="/preferences">
                    Change them
                  </Link>
                </p>
              </section>

              <section className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Parameters</h2>
                <div className={styles.paramList}>
                  {params.map((param, index) => (
                    <Fragment key={index}>
                    <div className={styles.paramRow}>
                      <input
                        className={`${styles.paramName} ${styles.inputMono}`}
                        type="text"
                        value={param.name}
                        aria-label={`Parameter ${index + 1} name`}
                        onChange={(event) => {
                          setParams((current) =>
                            current.map((row, at) =>
                              at === index ? { ...row, name: event.target.value } : row,
                            ),
                          );
                          setSaved(false);
                        }}
                      />
                      <select
                        className={styles.typeBadge}
                        value={param.type}
                        aria-label={`Parameter ${index + 1} type`}
                        onChange={(event) => {
                          const type = event.target.value as ValueType;
                          setParams((current) =>
                            current.map((row, at) =>
                              at === index
                                ? {
                                    ...row,
                                    type,
                                    /*
                                     * An object parameter has to name one, so the
                                     * first is chosen rather than leaving a row that
                                     * looks finished and is refused on save. Anything
                                     * else drops the reference: a stale id under a
                                     * string is one that comes back later.
                                     */
                                    objectId: namesObject(type)
                                      ? (row.objectId ?? objects[0]?.id ?? null)
                                      : null,
                                  }
                                : row,
                            ),
                          );
                          setSaved(false);
                        }}
                      >
                        {VALUE_TYPES.map((type) => (
                          <option
                            key={type}
                            value={type}
                            // Nothing to name yet: the workspace has no objects.
                            disabled={namesObject(type) && objects.length === 0}
                          >
                            {valueTypeLabel(type)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={styles.removeParam}
                        aria-label={`Remove ${param.name || `parameter ${index + 1}`}`}
                        onClick={() => {
                          setParams((current) => current.filter((_, at) => at !== index));
                          setSaved(false);
                        }}
                      >
                        ×
                      </button>
                    </div>

                    {/*
                      Which object, on its own line: the row above is already three
                      controls wide, and an object's name is longer than a type's.
                      Only ever shown for a parameter that names one — for anything
                      else there is nothing to choose.
                    */}
                    {namesObject(param.type) && (
                      <div className={styles.paramObjectRow}>
                        <select
                          className={`${styles.paramObject} ${styles.inputMono}`}
                          value={param.objectId ?? ''}
                          aria-label={`Object for ${param.name || `parameter ${index + 1}`}`}
                          onChange={(event) => {
                            setParams((current) =>
                              current.map((row, at) =>
                                at === index ? { ...row, objectId: event.target.value } : row,
                              ),
                            );
                            setSaved(false);
                          }}
                        >
                          {objects.map((held) => (
                            <option key={held.id} value={held.id}>
                              {held.name} · {held.propertyCount} fields
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    </Fragment>
                  ))}
                  <button
                    type="button"
                    className={styles.addParam}
                    onClick={() => setParams((current) => [...current, { name: '', type: 'STRING' }])}
                  >
                    <img src={plusIcon} alt="" width={14} height={14} />
                    Add Parameter
                  </button>
                </div>
              </section>

              {/*
                What the workspace hands it, as opposed to what a caller does.
                Appended to the signature in the order they are listed, so a
                script reads them as ordinary arguments after its own.
              */}
              <section className={styles.panelSection}>
                <h2 className={styles.panelHeading}>External Parameters</h2>
                <div className={styles.paramList}>
                  {externals.map((variableId, index) => {
                    const held = variables.find((candidate) => candidate.id === variableId);
                    return (
                      <div key={`${variableId}-${index}`} className={styles.paramRow}>
                        <select
                          className={`${styles.paramName} ${styles.inputMono}`}
                          value={variableId}
                          aria-label={`External parameter ${index + 1}`}
                          onChange={(event) => {
                            setExternals((current) =>
                              current.map((row, at) => (at === index ? event.target.value : row)),
                            );
                            setSaved(false);
                          }}
                        >
                          {variables.map((variable) => (
                            <option key={variable.id} value={variable.id}>
                              {variable.name} · {variable.catalogName}
                            </option>
                          ))}
                        </select>
                        <span className={styles.typeBadge}>
                          {held === undefined ? '—' : VARIABLE_TYPE_LABEL[held.type]}
                        </span>
                        <button
                          type="button"
                          className={styles.removeParam}
                          aria-label={`Remove external parameter ${index + 1}`}
                          onClick={() => {
                            setExternals((current) => current.filter((_, at) => at !== index));
                            setSaved(false);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className={styles.addParam}
                    disabled={variables.length === 0}
                    title={
                      variables.length === 0
                        ? 'This workspace has no variables yet'
                        : 'Hand this function one of the workspace\u2019s variables'
                    }
                    onClick={() => {
                      const next = variables.find((variable) => !externals.includes(variable.id));
                      if (next === undefined) return;
                      setExternals((current) => [...current, next.id]);
                      setSaved(false);
                    }}
                  >
                    <img src={plusIcon} alt="" width={14} height={14} />
                    Add External
                  </button>
                  <p className={styles.paramHint}>
                    {variables.length === 0
                      ? 'Define a variable first; externals are chosen from what the workspace keeps.'
                      : 'The workspace\u2019s values, handed to this function after its own parameters. Their values are never shown here.'}
                  </p>
                </div>
              </section>

              <section className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Return Type</h2>
                <div className={styles.selectWrapper}>
                  <select
                    className={`${styles.input} ${styles.inputMono}`}
                    value={returnType}
                    aria-label="Return type"
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
                  <div className={styles.selectWrapper}>
                    <select
                      className={`${styles.input} ${styles.inputMono}`}
                      value={returnObjectId ?? ''}
                      aria-label="Returned object"
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
                )}

                <p className={styles.paramHint}>
                  {objects.length === 0
                    ? 'An object type names one of this workspace’s objects; there are none yet, so define one first or use map.'
                    : 'An object names a shape this workspace defines, and the editor checks the code against it. Map is for a structure with no defined shape.'}
                </p>
              </section>

              <hr className={styles.divider} />

              <div className={styles.metadata}>
                <p className={styles.metadataLabel}>Last modified</p>
                <p className={styles.metadataValue}>
                  {creating || fn === null ? (
                    'Not saved yet'
                  ) : (
                    <>
                      {timeAgo(fn.lastModifiedAt)} by <strong>{fn.lastModifiedBy}</strong>
                    </>
                  )}
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </AppShell>
  );
}
