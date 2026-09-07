import * as monaco from 'monaco-editor';
import { typescript } from 'monaco-editor';
/*
 * Not the paths every Monaco-with-Vite guide gives. Since 0.56 the package's
 * `exports` map is `"./*": "./esm/vs/*.js"`, so a subpath is already rooted at
 * `esm/vs` — the familiar `monaco-editor/esm/vs/...` spelling resolves to
 * `esm/vs/esm/vs/...` and fails to resolve at build time. The `.js` is required
 * too: rolldown will not resolve an extensionless package subpath.
 */
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

import { currentTheme } from '../session/theme';
import { t } from '../i18n';

/**
 * Monaco, set up once for the whole application.
 *
 * Imported for its side effects as well as its exports: the workers have to be
 * declared before an editor is created, and the themes before one is shown.
 *
 * Only two workers are wired. The editor worker does the work every editor needs,
 * and the TypeScript one is the language service — it is what makes completion,
 * hover and diagnostics possible, and it understands JavaScript as well as
 * TypeScript. JSON, CSS and HTML have workers too and are deliberately left out:
 * nothing here edits them, and each one is a chunk in the build.
 */
declare global {
  // eslint-disable-next-line no-var
  var MonacoEnvironment: monaco.Environment | undefined;
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

/**
 * The editor in this product's colours.
 *
 * Defined from the same values `tokens.css` holds rather than left to Monaco's own
 * dark theme, because an editor that is nearly the colour of the panel around it
 * looks like a bug. The token colours are the ones the old hand-written
 * highlighter used, so the code looks the way it did before Monaco arrived.
 */
const DARK = 'orknux-dark';
const LIGHT = 'orknux-light';

monaco.editor.defineTheme(DARK, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
    { token: 'string', foreground: '22c55e' },
    { token: 'number', foreground: 'd08a1a' },
    { token: 'keyword', foreground: 'c084fc' },
    { token: 'type', foreground: '60a5fa' },
    { token: 'identifier', foreground: 'fafafa' },
  ],
  colors: {
    'editor.background': '#09090b',
    'editor.foreground': '#fafafa',
    'editorLineNumber.foreground': '#52525b',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editor.lineHighlightBackground': '#18181b',
    'editorIndentGuide.background1': '#27272a',
    'editorCursor.foreground': '#fafafa',
    'editor.selectionBackground': '#5f846755',
  },
});

monaco.editor.defineTheme(LIGHT, {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
    { token: 'string', foreground: '15803d' },
    { token: 'number', foreground: 'b45309' },
    { token: 'keyword', foreground: '7e22ce' },
    { token: 'type', foreground: '1d4ed8' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#18181b',
    'editorLineNumber.foreground': '#a1a1aa',
    'editor.lineHighlightBackground': '#f4f4f5',
    'editor.selectionBackground': '#4a6b5233',
  },
});

/** Which theme the editor should be drawn in, following the interface. */
export function editorTheme(): string {
  return currentTheme() === 'light' ? LIGHT : DARK;
}

/**
 * The editor's font, in one place.
 *
 * Exported because the measurement below and the editor that gets created have to
 * agree about it exactly. Two spellings of the same font would mean measuring one
 * thing and drawing another, which is the whole of the bug this fixes.
 */
export const EDITOR_FONT_FAMILY = "'JetBrains Mono', ui-monospace, monospace";
export const EDITOR_FONT_SIZE = 13;

/**
 * Measure the font again once the browser can actually resolve it.
 *
 * Monaco measures character width once, early, and caches it. If it measures before
 * the font is resolvable it caches the *fallback's* metrics and never revisits them
 * — and then every column it computes is wrong by the difference between the two
 * faces, while the text on screen is drawn in the real one.
 *
 * Here that was 7.148px believed against 7.8px drawn: 8.4% narrow. Short lines look
 * fine, which is what makes it so confusing. The error is cumulative, so by column
 * 60 the caret is five characters adrift, End stops short of the text, and a
 * selection ends before the end of the line — all of it worse the longer the line.
 *
 * `remeasureFonts` is Monaco's own answer; it re-reads the metrics and relayouts
 * every editor. Called on the font being ready rather than on a timer, and again on
 * any later font load, because which of the two happens first is not ours to decide.
 */
