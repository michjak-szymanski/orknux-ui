import { compile } from '../components/monaco';
import { ApiError, graphql } from './client';
import { DEPENDANT_FIELDS } from './dependants';
import type { Dependant } from './dependants';

/**
 * One thing a library's export turned out to hold.
 *
 * Not a type declaration. Nothing in a bundle says what its arguments are, so
 * this claims only that a member is something to call or something to read —
 * which is exactly what the editor annotates `imports` from.
 */
export interface LibraryMember {
  name: string;
  /** Whether it is something to call, rather than something to read. */
  callable: boolean;
}


/**
 * JavaScript loaded once into the installation, which any workspace may import.
 *
 * Installation-wide rather than per workspace, and `usedBy` is the reason: what
 * an administrator has to be able to answer is what code is running inside this
 * installation, and no workspace-level screen could answer it.
 */
export interface ScriptLibrary {
  id: string;
  /** Its identity, taken from the filename. Loading this key again replaces it. */
  key: string;
  name: string;
  filename: string;
  sizeBytes: number;
  /** Of the source text, so an unchanged re-upload is recognisable. */
  sha256: string;
  /** Whether its export is itself something to call, rather than an object. */
  callable: boolean;
  /** What its default export turned out to hold, read once when it was loaded. */
  members: LibraryMember[];
  /**
   * Every function and tool that imports it, across every workspace.
   *
   * Empty on [fetchWorkspaceLibraries], which is not a claim that nothing uses
   * it: who else imports a library is an administrator's question.
   *
   * A [Dependant] and not a shape of this screen's own: it is the same row every
   * other component's Used by panel draws, and the same row the delete refusal
   * is worded from. Carrying the id is what lets the libraries table make each
   * importer something to press, which is #268.
   */
  usedBy: Dependant[];
  uploadedAt: string;
  uploadedBy: string;
}

/** What an imported library is, as far as the importer needs to know. */
export interface ImportedLibrary {
  key: string;
  callable: boolean;
  members: LibraryMember[];
}

/**
 * One library a script imports, and the name it imports it under.
 *
 * The same two halves an imported function has, and apart for the same reason:
 * `libraryId` is the reference, and `name` is the importer's own word for it —
 * so replacing a library under the same key disturbs neither.
 */
export interface ScriptLibraryImport {
  libraryId: string;
  /** What the code calls it: `imports.<name>`. */
  name: string;
  /** What was imported. Null only if it went away behind the delete guard's back. */
  library: ImportedLibrary | null;
}

/** A library import as the server's input type takes one, without what it sent back. */
export interface ScriptLibraryImportInput {
  libraryId: string;
  name: string;
}

/**
 * A library import as the server takes one: the reference and the name.
 *
 * What was imported is resolved *by* the server and sent back with the script, so
 * a mutation carrying it is refused outright, for a field the input type does not
 * have. Narrowed here rather than at each call, and exported because functions and
 * tools import the same way.
 */
export function asLibraryInput(held: ScriptLibraryImportInput): ScriptLibraryImportInput {
  return { libraryId: held.libraryId, name: held.name };
}

/**
 * The fields a script carries for one of its library imports.
 *
 * Written out here rather than in `functions.ts` and again in `tools.ts`: the
 * two ask for the same thing, and a field added to one list and not the other is
 * an editor that annotates a tool and not a function.
 */
export const SCRIPT_LIBRARY_IMPORT_FIELDS =
  'libraries { libraryId name library { key callable members { name callable } } }';

const LIBRARY_FIELDS = `
  id key name filename sizeBytes sha256 callable
  members { name callable }
  usedBy { ${DEPENDANT_FIELDS} }
  uploadedAt uploadedBy
`;

/** Everything loaded into the installation, with what imports it. Administrators. */
export async function fetchScriptLibraries(): Promise<ScriptLibrary[]> {
  const data = await graphql<{ scriptLibraries: ScriptLibrary[] }>(
    `query ScriptLibraries { scriptLibraries { ${LIBRARY_FIELDS} } }`,
  );
  return data.scriptLibraries;
}

/**
 * The libraries a workspace may import, for the editors' picker.
 *
 * The same rows without `usedBy`, and not an administrator's query: choosing to
 * import a library belongs to whoever is writing the function, and they should
 * not have to be told who else uses it.
 */
