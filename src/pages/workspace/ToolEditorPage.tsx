import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { ValueType } from '../../api/actions';
import {
  VALUE_TYPES,
  fetchWorkspaceFunctions,
  namesObject,
  tsType,
  valueTypeLabel,
} from '../../api/functions';
import type { ScriptImport, WorkspaceFunction } from '../../api/functions';
import { fetchWorkspaceLibraries, localName } from '../../api/libraries';
import type { ScriptLibrary, ScriptLibraryImport, ScriptLibraryImportInput } from '../../api/libraries';
import { fetchWorkspaceObjects } from '../../api/objects';
import type { WorkflowObject } from '../../api/objects';
import type { SessionUser } from '../../api/session';
import {
  deleteTool,
  fetchTool,
  sameToolParameters,
  setToolEnabled,
  timeAgo,
  toolParametersOf,
  updateTool,
  validateToolSource,
  withToolParameters,
} from '../../api/tools';
import type { Tool, ToolParam } from '../../api/tools';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import codeIcon from '../../assets/code.svg';
import plusIcon from '../../assets/plus.svg';
import wandIcon from '../../assets/wand.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { CodeDiff } from '../../components/CodeDiff';
import { CodeEditor } from '../../components/CodeEditor';
import type { CodeEditorHandle } from '../../components/CodeEditor';
import { Loader } from '../../components/Loader';
import { OpenDefinitionIcon } from '../../components/OpenDefinitionIcon';
import { RevisionHistory } from '../../components/RevisionHistory';
import { UnsavedWorkDialog } from '../../components/UnsavedWorkDialog';
import { ValidationStatus } from '../../components/ValidationStatus';
import type { Validation } from '../../components/ValidationStatus';
import { FieldHint } from '../../components/FieldHint';
import { useLeaveGuard } from '../../components/leaveGuard';
import { compile, declareImports, declareObjects } from '../../components/monaco';
import { importTypes } from '../../components/importTypes';
import { objectTypes } from '../../components/objectTypes';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './EditorPage.module.css';

/** The whole of a workspace's shapes fits the picker. */
const OBJECT_PAGE_SIZE = 100;

/** And the whole of its functions fits the one beside it. */
const FUNCTION_PAGE_SIZE = 100;

export interface ToolEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * One tool: the code on the left, what it is on the right.
 *
 * Written in TypeScript, like a function: what an agent may call is code
 * somebody has to read later, and types are how it says what it takes. The
 * sandbox runs JavaScript, so saving compiles and stores both — what runs, and
 * what was written.
 */