function remeasureWhenFontIsReady(): void {
  if (typeof document === 'undefined' || document.fonts === undefined) return;

  const remeasure = () => monaco.editor.remeasureFonts();

  // Ask for the exact face the editor asks for, so this waits for the right thing.
  void document.fonts.load(`${EDITOR_FONT_SIZE}px 'JetBrains Mono'`).then(remeasure, remeasure);
  void document.fonts.ready.then(remeasure);
  document.fonts.addEventListener('loadingdone', remeasure);
}

remeasureWhenFontIsReady();

let overflowHost: HTMLElement | null = null;

/**
 * Where completion, hover and parameter hints are drawn.
 *
 * Monaco positions these `fixed`, which resolves against the viewport only while no
 * ancestor establishes a containing block. This application's page transition leaves
 * `transform: matrix(1, 0, 0, 1, 0, 0)` on `<main>` — an identity transform, so it
 * changes nothing visually and everything about positioning: the suggestion list
 * lands relative to `<main>` rather than the caret.
 *
 * So the widgets are given a home on `<body>`, outside anything transformed. It
 * carries the `monaco-editor` class because every widget stylesheet is scoped under
 * it; without that the list renders unstyled.
 *
 * One node, shared by every editor. Never removed: it belongs to the page, not to a
 * particular editor, and tearing it down while a widget is open is a flicker for no
 * gain.
 */
export function overflowWidgetsNode(): HTMLElement {
  if (overflowHost === null) {
    overflowHost = document.createElement('div');
    overflowHost.className = 'monaco-editor monaco-overflow-widgets';
    overflowHost.style.position = 'absolute';
    overflowHost.style.top = '0';
    overflowHost.style.left = '0';
    // Above the page, below a modal dialog — those are in the browser's top layer.
    overflowHost.style.zIndex = '60';
    document.body.appendChild(overflowHost);
  }
  return overflowHost;
}

/*
 * JavaScript is checked by the TypeScript service, and for now checking is off.
 *
 * The service is what provides completion and hover, and it will happily report
 * type errors in plain JavaScript as well — which is exactly what should not
 * happen yet. Every function written before this editor existed would light up red
 * for code that runs correctly. Diagnostics go on once the generated types are in
 * place and its complaints can be trusted.
 */
/*
 * Reached through the top-level `typescript` namespace, not `languages.typescript`
 * — that moved in 0.56 and the old path is now a stub marked deprecated, which
 * fails at compile time rather than silently doing nothing.
 */
typescript.javascriptDefaults.setCompilerOptions({
  allowJs: true,
  checkJs: false,
  /*
   * The newest this Monaco build knows. It bounds what the *editor* understands,
   * not what the sandbox runs — GraalJS is set to ES2023 there — so the editor is
   * slightly the more conservative of the two, which is the safe way round.
   */
  target: typescript.ScriptTarget.ES2020,
  moduleResolution: typescript.ModuleResolutionKind.NodeJs,
  // A workspace's function is a module with a default export, so it is one.
  module: typescript.ModuleKind.ESNext,
  allowNonTsExtensions: true,
});

typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
});

/*
 * The same options for TypeScript, which is what functions are written in now.
 *
 * `target: ES2020` is load-bearing rather than a preference. Compile an `async`
 * function for an older target and TypeScript writes its own helpers into the
 * output — an `__awaiter` and a generator state machine — so the JavaScript
 * reaching the sandbox would be several times the size of what somebody wrote and
 * unreadable beside it. ES2020 has async, optional chaining and the rest natively,
 * so the output is the input with the types taken out.
 */
typescript.typescriptDefaults.setCompilerOptions({
  target: typescript.ScriptTarget.ES2020,
  module: typescript.ModuleKind.ESNext,
  moduleResolution: typescript.ModuleResolutionKind.NodeJs,
  strict: true,
  /*
   * Kept. They are somebody's notes about their own code, and a right-hand column
   * that silently dropped them would be a worse copy of the left for no gain.
   */
  removeComments: false,
  // These models are `inmemory:` URIs, not files on a disk.
  allowNonTsExtensions: true,
});

/**
 * What the sandbox actually provides, declared so the editor knows it too.
 *
 * Without this, `context` is an error in every function that reads the clock, and
 * turning type checking on would light up correct code. With it, the editor's answer
 * about what exists matches `ScriptRunner`'s: one frozen global, and nothing else on
 * top of the language — `print` and `load` are turned off there by name, and host
 * access, files, network and threads are all denied, so anything a browser or Node
 * would offer is absent.
 *
 * Every field is optional because a function is not always called with all of them.
 * An action's function and a condition's are told the time and where they are; a
 * webhook's authentication function is called with nothing at all. Optional is the
 * truthful declaration, and it makes the editor insist on a check that the sandbox
 * would otherwise punish at run time.
 */
