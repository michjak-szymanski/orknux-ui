import { compile } from '../components/monaco';
import { ApiError, graphql } from './client';

/**
 * The plugins loaded into the installation.
 *
 * Administrator-only, and installation-wide rather than per workspace: loading a
 * plugin is something an operator does once for everyone.
 */
export interface Plugin {
  id: string;
  /**
   * What the plugin calls itself: its identity rather than the file's, and the
   * prefix on every function it declares.
   */
  key: string;
  /** From the filename it was uploaded as, without the extension. */
  name: string;
  filename: string;
  sizeBytes: number;
  /**
   * The plugin API the plugin said it uses. Only versions the server knows are
   * ever stored — one it does not know is refused at upload.
   */
  apiVersion: number;
  /**
   * What the plugin says it offers. The declaration, not the registration —
   * these become callable once materialised as organisation-level functions.
   */
  declaredFunctions: PluginFunctionDeclaration[];
  /**
   * What the plugin says it has to be told before it can work.
   *
   * The declaration only. What a workspace set them to is on `WorkspacePlugin`,
   * because the answers belong to a workspace and the question does not.
   */
  declaredParameters: PluginParameterDeclaration[];
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
}

/**
 * One thing a plugin says it has to be told.
 *
 * Not a function's parameter: a function's is filled in call by call, this one
 * is filled in once by the workspace and is the same for every call.
 */
export interface PluginParameterDeclaration {
  name: string;
  description: string | null;
  /** One of the types a workspace variable can hold: STRING, NUMBER or BOOLEAN. */
  type: string;
  required: boolean;
  /** Declared as a secret, which means it can only be answered with a variable. */
  secret: boolean;
}

export interface PluginFunctionDeclaration {
  name: string;
  description: string | null;
  params: { name: string; type: string }[];
  returnType: string;
  /** "(email: string): boolean", ready to show. */
  signature: string;
}

const PLUGIN_FIELDS = `
  id key name filename sizeBytes apiVersion sha256 uploadedAt uploadedBy
  declaredFunctions { name description returnType signature params { name type } }
  declaredParameters { name description type required secret }
`;

export async function fetchPlugins(): Promise<Plugin[]> {
  const data = await graphql<{ plugins: Plugin[] }>(`query Plugins { plugins { ${PLUGIN_FIELDS} } }`);
  return data.plugins;
}

/** What came back from a load: the plugin, whether it replaced one, and what it now provides. */
export interface Loaded {
  plugin: Plugin;
  replaced: boolean;
  /** The function names now available in every workspace, already prefixed. */
  provides: string[];
}

/**
 * Loads one plugin.
 *
 * Multipart rather than GraphQL, because what crosses is a file — the same route
 * attachments and transcription take. `fetch` directly rather than the shared
 * `request`, since that one sets a JSON content type and a multipart body has to
 * set its own boundary.
 */
/**
 * Loads a plugin, compiling it first where it was written in TypeScript.
 *
 * The sandbox runs JavaScript and the server has no compiler, so what is sent to run
 * is always compiled. What was written is sent alongside it and kept — not to be
 * evaluated, but so the plugin can be downloaded later as the thing somebody wrote
 * rather than as the compiler's output.
 */
export async function loadPlugin(name: string, written: string): Promise<Loaded> {
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
  return uploadPlugin(
    new File([javascript], asJavaScript, { type: 'text/javascript' }),
    isTypeScript ? written : undefined,
  );
}

