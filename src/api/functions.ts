import { ApiError, graphql } from './client';
import type { PageOf } from './client';
import type { ValueType } from './actions';
import { SCRIPT_LIBRARY_IMPORT_FIELDS, asLibraryInput } from './libraries';
import type { ScriptLibraryImport, ScriptLibraryImportInput } from './libraries';

export interface FunctionParam {
  name: string;
  type: ValueType;
  /** Which of the workspace's objects, when the type is OBJECT. */
  objectId?: string | null;
  /** What that object is called: what the code is annotated with. */
  objectName?: string | null;
}

/** A named piece of JavaScript, run server-side in a sandbox. */
/** A variable a function is handed, after the parameters it declares. */
export interface FunctionExternal {
  variableId: string;
  name: string;
  type: 'STRING' | 'NUMBER' | 'BOOLEAN';
}

/**
 * What an imported function is, as far as the importer needs to know.
 *
 * Enough to annotate `imports` in the editor and to name in a panel what was
 * imported. Not the source: whoever is reading this is writing the call, not the
 * callee, and the callee has an editor of its own.
 */
export interface ImportedFunction {
  name: string;
  description: string | null;
  /** "(city: string, days: number)", the declared parameters and nothing else. */
  signature: string;
  returnType: ValueType;
  /** What its returned object is called, when it returns one. */
  returnObjectName: string | null;
}

/**
 * One function a script imports, and the name it imports it under.
 *
 * Two halves, and they are not the same fact. `functionId` is the reference, held
 * as an id because a reference held by name goes stale the first time somebody
 * renames what it points at; `name` is the importer's own word for it, written
 * into the importer's own code. Shared with tools, which import the same way.
 */
export interface ScriptImport {
  functionId: string;
  /** What the code calls it: `imports.<name>(…)`. */
  name: string;
  /** What was imported. Null only if it went away behind the delete guard's back. */
  function: ImportedFunction | null;
}

/** An import as the server's input type takes one, without what it sent back. */
export interface ScriptImportInput {
  functionId: string;
  name: string;
}

/** Where a function came from, and therefore whether it can be changed here. */
export type FunctionScope = 'WORKSPACE' | 'PLUGIN';

/**
 * The plugin a function came from.
 *
 * Reported on the function itself, because listing plugins needs an administrator
 * and picking a function does not — so a picker can name the plugin without being
 * able to see what is loaded.
 */
export interface FunctionPlugin {
  id: string;
  name: string;
}