const SANDBOX_TYPES = `
declare global {
  /**
   * What this function may know about where it is running. Frozen: what one call
   * writes here is not visible to the next.
   */
  const context: {
    /** When the run started, ISO-8601. The sandbox has a Date, but not this one. */
    readonly now?: string;
    /** The same moment in milliseconds since the epoch. */
    readonly timestamp?: number;
    readonly workspaceId?: number;
    /** The name of whatever is calling: one of these, depending on what it was. */
    readonly action?: string;
    readonly condition?: string;
    readonly agent?: string;
    readonly tool?: string;
  };

  /**
   * A Slack connection in this workspace, as a function is handed one.
   *
   * The type carries the kind so a Jira connection is a mistake the editor
   * catches rather than one the call does: two aliases over an id alone would
   * be interchangeable.
   */
  interface OrknuxConnection<T extends string> {
    readonly id: number;
    readonly type: T;
  }

  type SlackConnection = OrknuxConnection<'SLACK'>;

  /**
   * A connection, however it reached this function.
   *
   * A parameter typed as a connection is handed the id: a payload carries text,
   * so a trigger publishes the one its event arrived on as a string, and a
   * number is what somebody typing one in produces. Whole objects turn up too,
   * from a plugin's settings. All three are the same connection and the call
   * takes any of them.
   */
  type OrknuxConnectionRef = SlackConnection | number | string;

  type SlackThreadMessage = {
    /** Slack's own timestamp, which is also the message's id in its channel. */
    readonly ts: string;
    /**
     * Who wrote it, or the bot that did. Null where Slack said neither, which
     * it does for some app messages - so a function counting distinct people
     * has to drop the nulls rather than trust every message to name somebody.
     */
    readonly user: string | null;
    readonly text: string;
    /** Whether this is the message the thread hangs off. */
    readonly parent: boolean;
  };

  /**
   * What the server found, or why it did not look.
   *
   * A refusal is data rather than a thrown error, because a function has to be
   * able to say something useful about "that connection is gone" — and a
   * condition that cannot be decided must not quietly decide.
   */
  type SlackThread =
    | { messages: SlackThreadMessage[]; replies: number; error?: undefined }
    | { error: string; messages?: undefined; replies?: undefined };

  /** What a post() turned into: the channel and the new message's own "ts", or why not. */
  type SlackPost =
    | { channel: string; ts: string | null; error?: undefined }
    | { error: string; channel?: undefined; ts?: undefined };

  /** Whether a react() went on. Already-reacted counts as ok. */
  type SlackReaction =
    | { ok: true; error?: undefined }
    | { error: string; ok?: undefined };

  type OrknuxRequest = {
    url: string;
    /** Any method; lower case is fine, it is upper-cased on the way out. */
    method?: string;
    headers?: Record<string, string>;
    /** Text is sent as it is. Anything else is sent as JSON. */
    body?: unknown;
  };

  /**
   * What came back, or why nothing did.
   *
   * A refusal is data rather than a thrown error, for the reason a thread's is:
   * a condition that cannot reach a service still has to decide, and an
   * exception makes it undecidable instead of false.
   */
  type OrknuxResponse =
    | {
        status: number;
        headers: Record<string, string>;
        /** The text that arrived, whatever it was. */
        body: string;
        /** The same text parsed, when it was JSON. Absent when it was not. */
        json?: unknown;
        error?: undefined;
      }
    | { error: string; status?: undefined; headers?: undefined; body?: undefined; json?: undefined };

  /**
   * What the *server* will do on this function's behalf.
   *
   * A function has no network and is not getting one — the sandbox is built
   * without it — but there are questions about an outside service that cannot
   * be answered from a payload. What is in this Slack thread is the one this
   * was built for: Slack's message event carries no reply count, so "is this
   * the first reply" is unanswerable from what arrives.
   *
   * So the server makes the call and what crosses is data. It reads only
   * through connections belonging to the workspace this function is running
   * in, which is taken from the run and is not something a function can set.
   */
  const orknux: {
    readonly slack: {
      /**
       * The messages in one Slack thread, oldest first.
       *
       * @param connection which Slack to read through — a workspace with two
       *   has two, and a reply that arrived on one is not in the other.
       * @param channel the channel id the thread is in.
       * @param threadTs the parent message's "ts".
       * @param limit how many messages to bring back. "replies" is Slack's own
       *   count of the whole thread either way.
       */
      thread(
        connection: OrknuxConnectionRef,
        channel: string,
        threadTs: string,
        limit?: number,
      ): SlackThread;

      /**
       * Post a message, through the same kind of connection thread() reads.
       *
       * @param connection which Slack to post through.
       * @param channel the channel id, or a #name or @handle it resolves.
       * @param text what to say.
       * @param threadTs when set, the message joins that thread rather than the
       *   channel. "ts" in the answer is the new message's own timestamp, which
       *   is what react() hangs on and what a reply threads onto.
       */
      post(
        connection: OrknuxConnectionRef,
        channel: string,
        text: string,
        threadTs?: string,
      ): SlackPost;

      /**
       * Add an emoji reaction to a message.
       *
       * @param ts the message's own "ts" — post() returns one, and every thread
       *   message carries one.
       * @param emoji the short name, with or without the colons: "thumbsup" and
       *   ":thumbsup:" both work.
       */
      react(
        connection: OrknuxConnectionRef,
        channel: string,
        ts: string,
        emoji: string,
      ): SlackReaction;
    };

    /**
     * What this function says while it runs.
     *
     * There is no console here and there is not going to be one. A line is
     * built here, crosses as text, and the server writes it under a logger of
     * its own — so what functions say can be turned up without the server
     * getting louder with them.
     *
     * The level is the installation's, not this function's: a call below it is
     * dropped where it was written, so tracing can be left in and costs one
     * comparison while it is turned off. Anything that is not a string is
     * logged as JSON.
     */
    readonly log: {
      debug(...said: unknown[]): void;
      info(...said: unknown[]): void;
      warn(...said: unknown[]): void;
      error(...said: unknown[]): void;
    };

    /**
     * Requests the server makes on this function's behalf.
     *
     * The function never holds a socket: it hands over a URL and gets an answer
     * back as data. Where it may get to is the installation's proxy rules — the
     * same rules a Slack call and an MCP call obey — which this cannot see and
     * cannot argue with.
     *
     * Credentials are not a parameter here. A function is handed its
     * workspace's variables after its own parameters, so the header is built
     * from one of those: a token written into the source would be
     * revision-tracked, exportable, and shown to anything that reads the code.
     */
    readonly http: {
      /**
       * @param what a URL, or an object of url, method, headers, body. An object body
       *   is sent as JSON and given a JSON content type unless one was set.
       */
      request(what: string | OrknuxRequest): OrknuxResponse;
      get(url: string, headers?: Record<string, string>): OrknuxResponse;
      post(url: string, body?: unknown, headers?: Record<string, string>): OrknuxResponse;
    };
  };
}
export {};
`;