export function ToolEditorPage({ session, onSignOut }: ToolEditorPageProps) {
  const { workspaceId = '', toolId = '' } = useParams();
  const navigate = useNavigate();
  const editor = useRef<CodeEditorHandle>(null);

  const [tool, setTool] = useState<Tool | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  /**
   * What this tool takes, in the order the sandbox passes it.
   *
   * The same list the function editor keeps, and kept the same way: the panel
   * and the declaration in the code are one signature written twice, so a
   * change here is written into the code below before it can be saved.
   */
  const [params, setParams] = useState<ToolParam[]>([]);
  /**
   * The workspace's functions this tool calls, under the names it calls them.
   *
   * Not parameters: an import is reached through the sandbox's `imports` object,
   * so adding one changes what the code may call and not what the agent fills in.
   */
  const [imports, setImports] = useState<ScriptImport[]>([]);
  /** What an import may point at: the workspace's own functions. */
  const [importable, setImportable] = useState<WorkspaceFunction[]>([]);
  /**
   * The installation's libraries this tool uses, under the names it uses them by.
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
  /** What a parameter can name, and what the editor declares to Monaco. */
  const [objects, setObjects] = useState<WorkflowObject[]>([]);
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  /**
   * A change the assistant is offering for this tool, if one is open.
   *
   * Claimed off the quick chat: the panel announces a suggestion with a
   * cancelable event, and a page already showing the tool it is for takes it —
   * the diff belongs where the code is, not in a chat column three hundred
   * pixels wide. While one is held the code column shows the change against
   * what is on screen, and the two buttons above it are the only things that
   * touch anything.
   */
  const [offered, setOffered] = useState<{ note: string | null; code: string } | null>(null);
  /** Why the last accept did not land, shown in the bar it was pressed in. */
  const [offerFailed, setOfferFailed] = useState<string | null>(null);

  useEffect(() => {
    if (toolId === '') return;
    fetchTool(toolId)
      .then((found) => {
        if (found === null) {
          setLoadError('That tool does not exist, or you do not have access to it.');
          return;
        }
        apply(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the tool.');
      });
  }, [toolId]);

  function apply(found: Tool) {
    setTool(found);
    setName(found.name);
    setDescription(found.description ?? '');
    setSource(found.typescript ?? found.source);
    setParams(found.params);
    setImports(found.imports);
    setLibraries(found.libraries);
  }

  /*
   * The objects this workspace defines, fetched for two jobs at once: filling
   * the pickers, and being declared to the editor so an annotation naming one
   * resolves. Without the declaration every tool taking an object would be
   * underlined for a type the language service had never heard of.
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
   * What this tool may import: the workspace's own functions.
   *
   * A plugin's is left out because the server refuses one - it belongs to no
   * workspace, so nothing here could reach it - and offering a choice that is
   * always refused is worse than not offering it. Nothing else is filtered: a tool
   * is not something a function can import, so there is no loop to close.
   */
  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceFunctions(workspaceId, 0, FUNCTION_PAGE_SIZE)
      .then((page) => setImportable(page.content.filter((held) => held.scope !== 'PLUGIN')))
      .catch(() => setImportable([]));
  }, [workspaceId]);

  /*
   * What this tool may use: everything loaded into the installation.
   *
   * Not the administrator's query. Choosing to import a library belongs to
   * whoever is writing the tool, so this one answers for any member of the
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
   * marked on the end, and an importer does not pass those - the sandbox does.
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

  /**
   * The parameters as a save would send them: the blank rows dropped, the names
   * as the server will store them.
   *
   * Both sides of every comparison below go through this. A row somebody added
   * and has not named yet is not a change - the save would not carry it - and a
   * name typed with a space after it is the same parameter as the one already
   * stored, so neither should make the editor ask before letting somebody go.
   */
  const declared = (all: ToolParam[]): ToolParam[] =>
    all.filter((param) => param.name.trim() !== '').map((param) => ({ ...param, name: param.name.trim() }));

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
   * one rewrites it; an import appears nowhere in the signature, so a change to one
   * leaves the code alone. Only leaving the page has to know about it.
   */
  const importsMoved = useMemo(() => {
    if (tool === null) return false;
    const was = named(tool.imports);
    const now = named(imports);
    return (
      now.length !== was.length ||
      now.some((held, at) => held.functionId !== was[at].functionId || held.name !== was[at].name)
    );
    // `named` is a plain helper over its argument, and reading it as a dependency
    // would rebuild this on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, imports]);

  /**
   * The libraries a save would send: the unnamed rows dropped, the names trimmed.
   *
   * The same rule `named` applies to the imports, for the same reason - a row
   * pointing at nothing, or one nobody has named yet, is not a library this tool
   * uses and the save would not carry it.
   */
  const chosen = (all: ScriptLibraryImport[]): ScriptLibraryImportInput[] =>
    all
      .filter((held) => held.libraryId !== '' && held.name.trim() !== '')
      .map((held) => ({ libraryId: held.libraryId, name: held.name.trim() }));

  /** Whether the libraries on screen are not the ones the server was told. */
  const librariesMoved = useMemo(() => {
    if (tool === null) return false;
    const was = chosen(tool.libraries);
    const now = chosen(libraries);
    return (
      now.length !== was.length ||
      now.some((held, at) => held.libraryId !== was[at].libraryId || held.name !== was[at].name)
    );
    // `chosen` is a plain helper over its argument, and reading it as a dependency
    // would rebuild this on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, libraries]);

  /** The tool's parameter list, as TypeScript would write it. */
  const declarations = useMemo(
    () =>
      params
        .filter((param) => param.name.trim() !== '')
        .map((param) => `${param.name.trim()}: ${tsType(param.type, objectNameOf(param.objectId))}`),
    [params, objects],
  );

  /**
   * Whether the panel says something about the parameters the server has not
   * been told, which is the only thing the code has to be brought into step
   * with.
   *
   * The panel against the stored row, not a count of how many times the effect
   * below has run. Issue #175, found on the function editor and shared here
   * exactly: a pass was skipped after loading, so that a tool whose stored code
   * already disagreed with its own parameter list was left as it was stored.
   * But `declarations` is built from the workspace's objects as well as the
   * panel, and those arrive in a fetch of their own - so the pass being skipped
   * was whichever render came first, and the rewrite landed on the next one,
   * before anybody had touched the page.
   *
   * Asking by value answers it whenever it is asked, and it is why three places
   * that had to remember to hand this effect a pass to do nothing in - a save, an
   * accepted suggestion, the Active badge - no longer have to.
   */
  const panelMoved = useMemo(() => {
    if (tool === null) return false;
    return !sameToolParameters(declared(params), declared(tool.params));
    // `declared` is a plain helper over its arguments, and reading it as a
    // dependency would rebuild this on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, params]);

  /*
   * The code follows the panel.
   *
   * Adding a parameter here rewrites the declaration to take it, because a
   * parameter the code does not bind is one the agent fills and the tool never
   * reads - and finding that out from a tool that quietly ignored an argument
   * is the worst way to find it out.
   *
   * Only while the panel is ahead of the server; see `panelMoved`.
   */
  useEffect(() => {
    if (tool === null || !panelMoved) return;
    setSource((current) => {
      const next = withToolParameters(current, tool.name, declarations);
      if (next !== current) setSaved(false);
      return next;
    });
  }, [tool, declarations, panelMoved]);

  useEffect(() => {
    function onSuggested(event: Event) {
      const held = (event as CustomEvent<{ toolId: string; note: string | null; code: string }>).detail;
      if (held?.toolId !== toolId) return;
      // Claimed: the chat shows a pointer here instead of its own card.
      event.preventDefault();
      setOffered({ note: held.note, code: held.code });
      setOfferFailed(null);
    }
    window.addEventListener('orknux:tool-suggestion', onSuggested);
    return () => window.removeEventListener('orknux:tool-suggestion', onSuggested);
  }, [toolId]);

  /*
   * Somebody accepted a change to this tool in the panel beside it.
   *
   * The page is holding the version from before, and its next save would put
   * that back — so it reloads. Only for this tool: the panel can be used
   * anywhere, and another tool being changed is none of this page's business.
   */
  useEffect(() => {
    function onSaved(event: Event) {
      const held = (event as CustomEvent<{ id: string }>).detail;
      if (held?.id !== toolId) return;
      fetchTool(toolId)
        .then((found) => {
          if (found !== null) apply(found);
        })
        .catch(() => undefined);
    }
    window.addEventListener('orknux:tool-saved', onSaved);
    return () => window.removeEventListener('orknux:tool-saved', onSaved);
  }, [toolId]);

  /** What happened to the offer, said back into the conversation it came from. */
  function settleOffer(said: string) {
    setOffered(null);
    setOfferFailed(null);
    window.dispatchEvent(new CustomEvent('orknux:tool-suggestion-settled', { detail: { said } }));
  }

  /**
   * A failed accept keeps the diff on screen, with the reason above it.
   *
   * Closing it on failure took the change away in the same breath as the error,
   * so the next suggestion arrived into an empty column and Accept was pressed
   * on code nobody had re-read. The model is still told at once.
   */
  function failOffer(shown: string, said: string) {
    setOfferFailed(shown);
    window.dispatchEvent(new CustomEvent('orknux:tool-suggestion-settled', { detail: { said } }));
  }

  /**
   * Accepting compiles here, exactly as Save does, and for the same reason:
   * what runs is stored beside the TypeScript it came from, and this is the
   * only place with a compiler. A proposal that will not compile is refused
   * with the compiler's reason, and the assistant is told it — its next attempt
   * should be at the actual problem.
   */
  async function acceptOffer() {
    if (offered === null || tool === null || saving) return;
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
       * The assistant is asked for a whole tool, and its parameters are in the
       * declaration it wrote - so the panel is derived from the same text that
       * is about to be compiled rather than left saying what the tool took
       * before. That is what makes the two impossible to disagree.
       */
      const read = toolParametersOf(offered.code, tool.name, objects, params);
      if ('problem' in read) {
        failOffer(
          `The parameters could not be read - ${read.problem}.`,
          `I tried to accept it and could not read its parameters - ${read.problem}. It was not saved.`,
        );
        return;
      }

      const moved = !sameToolParameters(read.params, params);
      const stored = await updateTool(tool.id, {
        source: emitted.javascript,
        typescript: offered.code,
        params: moved ? read.params : undefined,
      });
      apply(stored);
      setSaved(true);
      setStatus({
        ok: true,
        message: moved ? 'The suggested change is saved, parameters and all.' : 'The suggested change is saved.',
        whole: true,
      });
      settleOffer('I accepted the change and it is saved.');
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'It could not be saved.';
      failOffer(
        `The save was refused — ${reason}`,
        `I tried to accept it and it could not be saved — ${reason}. It was not saved.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    try {
      const emitted = await compile(source);
      if (!emitted.ok) {
        setStatus({
          ok: false,
          message: emitted.line === null ? emitted.reason : `Line ${emitted.line}: ${emitted.reason}`,
        });
        return;
      }

      // The compiled JavaScript, because that is what the sandbox is handed.
      const checked = await validateToolSource(workspaceId, emitted.javascript);
      setStatus(
        checked.valid
          ? { ok: true, message: "the code compiles and the sandbox's parser accepts it" }
          : {
              ok: false,
              message:
                checked.line === null
                  ? (checked.message ?? 'Could not be parsed')
                  : `Line ${checked.line}: ${checked.message ?? 'could not be parsed'}`,
            },
      );
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not validate.', whole: true });
    }
  }

  /**
   * Stores what is on screen, and says whether it landed.
   *
   * The answer is for `Save & Leave` in the dialog below: leaving on a save the
   * compiler or the server would not take is exactly the loss the whole guard
   * exists to prevent, so every way out of here has to be distinguishable.
   */
  async function handleSave(): Promise<boolean> {
    if (tool === null || saving) return false;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const emitted = await compile(source);
      if (!emitted.ok) {
        setStatus({
          ok: false,
          message: emitted.line === null ? emitted.reason : `Line ${emitted.line}: ${emitted.reason}`,
        });
        return false;
      }

      apply(
        await updateTool(tool.id, {
          name: name.trim(),
          description: description.trim(),
          source: emitted.javascript,
          typescript: source,
          // A half-written row is not a parameter yet, and sending it would be
          // refused for a name no script can be called by.
          params: params.filter((param) => param.name.trim() !== ''),
          // The same rule for an import: a row nobody has named is not one yet.
          imports: named(imports),
          // And for a library.
          libraries: chosen(libraries),
        }),
      );
      setSaved(true);
      setStatus({ ok: true, message: "the code compiles and the sandbox's parser accepts it" });
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the tool.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * There is work on this screen the server has not been told about.
   *
   * Measured against what was loaded, not against whether anybody has typed.
   * The page keeps a `saved` flag as well - it is what lights the green
   * "Saved." - but a flag can only ever say that a key was pressed. Somebody
   * who types a character and deletes it has changed nothing, and being asked
   * to confirm losing nothing is how a prompt teaches people to click through
   * prompts. The same comparison the function editor makes, over the four
   * things a tool is.
   *
   * `tool` is the baseline and it maintains itself: `apply` sets it on load,
   * from what a save stored, and from what a suggestion accepted in the panel
   * was stored as. So saving and then leaving asks nothing.
   *
   * A tool is always one that exists - there is no create route to this page -
   * so a null baseline means still loading, and there is nothing to lose yet.
   */
  const unsaved = useMemo(() => {
    if (tool === null) return false;
    return (
      name.trim() !== tool.name.trim() ||
      description.trim() !== (tool.description ?? '').trim() ||
      source !== (tool.typescript ?? tool.source) ||
      // The parameters a save would send, which the code column is kept in step
      // with above and so is asked for once.
      panelMoved ||
      // The imports, which the code column knows nothing about; see `importsMoved`.
      importsMoved ||
      // And the libraries, which it knows nothing about either.
      librariesMoved
    );
  }, [tool, name, description, source, panelMoved, importsMoved, librariesMoved]);

  /*
   * The three ways out, and the question before any of them: a link, a Back
   * press, a closed tab. Shared with the function and object editors, because
   * all three lose work the same way; see `useLeaveGuard`.
   */
  const guard = useLeaveGuard({
    unsaved,
    backTo: `/workspace/${workspaceId}/tools`,
    save: handleSave,
  });

  /**
   * Active/Inactive, pressed.
   *
   * Only what the press actually changed is taken out of the answer. The
   * mutation replies with the whole tool and this used to put that through
   * `apply`, which is the function that fills the form on load - so the name,
   * the description, the code and the parameter list were all replaced by the
   * stored copy, and pressing the badge over a draft threw the draft away with
   * no dialog and nothing to undo it with (issue #155). The server's answer to
   * "set enabled" has no business rewriting the code column.
   *
   * The guard above is about *leaving* and cannot help here: a press is not a
   * navigation. Which is also why the baseline is patched rather than replaced.
   * `tool` is what `unsaved` compares against, and for the four things a tool is
   * the stored copy has not moved - so a new object holding the same four values
   * would change nothing anybody can see, and would only re-run the effect that
   * rewrites the declaration over code somebody is in the middle of typing.
   *
   * `lastModifiedAt` and `lastModifiedBy` come across as well: turning a tool
   * off is a change to the row, and the panel that says when it last changed
   * should not go on naming the time before this one.
   */
  async function handleToggle() {
    if (tool === null) return;
    try {
      const { enabled, lastModifiedAt, lastModifiedBy } = await setToolEnabled(tool.id, !tool.enabled);
      setTool((current) => (current === null ? current : { ...current, enabled, lastModifiedAt, lastModifiedBy }));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not change the tool.');
    }
  }

  async function handleDelete() {
    if (tool === null || removing) return;
    setRemoving(true);
    try {
      await deleteTool(tool.id);
      navigate(`/workspace/${workspaceId}/tools`);
    } catch (cause) {
      setRemoving(false);
      setSaveError(cause instanceof Error ? cause.message : 'Could not delete the tool.');
    }
  }

  return (
    <AppShell
      title={tool?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/tools`} label="Tools" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/tools`}>
            Tools
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{tool?.name ?? '…'}</span>
        </p>
        <div className={styles.headerRow}>
          <div className={styles.titleGroup}>
            <h1 className={styles.pageTitle}>{tool?.name ?? 'Tool'}</h1>
            {tool !== null && (
              <button
                type="button"
                className={tool.enabled ? styles.activeBadge : styles.inactiveBadge}
                onClick={() => void handleToggle()}
                title={tool.enabled ? 'Disable this tool' : 'Enable this tool'}
              >
                {tool.enabled ? 'Active' : 'Inactive'}
              </button>
            )}
          </div>
          <div className={styles.actions}>
            {/*
              Help, offered where the work is. The wand opens the quick chat; on
              a conversation that has not started it also asks the first
              question, so one click goes from stuck to being helped — a
              conversation already under way is joined, not talked over.
            */}
            <button
              type="button"
              className={styles.wandButton}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('orknux:quick-chat', { detail: { opener: 'Can you help me with that?' } }),
                )
              }
              aria-label="Ask the assistant for help with this tool"
              title="Ask the assistant for help"
            >
              <img src={wandIcon} alt="" width={16} height={16} />
            </button>
            {/*
              Beside the button it is about, not down in the footer where it
              used to sit - and in the button's own word. See `ValidationStatus`.
            */}
            <ValidationStatus
              subject="The code"
              status={status}
              saved={saved}
              explains={
                <>
                  Validate compiles the TypeScript in the column and hands the JavaScript to the parser that will
                  actually run it — the sandbox's, not the editor's. It answers whether this tool would load, and
                  says which line stopped it if it would not. It does not call the tool.
                </>
              }
            />
            <button type="button" className={styles.secondaryButton} onClick={() => void handleValidate()}>
              Validate
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleSave()}
              disabled={saving || tool === null}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </header>

      {loadError !== null ? (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      ) : tool === null ? (
        <Loader />
      ) : (
        <>
          {saveError !== null && (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
          {saved && saveError === null && <p className={styles.saved}>Saved.</p>}

          <div className={styles.split}>
            <section className={styles.editorCard}>
              <header className={styles.editorHeader}>
                <span className={styles.editorTitle}>
                  <img src={codeIcon} alt="" width={16} height={16} />
                  Editor
                </span>
                <span className={styles.formatBadge}>TypeScript</span>
              </header>

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
                        : 'The assistant suggests this change.')}
                  </span>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void acceptOffer()}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => settleOffer('I rejected the change. The tool is unchanged.')}
                    disabled={saving}
                  >
                    Reject
                  </button>
                </div>
              )}
              <div className={styles.codeArea}>
                {offered === null ? (
                  <CodeEditor
                    ref={editor}
                    value={source}
                    language="typescript"
                    ariaLabel="Tool source"
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
                  <CodeDiff original={source} modified={offered.code} ariaLabel="Suggested change" />
                )}
              </div>

              {/* Where the caret is, and nothing else; see the function editor. */}
              <footer className={`${styles.editorFooter} ${styles.editorFooterEnd}`}>
                <span className={styles.caret}>
                  Ln {caret.line}, Col {caret.column}
                </span>
              </footer>
            </section>

            <aside className={styles.panel}>
              <div className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Tool Details</h2>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="tool-name">
                    Name
                  </label>
                  <input
                    id="tool-name"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="tool-description">
                    Description
                  </label>
                  <textarea
                    id="tool-description"
                    className={styles.textarea}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setSaved(false);
                    }}
                    placeholder="What an agent reads to decide whether to call this."
                  />
                </div>
              </div>

              {/*
                What the tool takes, and the reason this page exists in this
                shape: a tool's arguments used to be one hard-coded `input` an
                agent had to guess the contents of from the description above.
                They are declared here now, exactly as a function's are, and the
                declaration in the code follows what is typed here.
              */}
              <div className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Parameters</h2>
                <div className={styles.paramList}>
                  {params.map((param, index) => (
                    <Fragment key={index}>
                      <div className={styles.paramRow}>
                        <div className={styles.paramTopLine}>
                          <span className={`${styles.paramField} ${styles.paramFieldName}`}>
                            <label className={styles.paramLabel} htmlFor={`param-name-${index}`}>
                              Name
                            </label>
                            <input
                              id={`param-name-${index}`}
                              className={`${styles.paramName} ${styles.inputMono}`}
                              type="text"
                              value={param.name}
                              aria-label={`Parameter ${index + 1} name`}
                              onChange={(event) => {
                                setParams((current) =>
                                  current.map((row, at) => (at === index ? { ...row, name: event.target.value } : row)),
                                );
                                setSaved(false);
                              }}
                            />
                          </span>
                          <span className={styles.paramField}>
                            <label className={styles.paramLabel} htmlFor={`param-type-${index}`}>
                              Type
                            </label>
                            <span className={styles.paramTypeSelect}>
                              <select
                                id={`param-type-${index}`}
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
                                            objectId: namesObject(type) ? (row.objectId ?? objects[0]?.id ?? null) : null,
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
                          Which object, on a second line inside the same box: the
                          line above is already three controls wide, and an
                          object's name is longer than a type's. Inside, because
                          the name, the type and the object it names are one
                          parameter.
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
                            {param.objectId !== null && param.objectId !== undefined && param.objectId !== '' && (
                              <Link
                                className={styles.jump}
                                to={`/workspace/${workspaceId}/objects/${param.objectId}`}
                                target="_blank"
                                rel="noreferrer"
                                title="Opens the object's definition in a new tab"
                                aria-label={`Open definition of ${objectNameOf(param.objectId) ?? 'the object'} for ${param.name || `parameter ${index + 1}`}`}
                              >
                                {/*
                                  The mark alone, like the ten other jumps to a
                                  definition. This one kept the words and the
                                  arrow long enough to become the only place in
                                  the product still saying them - on a line that
                                  also holds a select and an object's name, so
                                  the words took the room the name needed. They
                                  live on in the title and the aria-label, which
                                  is what a pointer and a screen reader get.
                                */}
                                <OpenDefinitionIcon />
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    </Fragment>
                  ))}
                  <button
                    type="button"
                    className={styles.addParam}
                    onClick={() => {
                      setParams((current) => [...current, { name: '', type: 'STRING' }]);
                      setSaved(false);
                    }}
                  >
                    <img src={plusIcon} alt="" width={12} height={12} />
                    Add Parameter
                  </button>
                </div>
                <p className={styles.paramHint}>
                  An agent calling this tool fills these in by name. The declaration below takes them in this order.
                </p>
              </div>

              {/*
                What this tool calls, as opposed to what it is given.

                Reached through the sandbox's `imports` object rather than through
                the declaration, so a row here changes what the code may call and
                not what the agent has to fill in - which is why it is a section of
                its own and not another kind of parameter.

                One direction only: a tool imports a function, and nothing imports a
                tool, so there is no loop for the server to refuse.
              */}
              <div className={styles.panelSection}>
                <span className={styles.headingWithHint}>
                  <h2 className={styles.panelHeading}>Imports</h2>
                  <FieldHint label="Imports">
                    The workspace’s functions this tool may call, as <code>imports.name(…)</code>. The name is this
                    code’s own word for it: renaming the function it points at changes nothing here. A plugin’s
                    function cannot be imported.
                  </FieldHint>
                </span>
                <div className={styles.paramList}>
                  {imports.map((held, index) => (
                    <div key={index} className={styles.paramRow}>
                      <div className={styles.paramTopLine}>
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
                                       * Only ever filled in, never rewritten. The
                                       * name is what the code below already says,
                                       * and moving an import to another function is
                                       * not a request to rename the calls.
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
                            function deleted out from under this tool, or the list
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
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.addParam}
                    disabled={importable.length === 0}
                    title={
                      importable.length === 0
                        ? 'This workspace has no functions to import'
                        : 'Call one of the workspace’s functions from this tool'
                    }
                    onClick={() => {
                      /*
                        One that is not imported already, so the row arrives
                        pointing at something and under a name the server would
                        take.
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
                    <img src={plusIcon} alt="" width={12} height={12} />
                    Add Import
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
              <div className={styles.panelSection}>
                <span className={styles.headingWithHint}>
                  <h2 className={styles.panelHeading}>Libraries</h2>
                  <FieldHint label="Libraries">
                    The installation’s libraries this tool may use, reached as <code>imports.name</code>. The
                    name is this code’s own word for it and is seeded from the library’s key the first time a
                    row points at one. An administrator loads them, on Admin → Libraries.
                  </FieldHint>
                </span>
                <div className={styles.paramList}>
                  {libraries.map((held, index) => (
                    <div key={index} className={styles.paramRow}>
                      <div className={styles.paramTopLine}>
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
                            removed out from under this tool, or the list not yet
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
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.addParam}
                    disabled={loadable.length === 0}
                    title={
                      loadable.length === 0
                        ? 'No libraries are loaded into this installation'
                        : 'Use one of the installation’s libraries from this tool'
                    }
                    onClick={() => {
                      /*
                        One that is not used already, so the row arrives pointing
                        at something and under a name the server would take.
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
                    <img src={plusIcon} alt="" width={12} height={12} />
                    Add Library
                  </button>
                </div>
              </div>

              {tool !== null && (
                <div className={styles.metadata}>
                  <span className={styles.metadataLabel}>Last modified</span>
                  <span className={styles.metadataValue}>
                    {timeAgo(tool.lastModifiedAt)} by <span className={styles.metadataWho}>{tool.lastModifiedBy}</span>
                  </span>
                </div>
              )}

              {/*
                What this tool has been, under the panel that says what it is
                now. A restore rewrites the row, so the page reads it again -
                the editor is holding the version from before, and its next
                save would put that back.
              */}
              <div className={styles.panelSection}>
                <RevisionHistory
                  kind="TOOL"
                  componentId={toolId}
                  currentName={tool?.name}
                  onRestored={() => {
                    void fetchTool(toolId)
                      .then((found) => {
                        if (found !== null) apply(found);
                      })
                      .catch(() => undefined);
                  }}
                />
              </div>

              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => void handleDelete()}
                disabled={removing || tool === null}
              >
                {removing ? 'Deleting…' : 'Delete'}
              </button>
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
        subject={guard.asking ? (tool?.name ?? 'This tool') : null}
        creating={false}
        onStay={guard.stay}
        onLeave={guard.leave}
        onSaveAndLeave={guard.saveAndLeave}
      />
    </AppShell>
  );
}
