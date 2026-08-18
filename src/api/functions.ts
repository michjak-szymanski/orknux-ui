import { ApiError, graphql } from './client';
import type { PageOf } from './client';
import type { ValueType } from './actions';

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

const FUNCTION_FIELDS =
  `id workspaceId scope editable plugin { id name } name description source typescript returnType
   params { name type } externals { variableId name type } signature lastModifiedAt lastModifiedBy`;

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
}): Promise<WorkspaceFunction> {
  const data = await graphql<{ createFunction: WorkspaceFunction }>(CREATE_FUNCTION_MUTATION, { input });
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
        source: renamed(fn.source, fn.name, name),
        typescript: renamed(fn.typescript ?? fn.source, fn.name, name),
        returnType: fn.returnType,
        params: fn.params,
        externalVariableIds: fn.externals.map((external) => external.variableId),
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
 * The same code, with its declaration renamed to match the copy.
 *
 * A copy called `isFalseCopy` whose code still reads `function isFalse()` runs
 * perfectly — the sandbox calls the default export, not the name — and reads as a
 * mistake every time somebody opens it.
 *
 * Only the declaration is touched, and only when the old name appears nowhere else.
 * A function that calls itself by name would be broken by renaming the declaration
 * alone, and renaming every occurrence would eventually rewrite a string or a
 * property that happened to match. Where it is not unambiguous, the source is left
 * exactly as it was: a copy that reads oddly is better than one that throws.
 */
function renamed(source: string, from: string, to: string): string {
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
  },
): Promise<WorkspaceFunction> {
  const data = await graphql<{ updateFunction: WorkspaceFunction }>(UPDATE_FUNCTION_MUTATION, { id, input });
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