const SANDBOX_TYPES_PATH = 'inmemory://orknux/sandbox.d.ts';

/*
 * Registered once per language service. Asked first rather than simply added: the
 * dev server re-evaluates this module on every edit to it, and registering a path
 * that is already there throws — which would take the whole editor down until a
 * full reload, for a file that has not changed.
 */
if (!(SANDBOX_TYPES_PATH in typescript.typescriptDefaults.getExtraLibs())) {
  typescript.typescriptDefaults.addExtraLib(SANDBOX_TYPES, SANDBOX_TYPES_PATH);
}
if (!(SANDBOX_TYPES_PATH in typescript.javascriptDefaults.getExtraLibs())) {
  typescript.javascriptDefaults.addExtraLib(SANDBOX_TYPES, SANDBOX_TYPES_PATH);
}

/*
 * TypeScript is checked, both ways.
 *
 * The point of writing functions in TypeScript is that somebody is told about the
 * mistake before a workflow runs, so semantic validation is on — and it can be
 * trusted, because what the sandbox provides is declared above rather than guessed.
 */
typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});

/** The declaration file holding whatever the current workspace's objects are. */
let declaredObjects: { dispose: () => void } | null = null;

/**
 * Tell the editor about the workspace's objects.
 *
 * Replaced rather than added to, because these belong to whichever workspace is
 * open: carrying one workspace's definitions into the next would offer completions
 * for shapes that are not there, and two workspaces with a `Payload` each would be
 * a redeclaration error in a file nobody can see to fix.
 *
 * Both language services are told. A function is TypeScript now, but the JavaScript
 * service is what serves anything still being read as JavaScript, and an interface
 * it does not know about is a name it cannot complete.
 */
