import { compile } from '../components/monaco';
import { ApiError, graphql } from './client';
import { t } from '../i18n';

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
  /**
   * What the sandbox was relaxed to allow this plugin, because somebody said so.
   *
   * Not what the file asks for: a plugin whose declaration was refused is not
   * stored at all, so anything in here is a list a person read and accepted.
   * Empty for a plugin that asked for nothing.
   */
  permissions: PluginPermission[];
  /** When the list above was accepted. Null when there was nothing to accept. */
  permissionsAcceptedAt: string | null;
  /** Who accepted it. Null when there was nothing to accept. */
  permissionsAcceptedBy: string | null;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
  /**
   * Whether it is switched on. Off keeps everything and offers nothing: the
   * functions stop being callable and the tools leave the agents' menus.
   */
  enabled: boolean;
  /** The files it ships with, by path. Empty for a single-file plugin. */
  libraries: string[];
  /** Where it came from, when that was the marketplace. Null for a file or a URL. */
  marketplaceKey: string | null;
  marketplaceVersion: string | null;
  /**
   * The face it wears: the SVG itself, or an emoji. Copied in at install, so
   * it draws whether or not the marketplace can be reached. Null for a plugin
   * loaded from a file.
   */
  icon: string | null;
  /**
   * What the plugin says about itself, from the `plugin.json` it ships.
   *
   * Prose only: what it is allowed to do is read from the code when somebody
   * accepts it, never from what it claims here. Null for a plugin that ships
   * no manifest, which is every plugin loaded before there were any.
   */
  summary: string | null;
  author: string | null;
  /** Its own claim, which is not `marketplaceVersion` — see the schema. */
  version: string | null;
}

/** One plugin the marketplace offers, with what is installed here folded in. */
export interface MarketplaceListing {
  key: string;
  name: string;
  author: string;
  summary: string;
  /** Markdown, from a public repository; rendered rather than printed. */
  description: string;
  version: string;
  /** An emoji, or the URL of a small image. Null where the catalog offers none. */
  icon: string | null;
  downloads: number;
  rating: number | null;
  reviews: number;
  published: string;
  installed: boolean;
  installedVersion: string | null;
  /** Installed, and the catalog is offering a version this one is not. */
  updatable: boolean;
}

const LISTING_FIELDS = `
  key name author summary description version icon downloads rating reviews published
  installed installedVersion updatable
`;

/**
 * What the marketplace offers, as this installation sees it.
 *
 * `refresh` re-reads the catalog at its source rather than taking the cached
 * read — for somebody who has just published and wants to see it.
 */
export async function fetchMarketplace(refresh = false): Promise<MarketplaceListing[]> {
  const data = await graphql<{ marketplacePlugins: MarketplaceListing[] }>(
    `query Marketplace($refresh: Boolean) {
       marketplacePlugins(refresh: $refresh) { ${LISTING_FIELDS} }
     }`,
    { refresh },
  );
  return data.marketplacePlugins;
}

/** What an install came to: the plugin, or the agreement it is waiting on. */
export interface MarketplaceInstall {
  plugin: Plugin | null;
  needsPermissions: PluginPermission[];
  needsCapabilities: PluginPermission[];
  needsLibraries: string[];
  message: string | null;
}

/**
 * Installs a plugin from the marketplace, or updates one already installed —
 * one call, because they are one act.
 *
 * A first install, or one whose demands have grown, comes back with `plugin`
 * null and the lists to accept; sending those names back in `accept` is the
 * permission. That is the same bargain an upload makes, so a screen has one
 * thing to draw either way.
 */
export async function installFromMarketplace(key: string, accept?: string[]): Promise<MarketplaceInstall> {
  const data = await graphql<{ installMarketplacePlugin: MarketplaceInstall }>(
    `mutation InstallMarketplacePlugin($key: String!, $accept: String) {
       installMarketplacePlugin(key: $key, accept: $accept) {
         plugin { ${PLUGIN_FIELDS} }
         needsPermissions { name summary }
         needsCapabilities { name summary }
         needsLibraries
         message
       }
     }`,
    { key, accept: accept?.join(',') ?? null },
  );
  return data.installMarketplacePlugin;
}

/** Switches a plugin off, or back on. Everything stays either way. */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<Plugin> {
  const data = await graphql<{ setPluginEnabled: Plugin }>(
    `mutation SetPluginEnabled($id: ID!, $enabled: Boolean!) {
       setPluginEnabled(id: $id, enabled: $enabled) { ${PLUGIN_FIELDS} }
     }`,
    { id, enabled },
  );
  return data.setPluginEnabled;
}

/**
 * One thing the sandbox does not switch on by itself.
 *
 * The name is what the server is told to accept; the summary is the server's
 * own words for what it lets the plugin do. Both come from the server — this
 * build's vocabulary is the server's, and a page holding its own copy of it
 * would explain a permission the server has since renamed.
 */
export interface PluginPermission {
  name: string;
  summary: string;
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
  enabled libraries marketplaceKey marketplaceVersion icon summary author version
  declaredFunctions { name description returnType signature params { name type } }
  declaredParameters { name description type required secret }
  permissions { name summary }
  permissionsAcceptedAt permissionsAcceptedBy
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
export async function loadPlugin(name: string, written: string, accept?: string[]): Promise<Loaded> {
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
    accept,
  );
}