export async function uploadPlugin(file: File, typescript?: string): Promise<Loaded> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (typescript !== undefined) form.append('typescript', typescript);

  const answer = await fetch('/api/plugins', {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  if (!answer.ok) {
    // The server explains a refusal — too large, not JavaScript, not text — and
    // that sentence is more use than the status code.
    const said = await answer.text().catch(() => '');
    const message = said.trim() === '' ? `Could not load the plugin (status ${answer.status})` : reason(said);
    throw new ApiError(message, answer.status);
  }

  return (await answer.json()) as Loaded;
}

export async function unloadPlugin(id: string): Promise<boolean> {
  const data = await graphql<{ unloadPlugin: boolean }>(
    `mutation UnloadPlugin($id: ID!) { unloadPlugin(id: $id) }`,
    { id },
  );
  return data.unloadPlugin;
}

/**
 * Hands back a plugin to start from.
 *
 * Fetched rather than written here on purpose: the server generates it, so the
 * API version in it is the one this server actually accepts and cannot drift from
 * what the loader expects.
 */
export async function pluginTemplate(): Promise<{ filename: string; source: string }> {
  const answer = await fetch('/api/plugins/template', { credentials: 'include' });
  if (!answer.ok) {
    throw new ApiError(`Could not fetch the template (status ${answer.status})`, answer.status);
  }
  // TypeScript now: the contract is declared at the top of it, so an editor checks
  // a plugin against the real thing while the declarations compile to nothing.
  return { filename: 'orknux-plugin.ts', source: await answer.text() };
}

/**
 * Fetches a plugin from a URL, in the browser.
 *
 * The browser fetches rather than the server, which is what lets a `.ts` file be
 * loaded at all: the compiler is here. It also means this is subject to the other
 * site's CORS policy — raw files from GitHub, gists and CDNs send the header that
 * allows it, and a host that does not is refused by the browser with no way around
 * it from this side. That refusal is reported as what it is, rather than as a
 * mysterious failure.
 */
export async function fetchPluginSource(url: string): Promise<{ name: string; source: string }> {
  let address: URL;
  try {
    address = new URL(url.trim());
  } catch {
    throw new ApiError('That is not a URL.', 400);
  }

  let answer: Response;
  try {
    answer = await fetch(address, { credentials: 'omit' });
  } catch {
    throw new ApiError(
      `Could not fetch ${address.host}. The browser does the fetching, so the file has to be served ` +
        'with a header allowing it to be read from another site — raw GitHub files and gists are.',
      0,
    );
  }

  if (!answer.ok) throw new ApiError(`${address.host} answered ${answer.status}.`, answer.status);

  const name = address.pathname.split('/').filter(Boolean).pop() ?? 'plugin.js';
  return { name, source: await answer.text() };
}

/** Where a plugin's own source can be downloaded: TypeScript where there is any. */
export function pluginSourceUrl(id: string): string {
  return `/api/plugins/${id}/source`;
}

/** Spring reports an error as JSON with a `message`; anything else is shown as it came. */
function reason(said: string): string {
  try {
    const parsed = JSON.parse(said) as { message?: string };
    return parsed.message?.trim() ?? said;
  } catch {
    return said;
  }
}

/** Bytes as something to read in a table. */
export function pluginSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A plugin as one workspace sees it: what it asked for, and what this workspace
 * answered.
 *
 * A different question from the admin list. Loading a plugin is installation-wide
 * and an operator's; answering what one needs belongs to whoever runs the
 * workspace it will run for, which is why this is not an admin call.
 */
export interface WorkspacePlugin {
  plugin: Plugin;
  parameters: PluginParameterSetting[];
  /**
   * The required parameters this workspace has not answered.
   *
   * Empty when the plugin has everything it asked for. It holds exactly the names
   * marked on the parameters below, so the mark on a row and the marks inside it
   * cannot disagree.
   */
  missing: string[];
}

/** One of a plugin's parameters, and what this workspace set it to. */
export interface PluginParameterSetting {
  name: string;
  description: string | null;
  type: string;
  required: boolean;
  secret: boolean;
  /** What somebody typed. Null when this points at a variable, or is unanswered. */
  literal: string | null;
  variableId: string | null;
  /** The name of that variable, never what it holds. */
  variableName: string | null;
  missing: boolean;
}

const WORKSPACE_PLUGIN_FIELDS = `
  missing
  plugin { ${PLUGIN_FIELDS} }
  parameters { name description type required secret literal variableId variableName missing }
`;

export async function fetchWorkspacePlugins(workspaceId: string): Promise<WorkspacePlugin[]> {
  const data = await graphql<{ workspacePlugins: WorkspacePlugin[] }>(
    `query WorkspacePlugins($workspaceId: ID!) {
      workspacePlugins(workspaceId: $workspaceId) { ${WORKSPACE_PLUGIN_FIELDS} }
    }`,
    { workspaceId },
  );
  return data.workspacePlugins;
}

/**
 * Answers one parameter, with a value or with one of the workspace's variables.
 *
 * Exactly one of `literal` and `variableId`. The whole plugin comes back rather
 * than the one parameter, so whether it is still marked as needing something is
 * the server's answer and not this page's arithmetic.
 */
export async function setPluginParameter(
  workspaceId: string,
  pluginId: string,
  name: string,
  answer: { literal: string } | { variableId: string },
): Promise<WorkspacePlugin> {
  const data = await graphql<{ setPluginParameter: WorkspacePlugin }>(
    `mutation SetPluginParameter(
      $workspaceId: ID!, $pluginId: ID!, $name: String!, $literal: String, $variableId: ID
    ) {
      setPluginParameter(
        workspaceId: $workspaceId, pluginId: $pluginId, name: $name, literal: $literal, variableId: $variableId
      ) { ${WORKSPACE_PLUGIN_FIELDS} }
    }`,
    {
      workspaceId,
      pluginId,
      name,
      literal: 'literal' in answer ? answer.literal : null,
      variableId: 'variableId' in answer ? answer.variableId : null,
    },
  );
  return data.setPluginParameter;
}

/** Unsets one parameter. A required one is marked as missing again. */
export async function clearPluginParameter(
  workspaceId: string,
  pluginId: string,
  name: string,
): Promise<WorkspacePlugin> {
  const data = await graphql<{ clearPluginParameter: WorkspacePlugin }>(
    `mutation ClearPluginParameter($workspaceId: ID!, $pluginId: ID!, $name: String!) {
      clearPluginParameter(workspaceId: $workspaceId, pluginId: $pluginId, name: $name) {
        ${WORKSPACE_PLUGIN_FIELDS}
      }
    }`,
    { workspaceId, pluginId, name },
  );
  return data.clearPluginParameter;
}