export function declareObjects(source: string): void {
  declaredObjects?.dispose();
  declaredObjects = typescript.typescriptDefaults.addExtraLib(source, OBJECTS_PATH);
}

const OBJECTS_PATH = 'inmemory://orknux/objects.d.ts';

/** The declaration file holding whatever the script being edited imports. */
let declaredImports: { dispose: () => void } | null = null;

/**
 * Tell the editor what `imports` holds for the script open in it.
 *
 * Replaced rather than added to, and for a sharper reason than the objects
 * above: these belong to one script, not even to one workspace. Two functions
 * each importing something under the name `upper` would be a redeclaration
 * error in a file nobody can see to fix, and carrying one script's imports into
 * the next would offer completions for calls that do not exist there.
 *
 * Always replaced with something, never simply disposed. A script with nothing
 * imported still declares an empty `imports`; see `importTypes`.
 */
export function declareImports(source: string): void {
  declaredImports?.dispose();
  declaredImports = typescript.typescriptDefaults.addExtraLib(source, IMPORTS_PATH);
}

const IMPORTS_PATH = 'inmemory://orknux/imports.d.ts';

/** What compiling one function produced, or why it could not be compiled. */
export type Compiled =
  | { ok: true; javascript: string }
  | { ok: false; reason: string; line: number | null };

let compilations = 0;

/**
 * The JavaScript a piece of TypeScript compiles to.
 *
 * Compiled from the string it is handed, in a model of its own that is thrown away
 * afterwards — deliberately not from whichever model an editor happens to be
 * showing. This is what makes the two columns impossible to get out of step: saving
 * compiles the exact text being saved, so the JavaScript that is stored is a
 * function of the TypeScript stored beside it, computed at that moment. There is no
 * cached output to go stale and no path that writes one without the other.
 *
 * Syntax errors are refused rather than emitted. TypeScript will happily produce
 * output from code it could not parse, and that output would be stored as though it
 * were a working function.
 *
 * Type errors are not refused. They are squiggled in the editor and said in the
 * status line, but a type error is an opinion about whether the code is right — it
 * still compiles and still runs, and refusing the save would mean this editor
 * disagreeing with the language about what compiling means.
 */
export async function compile(source: string): Promise<Compiled> {
  compilations += 1;
  const uri = monaco.Uri.parse(`inmemory://orknux/compile-${compilations}.ts`);
  const model = monaco.editor.createModel(source, 'typescript', uri);

  try {
    const accessor = await typeScriptWorker();
    const client = await accessor(uri);
    const name = uri.toString();

    const broken = await client.getSyntacticDiagnostics(name);
    if (broken.length > 0) {
      const first = broken[0];
      return {
        ok: false,
        reason: flatten(first.messageText),
        line: first.start === undefined ? null : model.getPositionAt(first.start).lineNumber,
      };
    }

    const emitted = await client.getEmitOutput(name);
    const javascript = emitted.outputFiles.find((file) => file.name.endsWith('.js'))?.text;
    if (javascript === undefined) {
      return { ok: false, reason: t('The compiler produced no JavaScript for this function.'), line: null };
    }

    return { ok: true, javascript };
  } finally {
    model.dispose();
  }
}

/**
 * The TypeScript worker, once Monaco has actually set the language up.
 *
 * Monaco registers a language's mode lazily — the first time something asks for that
 * language — and `getTypeScriptWorker` throws "TypeScript not registered!" until it
 * has. Inside the function editor that has always happened already, because an
 * editor exists; anywhere else, compiling was the first thing to mention TypeScript
 * and it failed. Creating the model above starts the setup, so this waits for it to
 * finish rather than assuming it has.
 */
async function typeScriptWorker() {
  for (let attempt = 0; attempt < WORKER_ATTEMPTS; attempt += 1) {
    try {
      return await typescript.getTypeScriptWorker();
    } catch (cause) {
      if (attempt === WORKER_ATTEMPTS - 1) throw cause;
      await new Promise((settle) => setTimeout(settle, WORKER_WAIT_MS));
    }
  }
  throw new Error(t('The TypeScript service did not start.'));
}

/** Setting a language up takes a tick or two, not a second. */
const WORKER_ATTEMPTS = 20;
const WORKER_WAIT_MS = 50;

/** One diagnostic's message, which is a string or a chain of them. */
function flatten(message: string | { messageText?: unknown }): string {
  if (typeof message === 'string') return message;
  const text = message.messageText;
  return typeof text === 'string' ? text : t('The TypeScript could not be read.');
}

export { monaco };