export async function fetchWorkspaceLibraries(workspaceId: string): Promise<ScriptLibrary[]> {
  const data = await graphql<{ workspaceLibraries: ScriptLibrary[] }>(
    `query WorkspaceLibraries($workspaceId: ID!) {
      workspaceLibraries(workspaceId: $workspaceId) { ${LIBRARY_FIELDS} }
    }`,
    { workspaceId },
  );
  return data.workspaceLibraries;
}

/**
 * Takes a library out of the installation.
 *
 * Refused while anything imports it, and the refusal names them — which is the
 * sentence worth showing, so it is left to reach the caller as it came.
 */
export async function deleteScriptLibrary(id: string): Promise<boolean> {
  const data = await graphql<{ deleteScriptLibrary: boolean }>(
    `mutation DeleteScriptLibrary($id: ID!) { deleteScriptLibrary(id: $id) }`,
    { id },
  );
  return data.deleteScriptLibrary;
}

/** What came back from a load: which library it is, and whether it replaced one. */
export interface LoadedLibrary {
  id: string;
  key: string;
  replaced: boolean;
}

/**
 * Loads one library, compiling it first where it was written in TypeScript.
 *
 * The same two acts a plugin's load is, for the same reasons. The sandbox runs
 * JavaScript and the server has no compiler, so what is sent to run is always
 * compiled; what was written is sent alongside and kept, so the library can be
 * downloaded later as the thing somebody wrote.
 *
 * Multipart rather than GraphQL, because what crosses is a file — and `fetch`
 * directly rather than the shared client, since that one sets a JSON content
 * type and a multipart body has to set its own boundary.
 *
 * The key is the filename without the extension, which is the server's rule and
 * not this function's: `date-fns.ts` compiles to `date-fns.js` and loads as
 * `date-fns`, so the name somebody saved the file under is the name it arrives
 * with either way.
 */
export async function uploadLibrary(name: string, written: string): Promise<LoadedLibrary> {
  const isTypeScript = name.endsWith('.ts') || name.endsWith('.mts');

  let javascript = written;
  if (isTypeScript) {
    const compiled = await compile(written);
    if (!compiled.ok) {
      const where = compiled.line === null ? '' : ` on line ${compiled.line}`;
      throw new ApiError(`${name} did not compile${where}: ${compiled.reason}`, 400);
    }
    javascript = compiled.javascript;
  }

  const asJavaScript = isTypeScript ? name.replace(/\.m?ts$/, '.js') : name;
  const form = new FormData();
  form.append('file', new File([javascript], asJavaScript, { type: 'text/javascript' }), asJavaScript);
  if (isTypeScript) form.append('typescript', written);

  const answer = await fetch('/api/libraries', { method: 'POST', body: form, credentials: 'include' });

  if (!answer.ok) {
    // The server explains a refusal — too large, not JavaScript, not a module
    // with a default export — and that sentence is more use than the status code.
    const said = await answer.text().catch(() => '');
    const message = said.trim() === '' ? `Could not load the library (status ${answer.status})` : reason(said);
    throw new ApiError(message, answer.status);
  }

  return (await answer.json()) as LoadedLibrary;
}

/** Where a library's own source can be downloaded: TypeScript where there is any. */
export function librarySourceUrl(id: string): string {
  return `/api/libraries/${id}/source`;
}

/**
 * The name a library arrives under when a row is first pointed at it.
 *
 * A key is what a package is called and a local name is what code says, and the
 * two alphabets differ — `date-fns` is a fine key and not a name anything can be
 * written as. Seeded once and never rewritten afterwards, exactly as an imported
 * function's is: the code below already says `imports.dateFns`, and moving the
 * row is not a request to go through it renaming the calls.
 */
export function localName(key: string): string {
  const camel = key
    .trim()
    .replace(/[^A-Za-z0-9]+(.)?/g, (_whole, next: string | undefined) =>
      next === undefined ? '' : next.toUpperCase(),
    );
  if (camel === '') return 'library';
  return /^[A-Za-z_$]/.test(camel) ? camel : `_${camel}`;
}

/**
 * Bytes as something to read in a table.
 *
 * The plugins list's, not a second copy of it: a size is a size, and two admin
 * tables rounding differently is how they come to disagree about one number.
 */
export { pluginSize as librarySize } from './plugins';

/** Spring reports an error as JSON with a `message`; anything else is shown as it came. */
function reason(said: string): string {
  try {
    const parsed = JSON.parse(said) as { message?: string };
    return parsed.message?.trim() ?? said;
  } catch {
    return said;
  }
}