export interface WorkspaceFunction {
  id: string;
  /** Null for an organisation function: a plugin declared it, so it has no workspace. */
  workspaceId: string | null;
  scope: FunctionScope;
  /**
   * False for anything a plugin declared. The server refuses those edits as well —
   * this is what lets the screen avoid offering them in the first place.
   */
  editable: boolean;
  /** Which plugin brought it. Null for a workspace's own functions. */
  plugin: FunctionPlugin | null;
  name: string;
  description: string | null;
  /** The JavaScript that runs, compiled from the TypeScript below. */
  source: string;
  /**
   * What it was written in. Null for a plugin's function, and for nothing else —
   * a workspace function's TypeScript is stored with every save.
   */
  typescript: string | null;
  returnType: ValueType;
  /** Which object it returns, when it returns one. */
  returnObjectId: string | null;
  returnObjectName: string | null;
  params: FunctionParam[];
  /** The workspace's variables it is handed, after the parameters it declares. */
  externals: FunctionExternal[];
  /**
   * The workspace's other functions it calls, under the names it calls them.
   *
   * Not arguments: an import is reached through the sandbox's `imports` object,
   * so adding one does not change what the code has to accept.
   */
  imports: ScriptImport[];
  /**
   * The installation's libraries it uses, under the names it uses them by.
   *
   * Reached through the same `imports` object and kept in a list of its own for
   * the reason they are loaded separately: a library belongs to the installation
   * and a function belongs to a workspace, so the two are chosen from different
   * places even though the code calls them the same way.
   */
  libraries: ScriptLibraryImport[];
  /** "(input: object, format: string)", ready for the list. */
  signature: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export interface FunctionValidation {
  valid: boolean;
  message: string | null;
  line: number | null;
  column: number | null;
}

/*
 * The object a parameter names is asked for, not only its type.
 *
 * Without it an object parameter arrives as the bare word OBJECT, and everything
 * downstream that has to write it - the annotation in the code, the signature in
 * the header, the list a suggestion is checked against - falls back to a map. The
 * function then reads as taking a shapeless structure where it takes a Ticket, and
 * the first save turns that reading into the truth.
 */
const FUNCTION_FIELDS =
  `id workspaceId scope editable plugin { id name } name description source typescript returnType
   returnObjectId returnObjectName params { name type objectId objectName }
   externals { variableId name type }
   imports { functionId name function { name description signature returnType returnObjectName } }
   ${SCRIPT_LIBRARY_IMPORT_FIELDS}
   signature lastModifiedAt lastModifiedBy`;

const WORKSPACE_FUNCTIONS_QUERY = `
  query WorkspaceFunctions($workspaceId: ID!, $page: Int!, $size: Int!) {
    workspaceFunctions(workspaceId: $workspaceId, page: $page, size: $size) {
      content { ${FUNCTION_FIELDS} }
      page
      size
      totalElements
      totalPages
    }
  }
`;

const FUNCTION_QUERY = `
  query Function($id: ID!) {
    function(id: $id) { ${FUNCTION_FIELDS} }
  }
`;

const CREATE_FUNCTION_MUTATION = `
  mutation CreateFunction($input: CreateFunctionInput!) {
    createFunction(input: $input) { ${FUNCTION_FIELDS} }
  }
`;

const UPDATE_FUNCTION_MUTATION = `
  mutation UpdateFunction($id: ID!, $input: UpdateFunctionInput!) {
    updateFunction(id: $id, input: $input) { ${FUNCTION_FIELDS} }
  }
`;

const VALIDATE_MUTATION = `
  mutation ValidateFunctionSource($workspaceId: ID!, $source: String!) {
    validateFunctionSource(workspaceId: $workspaceId, source: $source) { valid message line column }
  }
`;

const DELETE_FUNCTION_MUTATION = `
  mutation DeleteFunction($id: ID!) {
    deleteFunction(id: $id)
  }
`;

const RUN_FUNCTION_MUTATION = `
  mutation RunFunction($input: RunFunctionInput!) {
    runFunction(input: $input) { ok returned error durationMillis settled grants }
  }
`;

/**
 * A parameter as the server takes one.
 *
 * The name of the object it points at is resolved *by* the server and sent back
 * with the function, so it belongs to what is read and not to what is written -
 * and a mutation carrying it is refused outright, for a field the input type does
 * not have. Narrowed here rather than at each call, so nothing has to remember.
 */
function asInput(param: FunctionParam): { name: string; type: ValueType; objectId?: string | null } {
  return namesObject(param.type)
    ? { name: param.name, type: param.type, objectId: param.objectId ?? null }
    : { name: param.name, type: param.type };
}

/**
 * An import as the server takes one: the reference and the name, and nothing else.
 *
 * What was imported is resolved *by* the server and sent back with the script, so
 * it belongs to what is read and not to what is written - a mutation carrying it
 * is refused outright, for a field the input type does not have. Narrowed here
 * rather than at each call, and exported because tools import the same way.
 */
export function asImportInput(held: ScriptImportInput): ScriptImportInput {
  return { functionId: held.functionId, name: held.name };
}

/** `page` is 0-based, matching the server. */
export async function fetchWorkspaceFunctions(
  workspaceId: string,
  page: number,
  size: number,
): Promise<PageOf<WorkspaceFunction>> {
  const data = await graphql<{ workspaceFunctions: PageOf<WorkspaceFunction> }>(WORKSPACE_FUNCTIONS_QUERY, {
    workspaceId,
    page,
    size,
  });
  return data.workspaceFunctions;
}

export async function fetchFunction(id: string): Promise<WorkspaceFunction | null> {
  const data = await graphql<{ function: WorkspaceFunction | null }>(FUNCTION_QUERY, { id });
  return data.function;
}

export async function createFunction(input: {
  workspaceId: string;
  name: string;
  description?: string;
  /**
   * The compiled JavaScript. Left out for a new function, which starts from a
   * stub the server writes in both languages; sent only with the TypeScript it
   * was compiled from, which the server insists on.
   */
  source?: string;
  /** The TypeScript `source` was compiled from. The two travel together. */
  typescript?: string;
  returnType?: ValueType;
  /** Required when the return type is OBJECT, ignored otherwise. */
  returnObjectId?: string | null;
  params?: FunctionParam[];
  /** Which of the workspace's variables it is handed, in order. */
  externalVariableIds?: string[];
  /** The workspace's other functions it calls, under the names it calls them. */
  imports?: ScriptImportInput[];
  /** The installation's libraries it uses, under the names it uses them by. */
  libraries?: ScriptLibraryImportInput[];
}): Promise<WorkspaceFunction> {
  const data = await graphql<{ createFunction: WorkspaceFunction }>(CREATE_FUNCTION_MUTATION, {
    input: {
      ...input,
      params: input.params?.map(asInput),
      imports: input.imports?.map(asImportInput),
      libraries: input.libraries?.map(asLibraryInput),
    },
  });
  return data.createFunction;
}

/**
 * Copies a function, code and all.
 *
 * A copy of everything that makes it what it is — the source, the parameters, the
 * externals, the return type — under a name that is free. Composed from `create`
 * rather than asking the server to duplicate: it already accepts every field, so a
 * duplicate is a create with somebody else's contents.
 *
 * The name is `nameCopy`, then `nameCopy2` and upwards. Tried rather than checked:
 * the list a screen holds is one page of the workspace's functions, so asking it
 * whether a name is free would be answering from an incomplete list. The server
 * knows, and says so by refusing.
 */
export async function duplicateFunction(fn: WorkspaceFunction): Promise<WorkspaceFunction> {
  const base = `${fn.name}Copy`;

  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    const name = attempt === 0 ? base : `${base}${attempt + 1}`;
    try {
      return await createFunction({
        // A plugin's function belongs to no workspace; a copy of one is the
        // caller's, so this is only ever reached with a workspace's own.
        workspaceId: fn.workspaceId ?? '',
        name,
        description: fn.description ?? undefined,
        /*
         * Both halves, each with its own declaration renamed. Not a compile of the
         * copy's TypeScript: this runs where no editor is, and a duplicate is a copy
         * of what the original already had — the two were compiled from each other
         * when the original was saved, and renaming a declaration in both keeps that
         * true.
         */
        source: withName(fn.source, fn.name, name),
        typescript: withName(fn.typescript ?? fn.source, fn.name, name),
        returnType: fn.returnType,
        params: fn.params,
        externalVariableIds: fn.externals.map((external) => external.variableId),
        // The copy calls the same functions under the same names: the code being
        // copied says `imports.upper(…)`, and a copy without them would not run.
        imports: fn.imports.map(asImportInput),
        // The same, for the libraries: the code says `imports.dateFns.format(…)`
        // and the copy has to be able to.
        libraries: fn.libraries.map(asLibraryInput),
      });
    } catch (cause) {
      const taken = cause instanceof ApiError && /already exists/i.test(cause.message);
      if (!taken || attempt === NAME_ATTEMPTS - 1) throw cause;
    }
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new Error(`Could not find a free name for a copy of ${fn.name}`);
}

/** How many names to try before giving up and saying so. */
const NAME_ATTEMPTS = 20;

/**
 * The same code, with its declaration renamed.
 *
 * A function called `sssssdsd` whose code still reads `function sss()` runs
 * perfectly — the sandbox calls the default export, not the name — and reads as a
 * mistake every time somebody opens it. That is issue #267, and it is the same
 * complaint a duplicate produced before this existed.
 *
 * What makes it safe to do at all is how narrow it is. **Only the declaration is
 * touched, and only when it bears exactly the name it is being renamed *from*.**
 * A declaration saying something else is somebody's own choice of identifier and
 * is left alone for ever after. **And only when that name appears nowhere else in
 * the file**: a function that calls itself by name would be broken by renaming the
 * declaration alone, and renaming every occurrence would eventually rewrite a
 * string, a property or a comment that happened to match. Where it is not
 * unambiguous the source comes back exactly as it was — code that reads oddly is
 * better than code that was rewritten under somebody.
 *
 * Shared by the two callers that need it: the editor, keeping the declaration in
 * step with the Name field the way it already keeps the parameter list in step
 * with the panel, and `duplicateFunction`, which renames a copy's declaration to
 * match the copy.
 */
export function withName(source: string, from: string, to: string): string {
  const declaration = new RegExp(
    `(export\\s+default\\s+(?:async\\s+)?function\\s*\\*?\\s*)(${escaped(from)})(?=\\s*\\()`,
  );
  if (!declaration.test(source)) return source;

  const elsewhere = new RegExp(`\\b${escaped(from)}\\b`, 'g');
  const occurrences = source.match(elsewhere)?.length ?? 0;
  if (occurrences !== 1) return source;

  return source.replace(declaration, `$1${to}`);
}

/** A name is an identifier, but it is going into a pattern, so it is escaped anyway. */
function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The declaration of the default-exported function, and where its parameters are.
 *
 * Found by matching the declaration and then walking to the closing bracket, because
 * a parameter list can contain brackets of its own — `({ a, b }, c)` — and a pattern
 * that stopped at the first `)` would cut one in half.
 */
function declaration(source: string): { from: number; to: number } | null {
  const match = /export\s+default\s+(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(/.exec(source);
  if (match === null) return null;

  const from = match.index + match[0].length;
  let depth = 1;
  for (let at = from; at < source.length; at += 1) {
    const ch = source[at];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return { from, to: at };
    }
  }
  return null;
}

/** The parameters the code declares, as written, or null if there is no declaration to read. */
export function sourceParameters(source: string): string | null {
  const found = declaration(source);
  return found === null ? null : source.slice(found.from, found.to);
}

/**
 * The same code, taking exactly these parameters.
 *
 * The server refuses to save a function whose code does not accept everything it
 * will be handed, so changing the parameters in the panel has to change the code —
 * otherwise the panel hands you a refusal for something you did on purpose.
 *
 * Only the parameter list is rewritten, and only when the declaration is the shape
 * the editor generates. Anything else — an arrow function, a re-exported binding —
 * is left alone, and the save is refused with an explanation, which is better than
 * quietly rewriting code nobody asked to have rewritten.
 */
export function withParameters(source: string, names: string[]): string {
  const found = declaration(source);
  if (found === null) return source;

  const wanted = names.join(', ');
  if (source.slice(found.from, found.to) === wanted) return source;
  return source.slice(0, found.from) + wanted + source.slice(found.to);
}

/**
 * The written parameter list, split at the commas that separate parameters.
 *
 * Not `text.split(',')`: an annotation has commas of its own — `Record<string,
 * unknown>` is one parameter and contains one — so the split counts what it is
 * inside first. Angle brackets are counted with the others because the
 * annotations here are types, where `<` opens something; quotes are skipped
 * whole, so a literal union like `'eur' | 'usd'` survives.
 */
function splitParameters(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at];
    if (quote !== null) {
      if (ch === '\\') at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    else if (ch === ',' && depth === 0) {
      found.push(text.slice(start, at));
      start = at + 1;
    }
  }
  found.push(text.slice(start));
  return found.map((piece) => piece.trim()).filter((piece) => piece !== '');
}

/**
 * The shape a written annotation stands for, or null if orknux has no such shape.
 *
 * The inverse of `tsType`, and it has to stay its inverse: what the editor writes
 * when a parameter is added is what this has to read back when somebody — or
 * something — writes a parameter into the code by hand. An object is matched by
 * name against the workspace's own, which is how `payload: Ticket` becomes an
 * object parameter pointing at Ticket rather than a type nobody declared.
 */
function typeOfAnnotation(
  annotation: string,
  objects: { id: string; name: string }[],
): FunctionParam | null {
  const written = annotation.trim();
  switch (written) {
    case 'string':
      return { name: '', type: 'STRING' };
    case 'number':
      return { name: '', type: 'NUMBER' };
    case 'boolean':
      return { name: '', type: 'BOOLEAN' };
    case 'Record<string, unknown>':
    case 'Record<string,unknown>':
      return { name: '', type: 'MAP' };
    case 'unknown[]':
      return { name: '', type: 'ARRAY' };
    default: {
      const named = objects.find((object) => object.name === written);
      return named === undefined
        ? null
        : { name: '', type: 'OBJECT', objectId: named.id, objectName: named.name };
    }
  }
}

/**
 * What the code says this function takes, read back off its own declaration.
 *
 * The point of reading it rather than being told it: the assistant offers a whole
 * function, and the parameter list *is* in what it offered. Deriving the details
 * panel from the same text that will be compiled is what makes it impossible for
 * the two to disagree — a parameter added to the signature and not to the code, or
 * the other way round, cannot be expressed.
 *
 * The workspace's variables are handed to a function after the parameters it
 * declares, so the last few entries are theirs and are checked rather than read:
 * code that has dropped one, or renamed it, is refused here instead of being saved
 * as a function whose externals arrive under other names.
 *
 * Either the parameters or a sentence saying what is wrong with the declaration,
 * which is what the assistant is told so its next attempt is at the real problem.
 */
export function parametersOf(
  source: string,
  externals: { name: string }[],
  objects: { id: string; name: string }[],
  known: FunctionParam[],
): { params: FunctionParam[] } | { problem: string } {
  const written = sourceParameters(source);
  if (written === null) {
    return { problem: 'it has no `export default function` declaration to read a parameter list from' };
  }

  const entries = splitParameters(written);
  if (entries.length < externals.length) {
    return {
      problem:
        `it does not accept the ${externals.length === 1 ? 'variable' : 'variables'} this function is handed ` +
        `after its own parameters (${externals.map((external) => external.name).join(', ')}), which come last`,
    };
  }

  const declared = entries.slice(0, entries.length - externals.length);
  const handed = entries.slice(entries.length - externals.length);
  const mismatch = handed.findIndex((entry, at) => nameOf(entry) !== externals[at].name);
  if (mismatch !== -1) {
    return {
      problem:
        `the workspace variable \`${externals[mismatch].name}\` is handed to this function after its own ` +
        'parameters, and the code has to go on accepting it, in that position and under that name',
    };
  }

  const params: FunctionParam[] = [];
  for (const entry of declared) {
    const name = nameOf(entry);
    if (name === null || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      return { problem: `\`${entry}\` is not a parameter this can describe — each one has to be a plain name` };
    }
    /*
     * An unannotated parameter is only a question where it is a new one.
     *
     * JavaScript without annotations is valid TypeScript, and a function stored
     * before the editor annotated anything still reads that way - so a rewrite of
     * the body that leaves `(text)` alone has to go on meaning what `text` already
     * meant. A name nobody has seen before genuinely has no type, and saying so is
     * better than picking one.
     */
    const at = entry.indexOf(':');
    if (at === -1) {
      const already = known.find((param) => param.name === name);
      if (already === undefined) {
        return { problem: `\`${name}\` has no type — write it as \`${name}: string\`, or whatever it really is` };
      }
      params.push(already);
      continue;
    }
    const read = typeOfAnnotation(entry.slice(at + 1), objects);
    if (read === null) {
      return {
        problem:
          `\`${entry.trim()}\` is not a type a parameter can have here. They are \`string\`, \`number\`, ` +
          '`boolean`, `Record<string, unknown>`, `unknown[]`, or the name of one of this workspace\'s objects',
      };
    }
    /*
     * One annotation stands for two shapes, and the parameter it already was
     * settles which.
     *
     * `tsType` writes `Record<string, unknown>` for a map, and for an object
     * whose name it could not resolve - so an object parameter read straight
     * back would come out a map, and accepting a change to the body would
     * quietly retype it. A parameter of the same name that is already an object
     * keeps being one; only a rename or a real retype moves it.
     */
    const was = known.find((param) => param.name === name);
    const kept = read.type === 'MAP' && was?.type === 'OBJECT' ? was : { ...read, name };
    params.push({ ...kept, name });
  }
  return { params };
}

/** The name a written parameter starts with, ignoring what it was annotated with. */
function nameOf(entry: string): string | null {
  const name = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\??\s*(?::|=|$)/.exec(entry);
  return name === null ? null : name[1];
}

/** Whether two parameter lists describe the same thing, name, type and object alike. */
export function sameParameters(one: FunctionParam[], other: FunctionParam[]): boolean {
  if (one.length !== other.length) return false;
  return one.every((param, at) => {
    const against = other[at];
    return (
      param.name === against.name &&
      param.type === against.type &&
      (param.objectId ?? null) === (against.objectId ?? null)
    );
  });
}

/**
 * The code a function starts from, before there is a function to ask for it.
 *
 * The server prints this stub for anything created without code of its own, and
 * that is still where a stored one comes from. This is the same stub printed a
 * moment earlier: a function being written in the editor has no id yet, so
 * nothing on the server can be asked, and a code column with no declaration in
 * it leaves the details panel nothing to keep in step.
 *
 * `declarations` are annotated - `ticket: Ticket` - and in the order the sandbox
 * hands them over, externals last. `returned` is only the declared ones: an
 * external is a workspace value, often a secret, and a stub that handed one to
 * the next node would be making that choice for somebody.
 *
 * `returnType` decides whether there is a return at all. A stub that ended
 * `return { ticket };` under a return type of nothing described a function that
 * does not exist, and made the first thing anybody did after choosing nothing
 * deleting a line the editor had written a moment earlier.
 */
export function starterSource(
  name: string,
  declarations: string[],
  returned: string[],
  returnType: ValueType,
): string {
  const opening = `export default async function ${name}(${declarations.join(', ')}) {`;

  if (returnType === 'NONE') {
    return [opening, '  // Nothing goes on from here; this runs for what it does.', '}', ''].join('\n');
  }

  const gives = returned.length === 0 ? '{}' : `{ ${returned.join(', ')} }`;
  return [
    opening,
    '  // What this returns is handed to the next node.',
    `  return ${gives};`,
    '}',
    '',
  ].join('\n');
}

export async function updateFunction(
  id: string,
  input: {
    name?: string;
    description?: string;
    /** The compiled JavaScript, sent with the TypeScript it came from. */
    source?: string;
    /** The TypeScript `source` was compiled from. Neither moves without the other. */
    typescript?: string;
    returnType?: ValueType;
    /** Required when the return type is OBJECT, ignored otherwise. */
    returnObjectId?: string | null;
    params?: FunctionParam[];
    /** Null leaves them alone; an empty list takes them all off. */
    externalVariableIds?: string[];
    /** Null leaves them alone; an empty list takes them all off. */
    imports?: ScriptImportInput[];
    /** Null leaves them alone; an empty list takes them all off. */
    libraries?: ScriptLibraryImportInput[];
  },
): Promise<WorkspaceFunction> {
  const data = await graphql<{ updateFunction: WorkspaceFunction }>(UPDATE_FUNCTION_MUTATION, {
    id,
    input: {
      ...input,
      params: input.params?.map(asInput),
      imports: input.imports?.map(asImportInput),
      libraries: input.libraries?.map(asLibraryInput),
    },
  });
  return data.updateFunction;
}

/** The editor's Validate: answers rather than failing when the source is broken. */
export async function validateFunctionSource(workspaceId: string, source: string): Promise<FunctionValidation> {
  const data = await graphql<{ validateFunctionSource: FunctionValidation }>(VALIDATE_MUTATION, {
    workspaceId,
    source,
  });
  return data.validateFunctionSource;
}

export async function deleteFunction(id: string): Promise<boolean> {
  const data = await graphql<{ deleteFunction: boolean }>(DELETE_FUNCTION_MUTATION, { id });
  return data.deleteFunction;
}

/** One argument for a test run: which parameter, and the value as JSON. */
export interface FunctionArgument {
  name: string;
  json: string;
}

/** What one test run came to. */
export interface FunctionRun {
  ok: boolean;
  /** The JSON it returned. Null when it failed, and also when it returned nothing. */
  returned: string | null;
  /** What went wrong, with the function's name in front of it. Null when it answered. */
  error: string | null;
  durationMillis: number;
  /**
   * Whether asking again could ever answer differently. False means the run was
   * stopped by the clock or by how busy the machine was, not by the code.
   */
  settled: boolean;
  /** The workspace's variables it was handed, by name. Never their values. */
  grants: string[];
}

/**
 * Runs the stored function and says what came back.
 *
 * The saved code, never the column: no source travels in this call, so what runs
 * is the function a workflow would call. That is the point of the button — a run
 * of the draft would answer a question about something nobody can trigger.
 *
 * The workspace's variables are not here and cannot be. A grant belongs to the
 * function that declared it and is resolved on the server, the same way it is on
 * the import path; what comes back names them so the panel can say what was
 * handed over without ever showing a value.
 */
export async function runFunction(input: {
  workspaceId: string;
  functionId: string;
  arguments: FunctionArgument[];
}): Promise<FunctionRun> {
  const data = await graphql<{ runFunction: FunctionRun }>(RUN_FUNCTION_MUTATION, { input });
  return data.runFunction;
}

/**
 * A typed value as the JSON the sandbox is handed.
 *
 * The panel offers a control per type rather than one JSON box, so this is where
 * what somebody typed becomes what crosses the boundary: a string is quoted, a
 * number and a boolean go as they read, and the shapes that have no spelling as a
 * plain word — a map, an array, an object — are typed as JSON in the first place
 * and go through untouched, for the server to accept or refuse by name.
 *
 * An empty field is `null`, which is exactly what a node passes for a parameter it
 * has no mapping for.
 */
export function argumentJson(type: ValueType, written: string): string {
  const held = written.trim();
  if (held === '') return 'null';
  switch (type) {
    case 'STRING':
      return JSON.stringify(written);
    case 'NUMBER':
    case 'BOOLEAN':
      return held;
    default:
      return held;
  }
}

export const VALUE_TYPES: ValueType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'OBJECT', 'MAP', 'ARRAY'];

