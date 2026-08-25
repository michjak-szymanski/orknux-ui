import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import type { ValueType } from '../../api/actions';
import {
  NEW_FUNCTION_NAME,
  RETURN_TYPES,
  VALUE_TYPES,
  createFunction,
  deleteFunction,
  fetchFunction,
  fetchWorkspaceFunctions,
  timeAgo,
  namesObject,
  parametersOf,
  sameParameters,
  starterSource,
  tsType,
  updateFunction,
  validateFunctionSource,
  valueTypeLabel,
  argumentJson,
  runFunction,
  withName,
  withParameters,
} from '../../api/functions';
import type { FunctionParam, FunctionRun, ScriptImport, WorkspaceFunction } from '../../api/functions';
import { fetchWorkspaceLibraries, localName } from '../../api/libraries';
import type { ScriptLibrary, ScriptLibraryImport, ScriptLibraryImportInput } from '../../api/libraries';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import codeIcon from '../../assets/code.svg';
import plusIcon from '../../assets/plus.svg';
import wandIcon from '../../assets/wand.svg';
import { VARIABLE_TYPE_LABEL } from '../../api/variables';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { CodeDiff } from '../../components/CodeDiff';
import { CodeEditor } from '../../components/CodeEditor';
import { FieldHint } from '../../components/FieldHint';
import type { CodeEditorHandle } from '../../components/CodeEditor';
import { OpenDefinitionIcon } from '../../components/OpenDefinitionIcon';
import { Loader } from '../../components/Loader';
import { RevisionHistory } from '../../components/RevisionHistory';
import { UsedBy } from '../../components/UsedBy';
import { compile, declareImports, declareObjects } from '../../components/monaco';
import { importTypes } from '../../components/importTypes';
import { objectTypes } from '../../components/objectTypes';
import { fetchWorkspaceObjects } from '../../api/objects';
import type { WorkflowObject } from '../../api/objects';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { TrashIcon } from '../../components/TrashIcon';
import { UnsavedWorkDialog } from '../../components/UnsavedWorkDialog';
import { ValidationStatus } from '../../components/ValidationStatus';
import type { Validation } from '../../components/ValidationStatus';
import { useLeaveGuard } from '../../components/leaveGuard';
import { matches, useFormatShortcut, useSaveShortcut } from '../../session/shortcut';
import { shellUser } from '../../session/user';
import { useWorkspaceVariables } from './workspaceVariables';
import styles from './FunctionEditorPage.module.css';
import { t } from '../../i18n';

export interface FunctionEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** The whole of a workspace's shapes fits the picker. */
const OBJECT_PAGE_SIZE = 100;

/** And the whole of its functions fits the one beside it. */
const FUNCTION_PAGE_SIZE = 100;

/*
 * How the two columns share the row, in pixels of panel.
 *
 * Kept for the person and not for the function. Somebody writing a function
 * wants the code wide and somebody filling in its parameters wants the details
 * wide, and which of those they are does not change when they open a different
 * function - so one number, not one per function.
 *
 * In the browser rather than on the server, and under the prefix the rest of
 * this platform's view state uses. It is one person's arrangement of their own
 * screen: a colleague opening the same function sees the split as it opens for
 * them, and dragging it here does not drag it there. The workflow editor keeps
 * where its lines have been pulled to the same way, for the same reason.
 */
const SPLIT_KEY = 'orknux.function-editor.panel-width';

/** What the panel is worth until somebody says otherwise - the width it always had. */
const DEFAULT_PANEL = 380;

/*
 * How little either side can be dragged to.
 *
 * The editor's floor is the width this page's own breakpoint already calls too
 * narrow: below about 425px a line of ordinary TypeScript stops fitting, which
 * is why the columns stack at all rather than getting narrower. The panel's is
 * what its widest row needs - a name, a type and a remove button on one line -
 * before the fields start truncating each other.
 */
const MIN_EDITOR = 420;
const MIN_PANEL = 300;

/**
 * The handle's own track: the room between the columns, which neither gets.
 *
 * It is the gap that used to be there. `.split` had 24px of it and now has
 * none, because the handle stands in the gap's place - so the two columns are
 * exactly as far apart as they were, and there is something in between to take
 * hold of.
 */
const HANDLE_WIDTH = 24;

/** One press of an arrow key. Coarse enough that a few presses get somewhere. */
const NUDGE = 24;

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
  return cleaned === '' || /^[0-9]/.test(cleaned) ? NEW_FUNCTION_NAME : cleaned;
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
  /*
   * A new function arrives already called something.
   *
   * The page said "New function" at the top and left the Name field empty, so
   * the one thing on screen that was a name was the one thing that would not be
   * saved - and Create Function stayed disabled until somebody typed. It is a
   * name a script can be called by, because the server refuses anything else,
   * and it is selected the first time the field is focused so typing over it
   * takes one gesture rather than a clear and a type.
   */
  const [name, setName] = useState(functionId === '' ? NEW_FUNCTION_NAME : '');
  const [renamed, setRenamed] = useState(false);
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
  /**
   * The workspace's other functions this one calls, under the names it calls them.
   *
   * Not parameters, and kept apart from them for that reason: an import is reached
   * through the sandbox's `imports` object, so adding one changes what the code may
   * call and not what it has to accept.
   */
  const [imports, setImports] = useState<ScriptImport[]>([]);
  /** What an import may point at: this workspace's own functions, minus this one. */
  const [importable, setImportable] = useState<WorkspaceFunction[]>([]);
  /**
   * The installation's libraries this function uses, under the names it uses them by.
   *
   * A list of its own rather than more imports, because they are chosen from
   * somewhere else: a library is loaded once for the whole installation by an
   * administrator, and a function belongs to a workspace. The code calls them the
   * same way — both arrive on `imports` under the local name — which is why the
   * two sections sit together.
   */
  const [libraries, setLibraries] = useState<ScriptLibraryImport[]>([]);
  /** What a library row may point at: everything loaded into the installation. */
  const [loadable, setLoadable] = useState<ScriptLibrary[]>([]);
  /** What a parameter or a return type can name, and what the editor declares. */
  const [objects, setObjects] = useState<WorkflowObject[]>([]);
  const [returnObjectId, setReturnObjectId] = useState<string | null>(null);

  /*
   * What a test run would pass, as typed, by parameter name.
   *
   * As typed rather than as JSON: the panel offers a control per type, and what
   * somebody has half-written in a number field is not a number yet. It becomes
   * JSON in `handleRun`, at the one moment there is a type to read it against.
   *
   * Keyed by name rather than by position, because a parameter renamed in the
   * panel above is a different parameter and should not keep a value that was
   * typed for the old one.
   */
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  /** What the last run came to, or null before there has been one. */
  const [ran, setRan] = useState<FunctionRun | null>(null);
  /** The run could not be asked for at all — the request failed, not the script. */
  const [runFailed, setRunFailed] = useState<string | null>(null);

  /*
   * What there is to choose from. Their values are not here and cannot be: an
   * external parameter is chosen by name, and read only inside the sandbox.
   *
   * Read again when the window comes back and when the list is reached for,
   * rather than once: an editor is left open for a long time, and the variable
   * it should be offering is made on another page — see `useWorkspaceVariables`.
   */
  const { variables, refresh: refreshVariables } = useWorkspaceVariables(workspaceId);
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

  /*
   * What this function may import: the workspace's own, and not itself.
   *
   * A plugin's function is left out because the server refuses one - it belongs to
   * no workspace, so nothing here could reach it - and offering a choice that is
   * always refused is worse than not offering it. A loop is not filtered: only the
   * server knows the whole graph, and its refusal says which link closed it.
   */
  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceFunctions(workspaceId, 0, FUNCTION_PAGE_SIZE)
      .then((page) =>
        setImportable(page.content.filter((held) => held.scope !== 'PLUGIN' && held.id !== functionId)),
      )
      .catch(() => setImportable([]));
  }, [workspaceId, functionId]);

  /*
   * What this function may use: everything loaded into the installation.
   *
   * Not the administrator's query. Choosing to import a library belongs to
   * whoever is writing the function, so this one answers for any member of the
   * workspace and says nothing about who else uses what.
   */
  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceLibraries(workspaceId)
      .then(setLoadable)
      .catch(() => setLoadable([]));
  }, [workspaceId]);

  /**
   * The imports with what they point at filled in, for the editor to be told.
   *
   * A row added a moment ago has no `function` on it: that half is resolved by the
   * server and arrives with the next read, and waiting for a save would mean the
   * call somebody writes immediately after adding an import is underlined until
   * they save it. The picker already holds the answer, so it is used.
   *
   * The signature is rebuilt from the declared parameters rather than taken from
   * the list, deliberately: the one the list carries has the function's externals
   * marked on the end, and an importer does not pass those - the sandbox does. It
   * is written the way the server writes an imported function's, so nothing moves
   * when the stored answer replaces this one.
   */
  const resolvedImports = useMemo(
    () =>
      imports.map((held) => {
        if (held.function !== null) return held;
        const known = importable.find((candidate) => candidate.id === held.functionId);
        return known === undefined
          ? held
          : {
              ...held,
              function: {
                name: known.name,
                description: known.description,
                signature: `(${known.params.map((param) => `${param.name}: ${param.type.toLowerCase()}`).join(', ')})`,
                returnType: known.returnType,
                returnObjectName: known.returnObjectName,
              },
            };
      }),
    [imports, importable],
  );

  /**
   * The library rows with what they point at filled in, for the same reason.
   *
   * A row added a moment ago has no `library` on it — that half is resolved by
   * the server and arrives with the next read — and the picker already holds the
   * answer, so somebody who adds a library and writes the call in the next breath
   * is not underlined until they save.
   */
  const resolvedLibraries = useMemo(
    () =>
      libraries.map((held) => {
        if (held.library !== null) return held;
        const known = loadable.find((candidate) => candidate.id === held.libraryId);
        return known === undefined
          ? held
          : { ...held, library: { key: known.key, callable: known.callable, members: known.members } };
      }),
    [libraries, loadable],
  );

  /*
   * What `imports` holds, told to the editor so a call through it is checked.
   *
   * The same arrangement the objects above get, and for the same reason: without
   * it every line calling an imported function is underlined for a global the
   * language service has never heard of. Both lists go in together because both
   * arrive in that one object at run time.
   */
  useEffect(() => {
    declareImports(importTypes(resolvedImports, resolvedLibraries));
  }, [resolvedImports, resolvedLibraries]);

  /** What an object is called, for the annotation that has to name it. */
  const objectNameOf = (objectId: string | null | undefined): string | null =>
    objects.find((held) => held.id === objectId)?.name ?? null;

  /** What to call it at the top: its name, or what it is going to be. */
  const called = creating ? (name.trim() === '' ? t('New function') : name.trim()) : (fn?.name ?? '…');

  const [caret, setCaret] = useState({ line: 1, column: 1 });