/**
 * A load refused because nobody has agreed to what the plugin asks for.
 *
 * Its own type rather than an `ApiError` carrying a sentence, because the page
 * has lists to draw and a decision to put in front of somebody: the names are
 * what goes back in `accept`, and the summaries are what that decision is made
 * on. Two lists, never one — a permission relaxes the sandbox and a capability
 * asks the server to act on the plugin's behalf, and the page has to be able to
 * say which is which. A refusal flattened into a string is one the page can
 * only reprint.
 */
export class PluginPermissionsRequired extends ApiError {
  constructor(
    message: string,
    readonly permissions: PluginPermission[],
    readonly capabilities: PluginPermission[],
    /**
     * The library files the plugin ships with, by path, where those are new.
     * A third list for the same reason there are two: what is being allowed
     * is that these files ride in beside the plugin's own code.
     */
    readonly libraries: string[] = [],
  ) {
    super(message, 400);
    this.name = 'PluginPermissionsRequired';
  }
}

/**
 * Loads a compiled plugin, accepting what it asks for where somebody has said so.
 *
 * `accept` names permissions rather than describing them, and has to name the
 * declared set exactly: it is an answer to a list somebody was shown, so a
 * plugin edited overnight to ask for one more is refused again rather than
 * quietly granted under yesterday's answer.
 */
export async function uploadPlugin(file: File, typescript?: string, accept?: string[]): Promise<Loaded> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (typescript !== undefined) form.append('typescript', typescript);
  if (accept !== undefined) form.append('accept', accept.join(','));

  const answer = await fetch('/api/plugins', {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  return await loadedOrRefused(answer);
}

/**
 * Loads a plugin from where it lives, libraries and all.
 *
 * The URL names the plugin's own file; the server walks its imports, fetches
 * what they name from beside it, and asks the same agreement an upload asks -
 * so the first load of a plugin that ships libraries comes back as a
 * [PluginPermissionsRequired] carrying the list, and the second, with `accept`
 * naming it, is the permission.
 */
export async function loadPluginFromUrl(url: string, accept?: string[]): Promise<Loaded> {
  const answer = await fetch('/api/plugins/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, accept: accept?.join(',') }),
    credentials: 'include',
  });
  return await loadedOrRefused(answer);
}

/** The answer to any load, read the one way: a refusal's lists, or the result. */
async function loadedOrRefused(answer: Response): Promise<Loaded> {
  if (!answer.ok) {
    // The server explains a refusal — too large, not JavaScript, not text — and
    // that sentence is more use than the status code.
    const said = await answer.text().catch(() => '');
    const asked = wanted(said, 'permissions');
    const askedOfServer = wanted(said, 'capabilities');
    const shipped = wantedPaths(said);
    if (asked.length > 0 || askedOfServer.length > 0 || shipped.length > 0) {
      throw new PluginPermissionsRequired(reason(said), asked, askedOfServer, shipped);
    }
    const message = said.trim() === '' ? `Could not load the plugin (status ${answer.status})` : reason(said);
    throw new ApiError(message, answer.status);
  }

  return (await answer.json()) as Loaded;
}

/**
 * One tool a plugin offers to agents, under its granted name.
 *
 * Not the administrator's plugin list: granting a tool to an agent is workspace
 * work, so this is readable wherever an agent is edited. `functionId` is set
 * for a tool fronting one of the plugin's functions - the page a row can jump
 * to - and null for a tool with a run of its own, which has no page.
 */
export interface PluginAgentTool {
  name: string;
  description: string | null;
  plugin: string;
  functionId: string | null;
}

export async function fetchPluginTools(): Promise<PluginAgentTool[]> {
  const data = await graphql<{ pluginTools: PluginAgentTool[] }>(
    `query PluginTools { pluginTools { name description plugin functionId } }`,
  );
  return data.pluginTools;
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
    throw new ApiError(t('That is not a URL.'), 400);
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

/**
 * One of the lists a refusal is asking about, or nothing when it is about
 * something else.
 *
 * Read off the body rather than off the status: 400 is also how a file too large
 * and a plugin that does not parse come back, and only this one has lists in it.
 */
function wanted(said: string, kind: 'permissions' | 'capabilities'): PluginPermission[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(said) as Record<string, unknown>;
  } catch {
    return [];
  }
  const asked = parsed[kind];
  if (!Array.isArray(asked)) return [];
  return asked.map((one) => {
    const { name, summary } = one as Partial<PluginPermission>;
    return { name: name ?? '', summary: summary ?? '' };
  });
}

/** The library paths a refusal asks about; empty when it is about something else. */
function wantedPaths(said: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(said) as Record<string, unknown>;
  } catch {
    return [];
  }
  const asked = parsed['libraries'];
  if (!Array.isArray(asked)) return [];
  return asked.filter((one): one is string => typeof one === 'string');
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
  /** Which kind of connection a `connection` parameter takes; null for every other type. */
  connectionType: string | null;
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
  parameters { name description type connectionType required secret literal variableId variableName missing }
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