/**
 * What a function may return, which includes returning nothing.
 *
 * A parameter cannot be `NONE` — an argument that is nothing is not an
 * argument — so the return list is its own.
 */
export const RETURN_TYPES: ValueType[] = [...VALUE_TYPES, 'NONE'];

/**
 * What a picker holds while a function is being named rather than chosen.
 *
 * A stored id is a number the server printed, so a word can never be one, and
 * comparing against it needs no second flag alongside the selected value. The
 * function it stands for is created when the form around the picker is saved,
 * which is the only moment there is a name worth creating anything from.
 */
export const NEW_FUNCTION = 'new';

/**
 * What a function is called before anybody says otherwise.
 *
 * An empty Name field with a disabled Create button underneath is a puzzle, so
 * both the editor and the pickers start from a name that would be accepted, and
 * select it for typing over. Shared so the two never propose different words for
 * the same thing.
 */
export const NEW_FUNCTION_NAME = 'newFunction';

/**
 * Whether the server would take this as a function's name.
 *
 * A function is called by name inside the sandbox, so the server insists on a
 * JavaScript identifier and refuses anything else. The same rule is checked here
 * so a picker can say what is wrong while somebody is still typing, rather than
 * spending their save on finding out.
 */
export function validFunctionName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name.trim());
}

