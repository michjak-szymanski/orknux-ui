import { graphql } from './client';
import type { PageOf } from './client';
import type { ValueType } from './actions';
import { asImportInput } from './functions';
import type { ScriptImport, ScriptImportInput } from './functions';

/**
 * One argument a tool takes, in the order it takes them.
 *
 * The same shape a function's parameter has. A tool used to take exactly one
 * argument called `input`, written into the server rather than into the tool,
 * so there was nothing here for an editor to show or change.
 */
export interface ToolParam {
  name: string;
  type: ValueType;
  /** Which of the workspace's objects, when the type is OBJECT. */
  objectId?: string | null;
  /** What that object is called: what the code is annotated with. */
  objectName?: string | null;
}

/**
 * A named piece of JavaScript an agent may call while it runs.
 *
 * Not a workflow function: a function is called by an action node at a point the
 * graph fixed in advance, a tool is offered to an agent that calls it if it
 * judges that it should.
 */
export interface Tool {
  id: string;
  workspaceId: string;
  name: string;
  /** What the tool is for. An agent reads this to decide whether to call it. */
  description: string | null;
  /** The JavaScript that runs. */
  source: string;
  /** The TypeScript it was compiled from, which is what the editor opens. */
  typescript: string;
  /** What it takes, in the order the sandbox passes it. */
  params: ToolParam[];
  /**
   * The workspace's functions it calls, under the names it calls them.
   *
   * One direction only: a tool may import a function, and nothing imports a tool.
   */
  imports: ScriptImport[];
  /** "(city: string, days: number)", ready for the list. */
  signature: string;
  enabled: boolean;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

/** What Validate found. `column` is null for a skill, which has no columns to point at. */
export interface SourceValidation {
  valid: boolean;
  message: string | null;
  line: number | null;
  column: number | null;
}

/**
 * A parameter as the server's input type takes it, without what it sent back.
 *
 * The name of the object it points at is resolved by the server and travels with
 * the tool, so it belongs to what is read and not to what is written - and a
 * mutation carrying it is refused outright, for a field the input type does not
 * have. Narrowed here rather than at each call, so nothing has to remember.
 */
function asInput(param: ToolParam): { name: string; type: ValueType; objectId?: string | null } {
  return param.type === 'OBJECT'
    ? { name: param.name, type: param.type, objectId: param.objectId ?? null }
    : { name: param.name, type: param.type };
}

const TOOL_FIELDS =
  'id workspaceId name description source typescript ' +
  'params { name type objectId objectName } ' +
  'imports { functionId name function { name description signature returnType returnObjectName } } ' +
  'signature enabled lastModifiedAt lastModifiedBy';

export async function fetchWorkspaceTools(workspaceId: string, page = 0, size = 20): Promise<PageOf<Tool>> {
  const data = await graphql<{ workspaceTools: PageOf<Tool> }>(
    `query WorkspaceTools($workspaceId: ID!, $page: Int!, $size: Int!) {
       workspaceTools(workspaceId: $workspaceId, page: $page, size: $size) {
         content { ${TOOL_FIELDS} }
         page size totalElements totalPages
       }
     }`,
    { workspaceId, page, size },
  );
  return data.workspaceTools;
}

export async function fetchTool(id: string): Promise<Tool | null> {
  const data = await graphql<{ tool: Tool | null }>(
    `query Tool($id: ID!) { tool(id: $id) { ${TOOL_FIELDS} } }`,
    { id },
  );
  return data.tool;
}

export interface CreateToolInput {
  name: string;
  description?: string;
  /**
   * The compiled JavaScript. Sent together with `typescript` or not at all: a
   * tool whose halves were written apart is one whose editor and sandbox
   * disagree. Both left out starts the tool from a stub.
   */
  source?: string;
  typescript?: string;
  /** Left out means the one every tool used to take: an object called `input`. */
  params?: ToolParam[];
  /** The workspace's functions it calls, under the names it calls them. */
  imports?: ScriptImportInput[];
}

export async function createTool(workspaceId: string, input: CreateToolInput): Promise<Tool> {
  const data = await graphql<{ createTool: Tool }>(
    `mutation CreateTool($input: CreateToolInput!) { createTool(input: $input) { ${TOOL_FIELDS} } }`,
    {
      input: {
        workspaceId,
        ...input,
        params: input.params?.map(asInput),
        imports: input.imports?.map(asImportInput),
      },
    },
  );
  return data.createTool;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  /** The compiled JavaScript. Sent together with `typescript` or not at all. */
  source?: string;
  typescript?: string;
  /** Left out leaves them alone; an empty list takes them all off. */
  params?: ToolParam[];
  /** Left out leaves them alone; an empty list takes them all off. */
  imports?: ScriptImportInput[];
}

export async function updateTool(id: string, input: UpdateToolInput): Promise<Tool> {
  const data = await graphql<{ updateTool: Tool }>(
    `mutation UpdateTool($id: ID!, $input: UpdateToolInput!) { updateTool(id: $id, input: $input) { ${TOOL_FIELDS} } }`,
    { id, input: { ...input, params: input.params?.map(asInput), imports: input.imports?.map(asImportInput) } },
  );
  return data.updateTool;
}

export async function setToolEnabled(id: string, enabled: boolean): Promise<Tool> {
  const data = await graphql<{ setToolEnabled: Tool }>(
    `mutation SetToolEnabled($id: ID!, $enabled: Boolean!) {
       setToolEnabled(id: $id, enabled: $enabled) { ${TOOL_FIELDS} }
     }`,
    { id, enabled },
  );
  return data.setToolEnabled;
}

export async function validateToolSource(workspaceId: string, source: string): Promise<SourceValidation> {
  const data = await graphql<{ validateToolSource: SourceValidation }>(
    `mutation ValidateToolSource($workspaceId: ID!, $source: String!) {
       validateToolSource(workspaceId: $workspaceId, source: $source) { valid message line column }
     }`,
    { workspaceId, source },
  );
  return data.validateToolSource;
}

export async function deleteTool(id: string): Promise<boolean> {
  const data = await graphql<{ deleteTool: boolean }>(
    'mutation DeleteTool($id: ID!) { deleteTool(id: $id) }',
    { id },
  );
  return data.deleteTool;
}

/**
 * The declaration of the function this tool is, and where its parameters are.
 *
 * A tool's own finder rather than the function editor's, because a tool's code
 * is not always a default export. Tools written before the editor printed the
 * stub are plain top-level `function name(...)` declarations, and a finder that
 * insisted on `export default` would silently refuse to keep those in step with
 * the panel - which is precisely the tools somebody is most likely to be fixing.
 *
 * Walked to the closing bracket rather than matched to the first `)`, because a
 * parameter list can contain brackets of its own: `({ a, b }, c)` is one.
 */
function declaration(source: string, name: string): { from: number; to: number } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    /export\s+default\s+(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(/,
    new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?function\\s*\\*?\\s*${escaped}\\s*\\(`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match === null) continue;

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
  }
  return null;
}

/**
 * The same code, taking exactly these parameters.
 *
 * The panel is what a tool takes, and the declaration in the code is the same
 * statement written in TypeScript - so changing one has to change the other, or
 * the agent is handed arguments the code never binds. Only the parameter list is
 * rewritten; anything that is not a declaration this can find is left exactly as
 * it was, which is better than rewriting code nobody asked to have rewritten.
 */
export function withToolParameters(source: string, name: string, declarations: string[]): string {
  const found = declaration(source, name);
  if (found === null) return source;

  const wanted = declarations.join(', ');
  if (source.slice(found.from, found.to) === wanted) return source;
  return source.slice(0, found.from) + wanted + source.slice(found.to);
}

/**
 * The written parameter list, split at the commas that separate parameters.
 *
 * Not `text.split(',')`: an annotation has commas of its own - `Record<string,
 * unknown>` is one parameter and contains one - so the split counts what it is
 * inside first. Quotes are skipped whole, so a literal union survives.
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

/** The shape a written annotation stands for, or null if orknux has no such shape. */
function typeOfAnnotation(annotation: string, objects: { id: string; name: string }[]): ToolParam | null {
  const written = annotation.trim();
  switch (written) {
    case '':
      // Unannotated. A tool written before the editor annotated anything says
      // nothing about its arguments, and a free-form object is what it meant.
      return { name: '', type: 'MAP' };
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
      return named === undefined ? null : { name: '', type: 'OBJECT', objectId: named.id, objectName: named.name };
    }
  }
}

/** The name a written parameter starts with, ignoring what it was annotated with. */
function nameOf(entry: string): string | null {
  const name = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\??\s*(?::|=|$)/.exec(entry);
  return name === null ? null : name[1];
}

/**
 * What the code says this tool takes, read back off its own declaration.
 *
 * The point of reading it rather than being told it: the assistant offers a whole
 * tool, and the parameter list is in what it offered. Deriving the panel from the
 * same text that will be compiled is what makes it impossible for the two to
 * disagree - a parameter added to the signature and not to the code, or the other
 * way round, cannot be expressed.
 *
 * Either the parameters or a sentence saying what is wrong, which is what the
 * assistant is told so its next attempt is at the real problem.
 */
export function toolParametersOf(
  source: string,
  name: string,
  objects: { id: string; name: string }[],
  known: ToolParam[],
): { params: ToolParam[] } | { problem: string } {
  const found = declaration(source, name);
  if (found === null) {
    return { problem: `it has no \`function ${name}\` declaration to read a parameter list from` };
  }

  const params: ToolParam[] = [];
  for (const entry of splitParameters(source.slice(found.from, found.to))) {
    const written = nameOf(entry);
    if (written === null) {
      return { problem: `\`${entry.trim()}\` is not a parameter this editor can show - name each one plainly` };
    }

    const annotation = entry.slice(entry.indexOf(written) + written.length).replace(/^\s*\??\s*:?/, '');
    const read = typeOfAnnotation(annotation, objects);
    if (read === null) {
      return { problem: `\`${annotation.trim()}\` is not a type this workspace has - annotate ${written} with one it does` };
    }

    /*
     * A parameter that was already pointing at an object goes on pointing at it.
     * `Record<string, unknown>` is what an object parameter is annotated with
     * when its object has been deleted, so reading it back would quietly retype
     * one; only a rename or a real retype moves it.
     */
    const was = known.find((param) => param.name === written);
    const kept = read.type === 'MAP' && was?.type === 'OBJECT' ? was : { ...read, name: written };
    params.push({ ...kept, name: written });
  }
  return { params };
}

/** Whether two parameter lists describe the same thing, name, type and object alike. */
export function sameToolParameters(one: ToolParam[], other: ToolParam[]): boolean {
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
 * "3 hours ago", as the lists show it. Anything older than a week is a date,
 * because "9 weeks ago" is harder to read than the day it happened.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 14) return '1 week ago';
  if (days < 31) return `${Math.round(days / 7)} weeks ago`;

  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