/*
   * Null until something has actually been checked.
   *
   * A green light that is simply the value the page opens with reports a check
   * nobody ran, and one that survives an edit describes a version of this that
   * no longer exists. Both are worse than showing nothing: an indicator is only
   * worth having if it can be wrong.
   */
  const [status, setStatus] = useState<Validation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * A change the assistant is offering for this function, if one is open.
   *
   * Claimed off the quick chat: the panel announces a suggestion with a
   * cancelable event, and a page already showing the function it is for takes
   * it - the diff belongs where the code is, in the editor's own terms, not in
   * a chat column three hundred pixels wide. While one is held the code column
   * shows the change against what is on screen, and the two buttons above it
   * are the only things that touch anything.
   */
  const [offered, setOffered] = useState<{ note: string | null; code: string } | null>(null);
  /** Why the last accept did not land, shown in the bar it was pressed in. */
  const [offerFailed, setOfferFailed] = useState<string | null>(null);
  /*
   * Whether the function open here was made a moment ago.
   *
   * In the address rather than in state: creating one moves from
   * `functions/new` to `functions/<id>`, which are two routes, so the page is
   * unmounted and mounted again on the way and anything it was holding goes
   * with it. What survives that is the URL.
   */
  const [query] = useSearchParams();
  const made = query.get('made') !== null;
  /** Where both ways back point: the list, and which row to look at on it. */
  const backTo = made
    ? `/workspace/${workspaceId}/functions?made=${functionId}`
    : `/workspace/${workspaceId}/functions`;
  const [saved, setSaved] = useState(false);
  const save = useSaveShortcut();
  const format = useFormatShortcut();
  /** The editor itself, for the things only it can do — laying the code out. */
  const editor = useRef<CodeEditorHandle>(null);
  /*
   * The row the two columns share, held so a drag can be measured against its
   * edges and its width watched.
   *
   * A callback ref rather than `useRef`: the row is not rendered at all while
   * the function is still loading, so an effect reading a ref would find
   * nothing on the pass that matters and never be run again.
   */
  const [split, setSplit] = useState<HTMLDivElement | null>(null);
  /** How much room the row has, which is not the window and changes with it. */
  const [room, setRoom] = useState(0);
  /** What the panel has been dragged to, or null before anything has been read. */
  const [wantedPanel, setWantedPanel] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (split === null) return;
    const watch = new ResizeObserver((entries) => {
      const seen = entries[0]?.contentRect.width;
      if (seen !== undefined) setRoom(seen);
    });
    watch.observe(split);
    return () => watch.disconnect();
  }, [split]);

  useEffect(() => {
    try {
      const held = Number(window.localStorage.getItem(SPLIT_KEY));
      if (Number.isFinite(held) && held > 0) setWantedPanel(held);
    } catch {
      // Unreadable, or turned off: the split simply opens where it always did.
    }
  }, []);

  /** The widest the panel may be here, which depends on how much row there is. */
  const widest = Math.max(MIN_PANEL, room - HANDLE_WIDTH - MIN_EDITOR);

  /*
   * Where the divider is drawn, which is not always where it was put.
   *
   * A window too narrow for the stored width gets the nearest split that still
   * leaves an editor. Clamped for the drawing only: what was chosen is still
   * what is stored, so widening the window gives it back rather than having
   * quietly forgotten it on the way through.
   */
  const panelWidth = useMemo(() => {
    const asked = wantedPanel ?? DEFAULT_PANEL;
    // Nothing measured yet: honour what was asked for and correct it once the
    // observer has reported, rather than clamping against a width of zero.
    if (room === 0) return asked;
    return Math.min(Math.max(asked, MIN_PANEL), widest);
  }, [wantedPanel, room, widest]);

  /**
   * The editor is told to measure itself again, every time the split moves.
   *
   * This is the whole of what makes the drag correct rather than merely wide.
   * Monaco does not read its size from the DOM: it caches the box it was last
   * given and positions every glyph, the caret and the arithmetic that turns a
   * click into an offset against that cache. Widen the column without saying so
   * and the code goes on being drawn at the old measure - wrapped where it no
   * longer wraps, and with a click landing the caret several characters from
   * where the pointer actually was.
   *
   * `automaticLayout` is on and covers the sizes the page arrives at, but it
   * observes on its own schedule; a drag changes the width every frame and the
   * editor has to be right on the frame, not after it.
   *
   * A layout effect, so the measurement happens between the DOM changing and
   * the frame being painted. In an ordinary effect there is one painted frame
   * of an editor drawn at the previous width, which during a drag is every
   * other frame.
   */
  useLayoutEffect(() => {
    editor.current?.layout();
  }, [panelWidth]);

  /** Writes the split down. A browser that will not remember is no reason to refuse the drag. */
  function rememberSplit(width: number) {
    try {
      window.localStorage.setItem(SPLIT_KEY, String(Math.round(width)));
    } catch {
      // Private mode, or storage full. The split still moves; it just does not
      // survive the next visit, which is better than a drag that does nothing.
    }
  }

  /** Where the pointer puts the divider, read as a width for the panel. */
  function panelWidthAt(clientX: number): number {
    if (split === null) return panelWidth;
    const box = split.getBoundingClientRect();
    const most = Math.max(MIN_PANEL, box.width - HANDLE_WIDTH - MIN_EDITOR);
    // The pointer is holding the middle of the handle, not its edge.
    return Math.min(Math.max(box.right - clientX - HANDLE_WIDTH / 2, MIN_PANEL), most);
  }

  function startSplitDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // Otherwise the press begins a selection that runs across the editor as the
    // pointer moves, and the drag ends with half the function highlighted.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveSplitDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setWantedPanel(panelWidthAt(event.clientX));
  }

  function endSplitDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    // Written once, at the end. Storing on every frame of a drag would be a
    // hundred writes to say what the last one says.
    rememberSplit(panelWidth);
  }

  /** Back to the width the page opens at, for a split dragged somewhere unhelpful. */
  function resetSplit() {
    setWantedPanel(DEFAULT_PANEL);
    rememberSplit(DEFAULT_PANEL);
  }

  /**
   * The same drag from the keyboard, for somebody who cannot hold a pointer
   * down - the way the workflow editor's own handle answers arrows. Left widens
   * the panel because left is where the divider goes; the delete keys put the
   * split back rather than removing anything, since there is nothing to remove.
   */
  function onSplitKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const by = event.key === 'ArrowLeft' ? NUDGE : event.key === 'ArrowRight' ? -NUDGE : 0;
    if (by !== 0) {
      // Kept from the column behind, which would scroll instead.
      event.preventDefault();
      const next = Math.min(Math.max(panelWidth + by, MIN_PANEL), widest);
      setWantedPanel(next);
      rememberSplit(next);
      return;
    }
    if (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      resetSplit();
    }
  }

  /**
   * What the divider says about itself: the editor's share of the row.
   *
   * A separator that can be moved has to report a value, and a percentage is
   * the one somebody can act on - "the editor has 62%" rather than a pixel
   * count that means nothing without knowing how wide the window is.
   */
  const editorShare = (width: number) =>
    room === 0 ? 0 : Math.round(((room - HANDLE_WIDTH - width) / room) * 100);

  /** Read by the keyboard handler, which must not start a second save. */
  const savingRef = useRef(saving);
  savingRef.current = saving;
  /**
   * The last stub this page printed, or null before it has printed one.
   *
   * How it knows the code is somebody's own: not by listening for typing - the
   * editor reports a change when the stub itself is put in, which would make
   * every new function look written-in the instant it opened - but by comparing.
   * What is in the column either is the stub that was printed, or it is theirs.
   */
  const printed = useRef<string | null>(null);

  /**
   * The name this page believes the declaration in the column bears.
   *
   * Null until the page knows: the first pass of the effect below seeds it and
   * changes nothing, and every read of a stored function seeds it again from what
   * arrived. Without that, opening a function whose code and name already disagree
   * — which is exactly the state issue #267 leaves behind — would rewrite the code
   * before anybody had touched anything, and the page would open with work in it
   * to lose.
   */
  const declaredAs = useRef<string | null>(null);

  useEffect(() => {
    if (functionId === '') return;
    fetchFunction(functionId)
      .then((found) => {
        if (found === null) {
          setLoadError(t('That function does not exist, or you do not have access to it.'));
          return;
        }
        setFn(found);
        declaredAs.current = identifier(found.name);
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
        setImports(found.imports);
        setLibraries(found.libraries);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : t('Could not load the function.'));
      });
  }, [functionId]);

  useEffect(() => {
    function onSuggested(event: Event) {
      const held = (event as CustomEvent<{ functionId: string; note: string | null; code: string }>).detail;
      if (held?.functionId !== functionId) return;
      // Claimed: the chat shows a pointer here instead of its own card.
      event.preventDefault();
      setOffered({ note: held.note, code: held.code });
      setOfferFailed(null);
    }
    window.addEventListener('orknux:function-suggestion', onSuggested);
    return () => window.removeEventListener('orknux:function-suggestion', onSuggested);
  }, [functionId]);

  /** What happened to the offer, said back into the conversation it came from. */
  function settleOffer(said: string) {
    setOffered(null);
    setOfferFailed(null);
    window.dispatchEvent(new CustomEvent('orknux:function-suggestion-settled', { detail: { said } }));
  }

  /**
   * A failed accept keeps the diff on screen.
   *
   * Closing it on failure took the change away in the same breath as the
   * error, so the next suggestion arrived into an empty column and Accept was
   * pressed on code nobody had re-read. The change stays, with the reason it
   * did not land above it; the person rejects it, or accepts the next offer
   * knowingly when it replaces this one. The model is still told at once.
   */
  function failOffer(shown: string, said: string) {
    setOfferFailed(shown);
    window.dispatchEvent(new CustomEvent('orknux:function-suggestion-settled', { detail: { said } }));
  }

  /**
   * Accepting compiles here, exactly as Save does, and for the same reason:
   * what runs is stored beside the TypeScript it came from, and this is the
   * only place with a compiler. A proposal that will not compile is refused
   * with the compiler's reason, and the assistant is told it - its next
   * attempt should be at the actual problem.
   */
  async function acceptOffer() {
    if (offered === null || saving) return;
    setSaving(true);
    try {
      const emitted = await compile(offered.code);
      if (!emitted.ok) {
        const reason = emitted.line === null ? emitted.reason : `line ${emitted.line}: ${emitted.reason}`;
        failOffer(
          `This would not compile — ${reason}`,
          `I tried to accept it and it would not compile — ${reason}. It was not saved.`,
        );
        return;
      }
      /*
       * The parameter list, read back off the code that was offered.
       *
       * This is what lets the assistant change a signature at all. It offers a
       * whole function, and the parameters are written into the declaration of
       * it; taking them from there rather than from a second field is what makes
       * the two impossible to disagree - a parameter added to the panel and not
       * to the code cannot be expressed, because there is only the code.
       *
       * A declaration this cannot describe is refused rather than half-saved,
       * with what is wrong with it, which the assistant is then told.
       */
      const read = parametersOf(offered.code, handed, objects, params);
      if ('problem' in read) {
        failOffer(
          `The parameters could not be read — ${read.problem}.`,
          `I could not accept it: ${read.problem}. Nothing was saved. Offer it again with a ` +
            'declaration I can read.',
        );
        return;
      }

      const moved = !sameParameters(read.params, params);
      const stored = await updateFunction(functionId, {
        source: emitted.javascript,
        typescript: offered.code,
        // Left out when they have not moved, so a change to the code alone goes
        // up as a change to the code alone.
        params: moved ? read.params : undefined,
      });
      setFn(stored);
      setSource(offered.code);
      /*
       * The panel follows the code in the same breath as the save. Without this
       * the details still describe the version before, and the effect that keeps
       * the code in step with the panel would put the old parameter list straight
       * back into the code somebody has just accepted.
       */
      setParams(stored.params);
      setSaved(true);
      setStatus({
        ok: true,
        message: moved ? t('The suggested change is saved, parameters and all.') : t('The suggested change is saved.'),
        whole: true,
      });
      settleOffer(
        moved
          ? `I accepted the change and it is saved. The function now takes ${stored.signature}.`
          : t('I accepted the change and it is saved.'),
      );
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : t('It could not be saved.');
      failOffer(
        `The save was refused — ${reason}`,
        `I tried to accept it and it could not be saved — ${reason}. It was not saved.`,
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * Somebody accepted a change to this function in the panel beside it.
   *
   * The page is holding the version from before, and its next save would put
   * that back - so it reloads. Only for this function: the panel can be used
   * anywhere, and another function being changed is none of this page's
   * business.
   */
  useEffect(() => {
    function onSaved(event: Event) {
      const saved = (event as CustomEvent<{ id: string }>).detail;
      if (saved?.id !== functionId) return;
      printed.current = null;
      fetchFunction(functionId)
        .then((found) => {
          if (found === null) return;
          setFn(found);
          declaredAs.current = identifier(found.name);
          setName(found.name);
          setDescription(found.description ?? '');
          setSource(found.typescript ?? found.source);
          setReturnType(found.returnType);
          setReturnObjectId(found.returnObjectId);
          setParams(found.params);
          setExternals(found.externals.map((external) => external.variableId));
          setImports(found.imports);
        setLibraries(found.libraries);
          setSaved(false);
          setStatus({ ok: true, message: t('Reloaded — the change was accepted.'), whole: true });
        })
        .catch(() => undefined);
    }

    window.addEventListener('orknux:function-saved', onSaved);
    return () => window.removeEventListener('orknux:function-saved', onSaved);
  }, [functionId]);

  /**
   * The parameters as a save would send them: the blank rows dropped, the names
   * as the server will store them.
   *
   * Both sides of every comparison below go through this. A row somebody added
   * and has not named yet is not a change - the save would not carry it - and a
   * name typed with a space after it is the same parameter as the one already
   * stored, so neither should make the editor ask before letting somebody go.
   */
  const declared = (all: FunctionParam[]): FunctionParam[] =>
    all.filter((param) => param.name.trim() !== '').map((param) => ({ ...param, name: param.name.trim() }));

  /**
   * The function's parameter list, as TypeScript would write it.
   *
   * Declared parameters first, then the workspace's variables — the same order the
   * sandbox passes them, which is what makes this the code's parameter list and not
   * just a label. Annotated, because the left column is TypeScript now: a parameter
   * added in the panel arrives in the code with the type the panel says it has, so
   * the language service can check the first line of the body against it.
   */
  /**
   * The workspace's variables this function is handed, by name and in order.
   *
   * The tail of every declaration: the sandbox passes the declared parameters
   * first and these after them, so reading a parameter list back off the code
   * means knowing which of its entries are not parameters at all.
   */
  const handed = useMemo(
    () =>
      externals.map((variableId) => ({
        name: variables.find((candidate) => candidate.id === variableId)?.name ?? 'external',
      })),
    [externals, variables],
  );

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

  /**
   * Whether the panel says something about the parameters the server has not
   * been told, which is the only thing the code has to be brought into step
   * with.
   *
   * The panel against the stored row, not a count of how many times the effect
   * below has run. Issue #175: it used to be a count - the first pass after
   * loading was skipped, on the reasoning that a function stored before any of
   * this existed may already disagree with its own declaration and rewriting it
   * on sight would mark the editor dirty without anybody touching it. The
   * reasoning was right and the mechanism could not carry it. `declarations` is
   * built from the workspace's variables and objects as well as the panel, and
   * those arrive in their own fetches - so the one pass being skipped was
   * whichever render happened to come first, and the rewrite landed on the next
   * one, before anybody had touched the page. A function with two externals and
   * a hand-written parameter list opened dirty every time.
   *
   * Asking the question by value instead answers it whenever it is asked. The
   * panel matching the stored row means there is nothing to write, whether that
   * is a second after loading or a second after a save - and it is why nothing
   * has to remember to give this effect a pass to do nothing in.
   */
  const panelMoved = useMemo(() => {
    if (fn === null) return false;
    const wasExternals = fn.externals.map((external) => external.variableId);
    return (
      !sameParameters(declared(params), declared(fn.params)) ||
      externals.length !== wasExternals.length ||
      externals.some((variableId, at) => variableId !== wasExternals[at])
    );
    // `declared` is a plain helper over its arguments, and reading it as a
    // dependency would rebuild this on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, params, externals]);

  /**
   * The imports a save would send: the unnamed rows dropped, the names trimmed.
   *
   * Both sides of the comparison below go through this, exactly as `declared` does
   * for the parameters - a row somebody has not named yet is not an import, and the
   * save would not carry it.
   */
  const named = (all: ScriptImport[]): { functionId: string; name: string }[] =>
    all
      .filter((held) => held.functionId !== '' && held.name.trim() !== '')
      .map((held) => ({ functionId: held.functionId, name: held.name.trim() }));

  /**
   * Whether the imports on screen are not the ones the server was told.
   *
   * Its own answer rather than part of `panelMoved`, because the two ask different
   * questions of the code. A parameter has to be in the declaration, so a change to
   * one rewrites it; an import is reached through `imports` and appears nowhere in
   * the signature, so a change to one leaves the code alone. Only leaving the page
   * has to know about it.
   */
  const importsMoved = useMemo(() => {
    if (fn === null) return imports.length > 0;
    const was = named(fn.imports);
    const now = named(imports);
    return (
      now.length !== was.length ||
      now.some((held, at) => held.functionId !== was[at].functionId || held.name !== was[at].name)
    );
    // `named` is a plain helper over its argument, and reading it as a dependency
    // would rebuild this on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, imports]);

  /**
   * The libraries a save would send: the unnamed rows dropped, the names trimmed.
   *
   * The same rule `named` applies to the imports, for the same reason - a row
   * pointing at nothing, or one nobody has named yet, is not a library this
   * function uses and the save would not carry it.
   */
  const chosen = (all: ScriptLibraryImport[]): ScriptLibraryImportInput[] =>
    all
      .filter((held) => held.libraryId !== '' && held.name.trim() !== '')
      .map((held) => ({ libraryId: held.libraryId, name: held.name.trim() }));

  /** Whether the libraries on screen are not the ones the server was told. */
  const librariesMoved = useMemo(() => {
    if (fn === null) return libraries.length > 0;
    const was = chosen(fn.libraries);
    const now = chosen(libraries);
    return (
      now.length !== was.length ||
      now.some((held, at) => held.libraryId !== was[at].libraryId || held.name !== was[at].name)
    );
    // `chosen` is a plain helper over its argument, and reading it as a dependency
    // would rebuild this on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, libraries]);

  /*
   * The code follows the panel.
   *
   * Adding a parameter here rewrites the declaration to take it, because the server
   * refuses to save a function whose code cannot accept everything it is handed —
   * and being refused for something the panel just did to you is not a useful way to
   * find that out.
   *
   * Only while the panel is ahead of the server. A function whose stored code
   * disagrees with its own details is left exactly as it was stored until
   * somebody changes something here; see `panelMoved`.
   */
  useEffect(() => {
    if (fn === null && !creating) return;
    // Nothing has been opened when one is being written, so there is nothing to
    // leave alone: the first change is somebody's own and belongs in the code.
    if (!creating && !panelMoved) return;
    setSource((current) => {
      const next = withParameters(current, declarations);
      if (next !== current) setSaved(false);
      return next;
    });
  }, [fn, creating, declarations, panelMoved]);

  /**
   * The stub a new function would say right now, given the panel as it stands.
   *
   * Computed rather than remembered, because two things want it and one of them
   * cannot use a ref. The effect below prints it; `unsaved` compares against it
   * to answer whether a new function has been written in yet - and an answer
   * read out of a ref during rendering is an answer that does not change when
   * the ref does.
   */
  const stub = useMemo(
    () =>
      starterSource(
        identifier(name),
        declarations,
        params.filter((param) => param.name.trim() !== '').map((param) => param.name.trim()),
        returnType,
      ),
    [name, declarations, params, returnType],
  );

  /*
   * What a new function says before anybody writes anything.
   *
   * Reprinted from the panel as it changes, so the name, the parameters, the
   * externals and the return type are already in the code when somebody starts
   * typing. It stops the moment they do: from then on the code is theirs, and
   * only the parameter list is kept in step, exactly as for a function that
   * already exists.
   *
   * The return type is in the stub above because choosing nothing has to take
   * the return statement out again, and choosing a type back has to put it back
   * - a panel that only ever adds is a panel you have to correct by hand.
   */
  useEffect(() => {
    if (!creating) return;
    if (printed.current !== null && source !== printed.current) return;
    printed.current = stub;
    if (stub !== source) setSource(stub);
  }, [creating, stub, source]);

  /*
   * The declaration follows the Name field, which is issue #267.
   *
   * The panel already rewrites the parameter list of the declaration above, and
   * the name was the one part of the same line it left behind: renaming `sss` to
   * `sssssdsd` left `export default async function sss()` in the column, which
   * runs perfectly — the sandbox calls the default export — and reads as a
   * mistake to everybody who opens it afterwards. So the answer is not to stop
   * writing a name into the stub. A name that is decoration is still the name a
   * stack trace prints when the function throws, which is a sentence the Run
   * panel now shows people; and taking it out of the stub would fix nothing for
   * the functions that already have one, which is all of them.
   *
   * What makes rewriting it safe is `withName` and this ref between them. The
   * declaration is only ever renamed *from* the name this page last put there —
   * so a declaration somebody has given a name of their own is left alone from
   * then on, permanently — and `withName` refuses when that name appears anywhere
   * else in the file, so a function that calls itself is never half-renamed.
   * Nothing here touches a line that is not the declaration, and every change is
   * on screen, in the column, before it can be saved.
   *
   * It sits after the stub effect on purpose. While a new function is still
   * printing its stub, that effect has already rewritten the whole thing with the
   * new name by the time this runs, so this finds nothing to rename and leaves
   * the stub's own bookkeeping alone.
   */
  useEffect(() => {
    const now = identifier(name);
    const was = declaredAs.current;
    declaredAs.current = now;
    if (was === null || was === now) return;
    setSource((current) => {
      const next = withName(current, was, now);
      if (next !== current) setSaved(false);
      return next;
    });
  }, [name]);

  /**
   * There is work on this screen the server has not been told about.
   *
   * Measured against what was loaded, not against whether anybody has typed.
   * The page already keeps a `saved` flag - the workflow editor's convention,
   * and the thing that lights the green "Saved. No errors" - but a flag can
   * only ever say that a key was pressed. Somebody who types a character and
   * deletes it has changed nothing, and being asked to confirm losing nothing
   * is how a prompt teaches people to click through prompts. The workflow
   * editor answers by flag because a graph is not a value you can compare; a
   * function is seven fields and a string, so here the comparison is the honest
   * answer and the flag is not.
   *
   * `fn` is the baseline and it is maintained for free: it is set when the
   * function is loaded, set again from what `handleSave` stored, and set again
   * when a suggestion accepted in the panel is read back. So saving and then
   * leaving asks nothing, which is the failure that makes a guard worth
   * ignoring.
   *
   * A function being written has no baseline on the server, so its baseline is
   * the page as it opens: the name it arrives with, no details, and the stub in
   * the column. Anything else is somebody's work.
   */
  const unsaved = useMemo(() => {
    if (creating) {
      return !(
        name.trim() === NEW_FUNCTION_NAME &&
        description.trim() === '' &&
        declared(params).length === 0 &&
        externals.length === 0 &&
        imports.length === 0 &&
        libraries.length === 0 &&
        returnType === 'MAP' &&
        /*
         * The column is empty for exactly one render - the pass before the
         * effect above puts the stub in it - and an empty column is not a
         * written function. Without this the page would count itself as having
         * work in it the instant it opened, and put a history entry on to
         * defend nothing.
         */
        (source === stub || printed.current === null)
      );
    }
    // Still loading, or it could not be loaded: there is nothing on screen to lose.
    if (fn === null) return false;
    return (
      name.trim() !== fn.name.trim() ||
      description.trim() !== (fn.description ?? '').trim() ||
      source !== (fn.typescript ?? fn.source) ||
      returnType !== fn.returnType ||
      // Normalised the way a save normalises it: an object chosen and then
      // abandoned for a return type that names none is not sent, so it is not a
      // change either.
      (namesObject(returnType) ? returnObjectId : null) !==
        (namesObject(fn.returnType) ? fn.returnObjectId : null) ||
      // The parameters a save would send and the externals in order, which the
      // code column is kept in step with above and so is asked for once.
      panelMoved ||
      // The imports, which the code column knows nothing about; see `importsMoved`.
      importsMoved ||
      // And the libraries, which it knows nothing about either.
      librariesMoved
    );
  }, [
    creating,
    fn,
    name,
    description,
    source,
    returnType,
    returnObjectId,
    params,
    externals,
    imports,
    libraries,
    panelMoved,
    importsMoved,
    librariesMoved,
    stub,
  ]);

  /*
   * The three ways out, and the question before any of them.
   *
   * The mechanism is shared with the object editor and the tool editor - it was
   * written here and lifted into `useLeaveGuard` when they turned out to have
   * the same hole. What is not shared is `unsaved` above: only this page knows
   * what a function is made of.
   */
  const guard = useLeaveGuard({ unsaved, backTo, save: handleSave });

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
        ? t('…: external')
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
          ? { ok: true, message: "the code compiles and the sandbox's parser accepts it" }
          : {
              ok: false,
              message:
                checked.line === null
                  ? (checked.message ?? t('Could not be parsed'))
                  : `Line ${checked.line}: ${checked.message ?? 'could not be parsed'}`,
            },
      );
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : t('Could not validate.'), whole: true });
    }
  }

  /**
   * Runs the function, with what is in the Test Run fields, and shows the answer.
   *
   * The server is handed an id and arguments and nothing else — no source. So what
   * runs is the *saved* function, in the sandbox a workflow runs it in, with the
   * workspace's variables it is granted resolved the same way; the panel says so,
   * and says so again when there is unsaved work in the column, because otherwise
   * a run that disagreed with the code on screen would read as the run being wrong
   * rather than as the code not having been saved.
   *
   * A failure is the interesting answer and is shown as one: the reason comes back
   * on `error` with the function's name in front of it, worded exactly as a run of
   * the workflow would have worded it in its history.
   */
  async function handleRun() {
    if (running || creating) return;
    setRunning(true);
    setRan(null);
    setRunFailed(null);
    try {
      const answer = await runFunction({
        workspaceId,
        functionId,
        arguments: declared(params).map((param) => ({
          name: param.name,
          json: argumentJson(param.type, testValues[param.name] ?? ''),
        })),
      });
      setRan(answer);
    } catch (cause) {
      setRunFailed(cause instanceof Error ? cause.message : t('It could not be run.'));
    } finally {
      setRunning(false);
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
  async function handleSave(): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setSaved(false);
    try {
      const emitted = await compile(source);
      if (!emitted.ok) {
        setStatus({ ok: false, message: said(emitted.reason, emitted.line) });
        return false;
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
        // A row nobody has named is not an import yet, and sending it would be
        // refused for a name no code can call it by.
        imports: named(imports),
        // The same rule for a library: a row nobody has named is not one yet.
        libraries: chosen(libraries),
      };

      const stored = creating
        ? await createFunction({ workspaceId, ...details })
        : await updateFunction(functionId, details);
      setFn(stored);
      setStatus({ ok: true, message: "the code compiles and the sandbox's parser accepts it" });
      setSaved(true);
      /*
       * The same page, now with somewhere to go back to. Replaced rather than
       * pushed: Back from a function that exists should be the list, not the
       * empty form it was written in, which would create a second one.
       */
      if (creating) {
        // Remembered for the way back: the list is five to a page and sorted by
        // name, so a function just made is very often not on the page the list
        // opens at - and from there it looks like it was not made at all.
        navigate(`/workspace/${workspaceId}/functions/${stored.id}?made=1`, { replace: true });
      }
      return true;
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : t('Could not save.'), whole: true });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteFunction(functionId);
      navigate(`/workspace/${workspaceId}/functions`);
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : t('Could not delete.'), whole: true });
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : !creating && fn === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <>
          <header className={styles.pageHeader}>
            <p className={styles.breadcrumb}>
              <BackLink to={backTo} label={t('Functions')} />
              {/* The same place as the arrow beside it, including which row. */}
              <Link className={styles.crumbLink} to={backTo}>{t('Functions')}</Link>
              <span className={styles.crumbSeparator}>/</span>
              <span className={styles.crumbCurrent}>{called}</span>
            </p>
            <div className={styles.headerRow}>
              <div className={styles.titleGroup}>
                <h1 className={styles.title}>{called}</h1>
                {/* Nothing is active until it has been saved once. */}
                {!creating && <span className={styles.activeBadge}>{t('Active')}</span>}
              </div>
              <div className={styles.headerActions}>
                {!creating && (
                  <button type="button" className={styles.deleteButton} onClick={handleDelete}>
                    <TrashIcon />
                  </button>
                )}
                {/*
                  A function that answers yes or no is a condition waiting to be
                  written, and writing it meant going to Conditions, choosing
                  Function, and finding this one in a list. Only offered for a
                  function that returns a boolean: the condition form lists no
                  others, so the button would lead somewhere that could not show
                  what it was opened for.
                */}
                {/*
                  Help, offered where the work is. The wand opens the quick
                  chat; on a conversation that has not started it also asks the
                  first question, so one click goes from stuck to being helped -
                  a conversation already under way is joined, not talked over.
                */}
                <button
                  type="button"
                  className={styles.wandButton}
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('orknux:quick-chat', { detail: { opener: t('Can you help me with that?') } }),
                    )
                  }
                  aria-label={t('Ask the assistant for help with this function')}
                  title={t('Ask the assistant for help')}
                >
                  <img src={wandIcon} alt="" width={16} height={16} />
                </button>
                {!creating && returnType === 'BOOLEAN' && (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => navigate(`/workspace/${workspaceId}/conditions/new?function=${functionId}`)}
                  >{t('Wrap in Condition')}</button>
                )}
                {/*
                  Beside the button it is about, not down in the footer where it
                  used to sit - and in the button's own word. See
                  `ValidationStatus`.
                */}
                <ValidationStatus
                  subject={t("The code")}
                  status={status}
                  saved={saved}
                  explains={
                    <>
                      Validate compiles the TypeScript in the column and hands the JavaScript to the parser that
                      will actually run it — the sandbox's, not the editor's. It answers whether this function
                      would load, and says which line stopped it if it would not. It does not run the function.
                    </>
                  }
                />
                <button type="button" className={styles.ghostButton} onClick={handleValidate}>
                  {t('Validate')}
                </button>
                <button
                  type="button"
                  className={styles.saveButton}
                  onClick={handleSave}
                  // A function has to be called something before it can be made.
                  disabled={saving || (creating && name.trim() === '')}
                >
                  {saving ? t('Saving…') : creating ? t('Create Function') : t('Save Changes')}
                </button>
              </div>
            </div>
          </header>

          {/*
            The row, and how the two columns divide it.
            The width goes in as a custom property rather than as a style on the
            panel itself, so the stylesheet keeps the rule - and the breakpoint
            further down can go on overriding it when the columns stack, which a
            style attribute would have won against.
          */}
          <div
            className={dragging ? `${styles.split} ${styles.splitDragging}` : styles.split}
            ref={setSplit}
            style={{ '--panel-width': `${panelWidth}px` } as CSSProperties}
          >
            <section className={styles.editorCard} id="function-code-column">
              <header className={styles.editorHeader}>
                <span className={styles.editorTitle}>
                  <img src={codeIcon} alt="" width={16} height={16} />
                  {t('Editor')}
                </span>
                {/*
                  What this function takes, as it stands. Follows the panel rather
                  than the last save, so adding a parameter or an external shows up
                  here immediately — which is the point of having it.
                */}
                <span className={styles.signature} title={t('What this function is handed, in order')}>
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
                >{t('Format')}</button>
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
              {/*
                The change on offer, above the diff it describes. Accept and
                Reject live up here rather than in the chat: the person reading
                the diff is looking at this column, and the answer belongs where
                the question is.
              */}
              {offered !== null && (
                <div className={offerFailed === null ? styles.suggestionBar : styles.suggestionBarFailed}>
                  <span className={styles.suggestionNote}>
                    {offerFailed ??
                      (offered.note !== null && offered.note !== ''
                        ? offered.note
                        : t('The assistant suggests this change.'))}
                  </span>
                  <button
                    type="button"
                    className={styles.saveButton}
                    onClick={() => void acceptOffer()}
                    disabled={saving}
                  >
                    {saving ? t('Saving…') : 'Accept'}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => settleOffer(t('I rejected the change. The function is unchanged.'))}
                    disabled={saving}
                  >{t('Reject')}</button>
                </div>
              )}
              <div className={styles.codeArea}>
                {offered === null ? (
                  <CodeEditor
                    ref={editor}
                    value={source}
                    language="typescript"
                    ariaLabel={t('Function source')}
                    onChange={(next) => {
                      setSource(next);
                      setSaved(false);
                      // What was checked was the code as it was; this is not
                      // that code any more.
                      setStatus(null);
                    }}
                    onCaretChange={(line, column) => setCaret({ line, column })}
                  />
                ) : (
                  <CodeDiff original={source} modified={offered.code} ariaLabel={t('Suggested change')} />
                )}
              </div>

              {/*
                Where the caret is, and nothing else. The Validate status used
                to share this row and has gone up beside the button that sets
                it; what is left is the one thing that really is about the
                column above it.
              */}
              <footer className={styles.editorFooter}>
                <span className={styles.caret}>
                  Ln {caret.line}, Col {caret.column}
                </span>
              </footer>
            </section>

            {/*
              The divider, standing in the gap that used to be between them.

              A separator rather than a button: it is not a thing that happens
              when pressed, it is a thing that has a position, and saying so is
              what lets it report where it has been put. Focusable and answering
              arrows for the same reason the workflow editor's handle does -
              a split that can only be set by holding a pointer down cannot be
              set by everybody.
            */}
            <div
              className={dragging ? `${styles.handle} ${styles.handleDragging}` : styles.handle}
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label={t('Width of the code editor')}
              aria-controls="function-code-column"
              aria-valuenow={editorShare(panelWidth)}
              // The extremes are the minimums, seen from the editor's side: the
              // panel at its widest is the editor at its narrowest.
              aria-valuemin={editorShare(widest)}
              aria-valuemax={editorShare(MIN_PANEL)}
              title={t('Drag to change the split; double-click to put it back')}
              onPointerDown={startSplitDrag}
              onPointerMove={moveSplitDrag}
              onPointerUp={endSplitDrag}
              onPointerCancel={endSplitDrag}
              onKeyDown={onSplitKeyDown}
              onDoubleClick={resetSplit}
            />

            <aside className={styles.panel}>
              <section className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Function Details</h2>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="function-name">
                    {t('Name')}
                  </label>
                  <input
                    id="function-name"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="text"
                    value={name}
                    onFocus={(event) => {
                      // Only the name nobody has chosen yet, and only once: an
                      // existing name is text somebody wants to edit, not
                      // replace.
                      if (creating && !renamed && name === NEW_FUNCTION_NAME) event.target.select();
                    }}
                    onChange={(event) => {
                      setName(event.target.value);
                      setRenamed(true);
                      setSaved(false);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="function-description">
                    {t('Description')}
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
                    {t('Change them')}
                  </Link>
                </p>
              </section>

              <section className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Parameters</h2>
                <div className={styles.paramList}>
                  {params.map((param, index) => (
                    <div key={index} className={styles.paramGroup}>
                      <div className={styles.paramTopLine}>
                      <span className={`${styles.paramField} ${styles.paramFieldName}`}>
                        <label className={styles.paramLabel} htmlFor={`param-name-${index}`}>
                          {t('Name')}
                        </label>
                      <input
                        id={`param-name-${index}`}
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
                      </span>
                      <span className={styles.paramField}>
                        <label className={styles.paramLabel} htmlFor={`param-type-${index}`}>
                          {t('Type')}
                        </label>
                      <span className={styles.typeSelect}>
                        <select
                          id={`param-type-${index}`}
                          className={`${styles.typeBadge} ${styles.typeField}`}
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
                        <img src={chevronDown12Icon} alt="" width={12} height={12} />
                      </span>
                      </span>
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
                      Which object, on a second line inside the same box: the line
                      above is already three controls wide, and an object's name is
                      longer than a type's. Inside, because the name, the type and
                      the object it names are one parameter - a selector sitting
                      below the box read as belonging to nothing.

                      Only ever shown for a parameter that names one — for anything
                      else there is nothing to choose.
                    */}
                    {namesObject(param.type) && (
                      <div className={styles.paramObjectLine}>
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
                          <img src={chevronDown12Icon} alt="" width={12} height={12} />
                        </div>
                        {/*
                          The way to read the shape this parameter names, which the
                          select only names. The trigger and condition forms put the
                          same link beside their pickers; this editor is where it is
                          wanted most, since the code below is being written against
                          that shape and the select says nothing about its fields.

                          A tab of its own, for the reason the way out to Variables
                          gives further down: this editor has nothing listening for a
                          navigation away, so the same tab would throw out the code
                          being written without saying so.
                        */}
                        {param.objectId !== null && param.objectId !== undefined && param.objectId !== '' && (
                          <Link
                            className={styles.jump}
                            to={`/workspace/${workspaceId}/objects/${param.objectId}`}
                            target="_blank"
                            rel="noreferrer"
                            title={t('Opens the object\'s definition in a new tab')}
                            aria-label={`Open definition of ${objectNameOf(param.objectId) ?? 'the object'} for ${param.name || `parameter ${index + 1}`}`}
                          >
                            {/*
                              The mark alone. "Open definition ↗" was two words
                              and an arrow on a line that also has to hold a
                              select and an object's name, and it took the room
                              the name needed. The mark says what it does; the
                              words live on in the title and the aria-label,
                              which is what a pointer and a screen reader get.
                            */}
                            <OpenDefinitionIcon />
                          </Link>
                        )}
                      </div>
                    )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.addParam}
                    onClick={() => setParams((current) => [...current, { name: '', type: 'STRING' }])}
                  >
                    <img src={plusIcon} alt="" width={14} height={14} />
                    {t('Add Parameter')}
                  </button>
                </div>
              </section>

              {/*
                What the workspace hands it, as opposed to what a caller does.
                Appended to the signature in the order they are listed, so a
                script reads them as ordinary arguments after its own.
              */}
              <section className={styles.panelSection}>
                <span className={styles.headingWithHint}>
                  <h2 className={styles.panelHeading}>External Parameters</h2>
                  <FieldHint label={t('External Parameters')}>
                    The workspace’s values, handed to this function after its own parameters. Their values are
                    never shown here — which is why a variable that is set looks empty on this page: what is
                    chosen is the name, and only the sandbox ever sees what is behind it.
                  </FieldHint>
                </span>
                <div className={styles.paramList}>
                  {externals.map((variableId, index) => {
                    const held = variables.find((candidate) => candidate.id === variableId);
                    return (
                      <div key={`${variableId}-${index}`} className={styles.paramRow}>
                        <select
                          className={`${styles.paramName} ${styles.inputMono}`}
                          value={variableId}
                          aria-label={`External parameter ${index + 1}`}
                          /*
                            Reaching for the list is a reason to read it again:
                            somebody about to change what this function is handed
                            has often just been to the Variables page to make it.
                          */
                          onMouseDown={refreshVariables}
                          onFocus={refreshVariables}
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
                        ? t('This workspace has no variables yet')
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
                    {t('Add External')}
                  </button>
                  {/*
                    A way out to where these are defined, which the sentence
                    below describes and did not offer - most of all in the empty
                    case, which tells somebody to define a variable first and
                    then leaves them to find the page themselves.

                    A new tab, unlike "Change them" further up this panel. That
                    one is a rare deliberate detour; this is reached in the
                    middle of writing a function that wants a variable, and this
                    editor - unlike the workflow editor - has nothing listening
                    for a navigation away, so the same tab would discard the
                    code being written without saying so.
                  */}
                  {/*
                    What is left in the open, once the explanation has moved
                    behind the (?) on the heading: the state of the thing being
                    looked at - there are no variables to choose from - and the
                    way to the page that fixes that.

                    The link does not move. A (?) that swallows a navigation
                    control makes the control unreachable, which is worse than
                    the paragraph it came from; and this is the one somebody
                    reaches for in the middle of writing a function that wants a
                    variable that does not exist yet.
                  */}
                  <p className={styles.paramHint}>
                    {variables.length === 0
                      ? 'Define a variable first; externals are chosen from what the workspace keeps. '
                      : ''}
                    <a
                      className={styles.shortcutLink}
                      href={`/workspace/${workspaceId}/variables`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {t('Open Variables')}
                    </a>
                  </p>
                </div>
              </section>

              {/*
                What this function calls, as opposed to what it is handed.

                Reached through the sandbox's `imports` object rather than through
                the signature, so a row here changes what the code may call and not
                what it has to accept - which is why this section is beside the
                parameters rather than another kind of them.

                Only the workspace's own functions are offered. The server refuses a
                plugin's, refuses a loop and refuses this function itself; the first
                two of those are not worth offering, and its refusal is what says so
                for the third.
              */}
              <section className={styles.panelSection}>
                <span className={styles.headingWithHint}>
                  <h2 className={styles.panelHeading}>Imports</h2>
                  <FieldHint label={t('Imports')}>
                    The workspace’s other functions this one may call, as <code>imports.name(…)</code>. The name is
                    this code’s own word for it: renaming the function it points at changes nothing here. A
                    plugin’s function cannot be imported, and neither can a loop back to this one.
                  </FieldHint>
                </span>
                <div className={styles.paramList}>
                  {imports.map((held, index) => (
                    <div key={index} className={styles.paramRow}>
                      <select
                        className={`${styles.paramName} ${styles.inputMono}`}
                        value={held.functionId}
                        aria-label={`Import ${index + 1} function`}
                        onChange={(event) => {
                          const chosen = importable.find((fn) => fn.id === event.target.value);
                          setImports((current) =>
                            current.map((row, at) =>
                              at === index
                                ? {
                                    ...row,
                                    functionId: event.target.value,
                                    /*
                                     * Only ever filled in, never rewritten. The name
                                     * is what the code below already says, and moving
                                     * an import to another function is not a request
                                     * to go through the code renaming the calls.
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
                          function deleted out from under this one, or the list
                          not yet fetched. Without it the select would show the
                          first option and read as though the import had been
                          quietly moved.
                        */}
                        {!importable.some((fn) => fn.id === held.functionId) && (
                          <option value={held.functionId}>{held.function?.name ?? '—'}</option>
                        )}
                        {importable.map((fn) => (
                          <option key={fn.id} value={fn.id}>
                            {fn.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className={`${styles.paramName} ${styles.inputMono}`}
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
                        className={styles.removeParam}
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
                    className={styles.addParam}
                    disabled={importable.length === 0}
                    title={
                      importable.length === 0
                        ? t('This workspace has no other functions to import')
                        : t('Call one of the workspace’s other functions from this one')
                    }
                    onClick={() => {
                      /*
                        One that is not imported already, so the row arrives
                        pointing at something and under a name the server would
                        take. The same choice Add External makes.
                      */
                      const next =
                        importable.find((fn) => !imports.some((held) => held.functionId === fn.id)) ??
                        importable[0];
                      if (next === undefined) return;
                      setImports((current) => [
                        ...current,
                        { functionId: next.id, name: next.name, function: null },
                      ]);
                      setSaved(false);
                    }}
                  >
                    <img src={plusIcon} alt="" width={14} height={14} />
                    {t('Add Import')}
                  </button>
                </div>
              </section>

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
              <section className={styles.panelSection}>
                <span className={styles.headingWithHint}>
                  <h2 className={styles.panelHeading}>Libraries</h2>
                  <FieldHint label={t('Libraries')}>
                    The installation’s libraries this function may use, reached as <code>imports.name</code>.
                    The name is this code’s own word for it and is seeded from the library’s key the first
                    time a row points at one. An administrator loads them, on Admin → Libraries.
                  </FieldHint>
                </span>
                <div className={styles.paramList}>
                  {libraries.map((held, index) => (
                    <div key={index} className={styles.paramRow}>
                      <select
                        className={`${styles.paramName} ${styles.inputMono}`}
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
                                     * Only ever filled in, never rewritten - the
                                     * same rule an import's name follows, for the
                                     * same reason: the code below already says
                                     * `imports.dateFns`.
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
                          removed out from under this function, or the list not
                          yet fetched.
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
                        className={`${styles.paramName} ${styles.inputMono}`}
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
                        className={styles.removeParam}
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
                    className={styles.addParam}
                    disabled={loadable.length === 0}
                    title={
                      loadable.length === 0
                        ? t('No libraries are loaded into this installation')
                        : t('Use one of the installation’s libraries from this function')
                    }
                    onClick={() => {
                      /*
                        One that is not used already, so the row arrives pointing
                        at something and under a name the server would take. The
                        same choice Add Import makes.
                      */
                      const next =
                        loadable.find((one) => !libraries.some((held) => held.libraryId === one.id)) ??
                        loadable[0];
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
              </section>

              <section className={styles.panelSection}>
                <span className={styles.headingWithHint}>
                  <h2 className={styles.panelHeading}>Return Type</h2>
                  <FieldHint label={t('Return Type')}>
                    An object names a shape this workspace defines, and the editor checks the code against it. Map
                    is for a structure with no defined shape.
                  </FieldHint>
                </span>
                <div className={styles.selectWrapper}>
                  <select
                    className={`${styles.input} ${styles.inputMono}`}
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
                  /* Beside the select, exactly as a parameter's is: one rule for
                     reaching an object's definition, wherever this panel names one. */
                  <div className={styles.paramObjectLine}>
                    <div className={styles.selectWrapper}>
                      <select
                        className={`${styles.input} ${styles.inputMono}`}
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
                        className={styles.jump}
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
                  What the workspace has, which is a state and not an
                  explanation: what an object type *means* has gone behind the
                  (?) on the heading, and this says only that there are none to
                  name yet.

                  The link stays in the open with it, and only in this case, for
                  the reason the Variables one does: there is no definition to
                  jump to yet, and a sentence that says to define one otherwise
                  leaves somebody to find the page themselves. Once objects
                  exist, the way out is the "Open definition" link beside the
                  select, not a second one here - and this paragraph is gone
                  altogether.
                */}
                {objects.length === 0 && (
                  <p className={styles.paramHint}>
                    {t('There are no objects in this workspace yet, so define one first or use map.')}{' '}
                    <Link
                      className={styles.shortcutLink}
                      to={`/workspace/${workspaceId}/objects`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('Open Objects')}
                    </Link>
                  </p>
                )}
              </section>

              {/*
                Running it, which is what Validate never could — issue #266.

                Not offered while a function is being written: there is nothing to
                run until there is a row, and the button takes an id.

                Every field here is a parameter with a type, offered as that type,
                rather than one JSON box: a number field is where somebody types a
                number, and asking them to remember that a string needs quotes is
                asking them to do the editor's job. The shapes that have no
                spelling as a plain word — map, array, an object — are the
                exception and are typed as JSON, because that is what they are.

                The externals are not here and must not be. A grant belongs to the
                function; a field for one would let a test run be given a value the
                real run would never see, and the run would prove nothing about the
                function it was run on.
              */}
              {!creating && (
                <section className={styles.panelSection}>
                  <span className={styles.headingWithHint}>
                    <h2 className={styles.panelHeading}>Test Run</h2>
                    <FieldHint label={t('Test Run')}>
                      Runs the saved function the way an action node would: the same sandbox, the same imports
                      and libraries, and the workspace’s variables resolved the same way. It runs what is stored
                      rather than what is in the column, so save first to try a change — and every run is
                      recorded in this workspace’s audit, because it leaves no run of its own behind it.
                    </FieldHint>
                  </span>

                  <div className={styles.paramList}>
                    {declared(params).map((param) => (
                      <div key={param.name} className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={`run-arg-${param.name}`}>
                          {param.name} · {valueTypeLabel(param.type)}
                        </label>
                        {param.type === 'BOOLEAN' ? (
                          <div className={styles.selectWrapper}>
                            <select
                              id={`run-arg-${param.name}`}
                              className={`${styles.input} ${styles.inputMono}`}
                              value={testValues[param.name] ?? ''}
                              aria-label={`Argument ${param.name}`}
                              onChange={(event) =>
                                setTestValues((current) => ({ ...current, [param.name]: event.target.value }))
                              }
                            >
                              {/* Blank is a real answer: it is the `null` an unmapped node passes. */}
                              <option value="">nothing</option>
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                            <img src={chevronDown12Icon} alt="" width={12} height={12} />
                          </div>
                        ) : param.type === 'STRING' || param.type === 'NUMBER' ? (
                          <input
                            id={`run-arg-${param.name}`}
                            className={`${styles.input} ${styles.inputMono}`}
                            type={param.type === 'NUMBER' ? 'number' : 'text'}
                            value={testValues[param.name] ?? ''}
                            aria-label={`Argument ${param.name}`}
                            onChange={(event) =>
                              setTestValues((current) => ({ ...current, [param.name]: event.target.value }))
                            }
                          />
                        ) : (
                          <textarea
                            id={`run-arg-${param.name}`}
                            className={`${styles.input} ${styles.textarea} ${styles.inputMono}`}
                            value={testValues[param.name] ?? ''}
                            placeholder={param.type === 'ARRAY' ? '[]' : '{}'}
                            aria-label={`Argument ${param.name}`}
                            onChange={(event) =>
                              setTestValues((current) => ({ ...current, [param.name]: event.target.value }))
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void handleRun()}
                    disabled={running}
                  >
                    {running ? 'Running…' : 'Run'}
                  </button>

                  {/* One line, and only when it is true: the column has moved on. */}
                  {unsaved && <p className={styles.paramHint}>This runs the saved function, not the column.</p>}

                  {runFailed !== null && (
                    <p className={styles.runFailed} role="alert">
                      {runFailed}
                    </p>
                  )}

                  {ran !== null && (
                    <div className={styles.runResult}>
                      <p className={ran.ok ? styles.runVerdict : styles.runVerdictBad} role="status">
                        {ran.ok ? 'Returned' : 'Failed'} in {ran.durationMillis} ms
                      </p>
                      {/*
                        What came back, whichever it was. A failure prints its
                        reason here rather than in a toast, because it is the
                        answer to the question the button asked - and it is
                        worded exactly as the run history would have worded it.
                      */}
                      <pre className={styles.runAnswer}>
                        {ran.ok ? (ran.returned ?? t('It returned nothing.')) : ran.error}
                      </pre>
                      {!ran.ok && !ran.settled && (
                        <p className={styles.paramHint}>It was stopped rather than refused; running it again may answer.</p>
                      )}
                      {ran.grants.length > 0 && (
                        <p className={styles.paramHint}>Handed {ran.grants.join(', ')} from the workspace.</p>
                      )}
                    </div>
                  )}
                </section>
              )}

              <hr className={styles.divider} />

              <div className={styles.metadata}>
                <p className={styles.metadataLabel}>{t('Last modified')}</p>
                <p className={styles.metadataValue}>
                  {creating || fn === null ? (
                    t('Not saved yet')
                  ) : (
                    <>
                      {timeAgo(fn.lastModifiedAt)} by <strong>{fn.lastModifiedBy}</strong>
                    </>
                  )}
                </p>
              </div>

              {/*
                What this function has been. Not while creating one: there is
                nothing it has been yet, and the panel would be asking about an
                id that does not exist.
              */}
              {!creating && (
                <>
                  <hr className={styles.divider} />
                  <RevisionHistory
                    kind="FUNCTION"
                    componentId={functionId}
                    currentName={fn?.name}
                    onRestored={() => {
                      /*
                        The editor is holding the version from before, and its
                        next save would put that back - so it reads the row
                        again, exactly as it does when a suggestion is accepted.
                      */
                      printed.current = null;
                      void fetchFunction(functionId)
                        .then((found) => {
                          if (found === null) return;
                          setFn(found);
                          declaredAs.current = identifier(found.name);
                          setName(found.name);
                          setDescription(found.description ?? '');
                          setSource(found.typescript ?? found.source);
                          setReturnType(found.returnType);
                          setReturnObjectId(found.returnObjectId);
                          setParams(found.params);
                          setExternals(found.externals.map((external) => external.variableId));
                          setImports(found.imports);
        setLibraries(found.libraries);
                          setSaved(false);
                        })
                        .catch(() => undefined);
                    }}
                  />
                  {/*
                    And what leans on it, under what it has been. A function is
                    the most-pointed-at thing this product has - actions call
                    it, conditions ask it, webhooks authenticate with it, other
                    functions and tools import it - so being refused a delete
                    was the only way anybody found out.
                  */}
                  <hr className={styles.divider} />
                  <UsedBy kind="FUNCTION" componentId={functionId} />
                </>
              )}
            </aside>
          </div>
        </>
      )}

      {/*
        Outside the branch above, so it is the same dialog whichever state the
        page is in - and so closing it never depends on what the page happens to
        be showing behind it.
      */}
      <UnsavedWorkDialog
        subject={guard.asking ? called : null}
        creating={creating}
        onStay={guard.stay}
        onLeave={guard.leave}
        onSaveAndLeave={guard.saveAndLeave}
      />
    </AppShell>
  );
}