/**
 * A boolean function that says no, for a picker holding nothing but a name.
 *
 * Both halves are written out rather than compiled. The body is one `return` of a
 * literal, which is the same text in either language, so there is nothing for a
 * compiler to do - the same reason a duplicate is copied rather than recompiled.
 *
 * It has to be written at all because the server's own stub returns an empty
 * object, and an empty object is truthy. A webhook guarded by a function nobody
 * has written yet would let every caller through, and a condition nobody has
 * written yet would answer yes to everything. Neither is a default anybody chose.
 */
export function refusingFunction(name: string): { source: string; typescript: string } {
  const body = [
    `export default async function ${name}() {`,
    '  // Says no to everything until somebody writes what it should let through.',
    '  return false;',
    '}',
    '',
  ].join('\n');
  return { source: body, typescript: body };
}

/**
 * How a value's shape is written in TypeScript.
 *
 * What the editor annotates a parameter list with, and it has to agree with the
 * server's own mapping — the server writes the stub a new function starts from, and
 * the editor rewrites the parameter list of it afterwards. Two spellings of the same
 * table would show up as the annotations changing when a parameter is added.
 *
 * An object is `Record<string, unknown>` rather than `object`, and an array
 * `unknown[]` rather than `any[]`: everything here arrived as JSON, so what is
 * inside really is unknown until the code looks at it. `unknown` makes it look.
 */
export function tsType(type: ValueType, objectName?: string | null): string {
  switch (type) {
    case 'STRING':
      return 'string';
    case 'NUMBER':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    // The object's own name, which the editor declares as an interface. The
    // fallback is for an object that has been deleted out from under a function:
    // an annotation naming nothing would light up code that still runs.
    case 'OBJECT':
      return objectName ?? 'Record<string, unknown>';
    case 'MAP':
      return 'Record<string, unknown>';
    case 'ARRAY':
      return 'unknown[]';
    default:
      return 'void';
  }
}

/** The types read as they do in the code they describe. */
export function valueTypeLabel(type: ValueType): string {
  return type === 'NONE' ? 'nothing' : type.toLowerCase();
}

/** Whether this type has to name one of the workspace's objects. */
export function namesObject(type: ValueType): boolean {
  return type === 'OBJECT';
}

/** "2 hours ago", as the list shows it. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
  ];

  let value = seconds;
  let unit = 'second';
  for (const [step, next] of units) {
    if (value < step) break;
    value = Math.floor(value / step);
    unit = next;
  }
  if (unit === 'second' && value < 45) return 'just now';
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}
