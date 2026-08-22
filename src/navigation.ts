import { matchPath } from 'react-router-dom';

import activityIcon from './assets/activity.svg';
import bellIcon from './assets/bell.svg';
import bookIcon from './assets/book.svg';
import botIcon from './assets/bot.svg';
import boxIcon from './assets/box.svg';
import chartLineIcon from './assets/chart-line.svg';
import chartNetworkIcon from './assets/chart-network.svg';
import clipboardListIcon from './assets/clipboard-list.svg';
import codeIcon from './assets/code.svg';
import commandIcon from './assets/command.svg';
import databaseIcon from './assets/database.svg';
import fileTextIcon from './assets/file-text.svg';
import alertTriangleIcon from './assets/alert-triangle.svg';
import userIcon from './assets/user.svg';
import filterIcon from './assets/filter.svg';
import gitBranchIcon from './assets/git-branch.svg';
import globeIcon from './assets/globe.svg';
import lockKeyholeIcon from './assets/lock-keyhole.svg';
import memoryIcon from './assets/memory.svg';
import messageSquareIcon from './assets/message-square.svg';
import plugIcon from './assets/plug.svg';
import puzzleIcon from './assets/puzzle.svg';
import templateIcon from './assets/layers.svg';
import settingsIcon from './assets/settings.svg';
import slidersIcon from './assets/sliders-horizontal.svg';
import terminalIcon from './assets/terminal.svg';
import toolIcon from './assets/tool.svg';

/**
 * Who may see a page.
 *
 * `admin` sends everyone else to their own home rather than to the login screen:
 * they are signed in, they simply may not have this.
 */
export type Access = 'signed-in' | 'admin';

/**
 * Which part of the product a page belongs to.
 *
 * One answer, in one place. It decides three things that used to be decided
 * separately and could therefore disagree: which link across the top is lit,
 * which menu is drawn down the side and what is in it, and which heading the
 * page appears under in Quick actions. A page states this once, here, and everything
 * else is read off it.
 *
 * The first four are the links across the top, in that order. `Docs`, `Admin`
 * and `You` are reached from the corner instead, and light nothing in the bar.
 */
export type Where = 'AI' | 'Flow' | 'Workspace' | 'Chat' | 'Docs' | 'Admin' | 'You';

/**
 * The links across the top, in the order they are drawn.
 *
 * Where each one *goes* is not written here: a section link opens the first
 * page of its own menu, so the destination is wherever the registry lists that
 * section first. Saying it twice is how a link ends up pointing at a page its
 * own menu no longer starts with.
 */
/*
 * "Flow" rather than "Workflow": the section held a page called Workflows, so
 * the bar and the menu under it said almost the same word twice and the wider
 * one was the one that meant less. The pages it holds are unchanged, and so are
 * their addresses.
 */
export const TOP_SECTIONS = ['AI', 'Flow', 'Workspace', 'Chat'] as const;

export type TopSection = (typeof TOP_SECTIONS)[number];

/** Where a page is listed in Quick actions, and what finds it. */
export interface GoTo {
  /** As the sidebar and the top bar name it — the same word, or it cannot be found. */
  label: string;
  /** The section it belongs to: the link it lights, the menu it is listed in. */
  where: Where;
  icon: string;
  /**
   * Other words somebody might type for it.
   *
   * The label is what it is called; this is what it is *for*. Nobody types "doctor"
   * when their credentials stopped saving — they type "secret key" or "broken".
   */
  also?: string;
}

/**
 * Something Quick actions can *do*, offered beside the places it can go.
 *
 * It is still a page underneath - every one of these is a screen that already
 * exists and is already reachable from a button on some list - so it is written
 * here, on that page, rather than in a second list of commands that would drift
 * from the first. What it adds is the verb: nobody looks for "Issue, new"; they
 * look for "create an issue", which is a thing to do and not a place to be.
 *
 * Only a page that *starts* something carries one. A page you merely arrive at
 * is a destination and is listed as one, by [GoTo] above.
 */
export interface QuickAction {
  /** The verb, as it would be said out loud: "Create issue". */
  label: string;
  /** Other words somebody might type for it — "new", "report", "file". */
  also?: string;
}

/**
 * One page of this application.
 *
 * The point of this list is `goTo`, and that it is not optional. Two pages were
 * added and neither turned up in Quick actions, because registering them was a second step
 * somebody had to remember — and a step you have to remember is a step that gets
 * missed. Here the router and Quick actions read the same list, so a page cannot exist
 * without an answer to "how is this found", even if the answer is `false`.
 *
 * `false` is a decision, not an omission: a page reached by opening something from
 * a list — a particular function, a particular run — has nothing to offer a palette,
 * because there is no such thing as "go to the function editor" without saying which
 * function. Those carry a note saying so.
 */
export interface Page {
  path: string;
  access: Access;
  /** How Quick actions lists it, or false where it cannot be gone to on its own. */
  goTo: GoTo | false;
  /**
   * The thing this page starts, if it starts one — offered in Quick actions as an
   * action rather than as a destination.
   *
   * Almost always on a `goTo: false` page: `.../issues/new` is not somewhere to
   * be, it is where filing one begins, so it has nothing to offer as a place
   * and everything to offer as a verb.
   */
  action?: QuickAction;
}

/**
 * Every page, once.
 *
 * Ordered as the interface is, and that order is used: a workspace's three
 * sections in the order they are drawn across the top and, within each, the
 * order its menu lists them in. Then chat and the manual, then the admin
 * section, then what belongs to the person signed in.
 */
export const PAGES = [
  // ---- AI: what a model is given to work with ----
  //
  // The order inside each of the three sections is the order its menu is drawn
  // in, and the first one is where the link at the top of the page lands.
  {
    path: '/workspace/:workspaceId/agents',
    access: 'signed-in',
    goTo: { label: 'Agents', where: 'AI', icon: botIcon, also: 'llm' },
  },
  {
    path: '/workspace/:workspaceId/models',
    access: 'signed-in',
    goTo: { label: 'Models', where: 'AI', icon: databaseIcon, also: 'providers usage' },
  },
  {
    path: '/workspace/:workspaceId/tools',
    access: 'signed-in',
    goTo: { label: 'Tools', where: 'AI', icon: toolIcon },
  },
  {
    path: '/workspace/:workspaceId/skills',
    access: 'signed-in',
    goTo: { label: 'Skills', where: 'AI', icon: bookIcon },
  },
  {
    path: '/workspace/:workspaceId/memory',
    access: 'signed-in',
    goTo: { label: 'Memory', where: 'AI', icon: memoryIcon },
  },
  {
    path: '/workspace/:workspaceId/sessions',
    access: 'signed-in',
    goTo: {
      label: 'Sessions',
      where: 'AI',
      icon: messageSquareIcon,
      also: 'llm transcript conversation history what the agent said',
    },
  },

  // ---- Workflow: the work itself, and what it is made of ----
  {
    path: '/workspace/:workspaceId/executions',
    access: 'signed-in',
    goTo: { label: 'Executions', where: 'Flow', icon: gitBranchIcon, also: 'runs history' },
  },
  {
    // The workspace's own front page, and the first thing anybody opens: the
    // address has no word on the end because there was nothing else here when
    // it was written. It stays as it is — every link in the manual and every
    // bookmark points at it.
    path: '/workspace/:workspaceId',
    access: 'signed-in',
    goTo: { label: 'Workflows', where: 'Flow', icon: chartNetworkIcon, also: 'graph editor' },
  },
  {
    path: '/workspace/:workspaceId/actions',
    access: 'signed-in',
    goTo: { label: 'Actions', where: 'Flow', icon: activityIcon },
  },
  {
    path: '/workspace/:workspaceId/functions',
    access: 'signed-in',
    goTo: { label: 'Functions', where: 'Flow', icon: codeIcon, also: 'javascript typescript' },
  },
  {
    path: '/workspace/:workspaceId/triggers',
    access: 'signed-in',
    goTo: { label: 'Triggers', where: 'Flow', icon: bellIcon, also: 'events schedule webhook' },
  },
  {
    path: '/workspace/:workspaceId/conditions',
    access: 'signed-in',
    goTo: { label: 'Conditions', where: 'Flow', icon: filterIcon },
  },
  {
    path: '/workspace/:workspaceId/objects',
    access: 'signed-in',
    goTo: { label: 'Objects', where: 'Flow', icon: boxIcon, also: 'shapes data' },
  },

  // ---- Workspace: what the whole of it is set up with ----
  {
    path: '/workspace/:workspaceId/variables',
    access: 'signed-in',
    goTo: { label: 'Variables', where: 'Workspace', icon: lockKeyholeIcon, also: 'secrets catalogs values' },
  },
  {
    path: '/workspace/:workspaceId/plugins',
    access: 'signed-in',
    goTo: {
      label: 'Plugins',
      where: 'Workspace',
      icon: puzzleIcon,
      also: 'parameters extensions settings',
    },
  },
  {
    path: '/workspace/:workspaceId/issues',
    access: 'signed-in',
    goTo: { label: 'Issues', where: 'Workspace', icon: alertTriangleIcon },
  },
  {
    path: '/workspace/:workspaceId/issues/new',
    access: 'signed-in',
    goTo: false,
    // The one issue #218 asked for. Somebody notices something while doing
    // something else, and the cost of writing it down is what decides whether
    // it gets written down at all.
    action: { label: 'Create issue', also: 'new report file bug raise ticket' },
  },
  { path: '/workspace/:workspaceId/issues/:number', access: 'signed-in', goTo: false },
  {
    path: '/workspace/:workspaceId/audit',
    access: 'signed-in',
    goTo: { label: 'Audit Log', where: 'Workspace', icon: clipboardListIcon, also: 'activity history' },
  },
  {
    path: '/workspace/:workspaceId/integrations',
    access: 'signed-in',
    goTo: { label: 'Integrations', where: 'Workspace', icon: plugIcon, also: 'connections slack mcp' },
  },
  {
    path: '/workspace/:workspaceId/settings',
    access: 'signed-in',
    goTo: { label: 'Settings', where: 'Workspace', icon: settingsIcon },
  },

  // ---- One of something, opened from a list. There is no "go to" without saying
  // which one, so these are deliberately not offered. ----
  { path: '/workspace/:workspaceId/executions/:executionId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/actions/:actionId', access: 'signed-in', goTo: false },
  /* Before the one with an id in it: `new` is a page, not a function called new. */
  {
    path: '/workspace/:workspaceId/functions/new',
    access: 'signed-in',
    goTo: false,
    action: { label: 'Create function', also: 'new javascript typescript write code' },
  },
  { path: '/workspace/:workspaceId/functions/:functionId', access: 'signed-in', goTo: false },
  /* Before the one with an id in it: `new` is a page, not a condition called new. */
  {
    path: '/workspace/:workspaceId/conditions/new',
    access: 'signed-in',
    goTo: false,
    action: { label: 'Create condition', also: 'new branch question if' },
  },
  { path: '/workspace/:workspaceId/conditions/:conditionId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/triggers/:triggerId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/integrations/servers/:serverId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/integrations/connections/:connectionId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/tools/:toolId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/objects/:objectId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/skills/:skillId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/models/providers/new', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/models/providers/:providerId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/models/:modelId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/agents/:agentId/settings', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/workflows/:workflowId/editor', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/workflows/:workflowId/settings', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/memory/new', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/memory/:memoryId', access: 'signed-in', goTo: false },
  { path: '/workspace/:workspaceId/sessions/:sessionId', access: 'signed-in', goTo: false },

  // ---- Chat and the manual ----
  { path: '/chat', access: 'signed-in', goTo: { label: 'Chat', where: 'Chat', icon: messageSquareIcon, also: 'ask agent' } },
  { path: '/chat/:chatId', access: 'signed-in', goTo: false },
  {
    path: '/docs',
    access: 'signed-in',
    // Named as the top bar names it; "documentation" is one of the words it is
    // also found by, so typing the long one still arrives.
    goTo: { label: 'Docs', where: 'Docs', icon: bookIcon, also: 'documentation help manual guide' },
  },
  { path: '/docs/:page', access: 'signed-in', goTo: false },

  // ---- The installation ----
  { path: '/admin', access: 'admin', goTo: { label: 'Workspaces', where: 'Admin', icon: commandIcon } },
  { path: '/admin/audit', access: 'admin', goTo: { label: 'Audit Log', where: 'Admin', icon: fileTextIcon } },
  { path: '/admin/users', access: 'admin', goTo: { label: 'Users', where: 'Admin', icon: userIcon } },
  { path: '/admin/users/new', access: 'admin', goTo: false },
  { path: '/admin/users/:userId', access: 'admin', goTo: false },
  {
    path: '/admin/integrations',
    access: 'admin',
    goTo: { label: 'Integrations', where: 'Admin', icon: plugIcon, also: 'default connections' },
  },
  {
    path: '/admin/plugins',
    access: 'admin',
    goTo: { label: 'Plugins', where: 'Admin', icon: puzzleIcon, also: 'extensions javascript' },
  },
  {
    path: '/admin/templates',
    access: 'admin',
    goTo: {
      label: 'Templates',
      where: 'Admin',
      icon: templateIcon,
      also: 'components export import reuse share',
    },
  },
  /* Before the one with an id in it: `new` is a page, not a template called new. */
  { path: '/admin/templates/new', access: 'admin', goTo: false },
  { path: '/admin/templates/:templateId', access: 'admin', goTo: false },
  {
    path: '/admin/networking',
    access: 'admin',
    goTo: {
      label: 'Networking',
      where: 'Admin',
      icon: globeIcon,
      also: 'proxy rules egress outbound firewall',
    },
  },
  {
    path: '/admin/shell',
    access: 'admin',
    goTo: {
      label: 'Shell',
      where: 'Admin',
      icon: terminalIcon,
      also: 'ssh machines hosts nodes commands remote',
    },
  },
  /* Before the one with an id in it: `new` is a page, not a shell called new. */
  { path: '/admin/shell/new', access: 'admin', goTo: false },
  { path: '/admin/shell/:shellId', access: 'admin', goTo: false },
  {
    path: '/admin/roles',
    access: 'admin',
    goTo: { label: 'Roles', where: 'Admin', icon: lockKeyholeIcon, also: 'permissions scopes access groups' },
  },
  {
    path: '/admin/monitoring',
    access: 'admin',
    goTo: { label: 'Monitoring', where: 'Admin', icon: chartLineIcon, also: 'health temporal' },
  },
  {
    path: '/admin/doctor',
    access: 'admin',
    goTo: {
      label: 'Doctor',
      where: 'Admin',
      icon: activityIcon,
      also: 'configuration diagnostics checks secret key broken',
    },
  },
  {
    path: '/admin/settings',
    /*
     * Administrators, like every other page under /admin.
     *
     * It was 'signed-in', so Quick actions offered it to anybody under the Admin
     * heading and the page opened for them - showing what the installation
     * allows, with switches the server then refuses. The refusal was correct;
     * offering the page at all was not.
     */
    access: 'admin',
    goTo: { label: 'Settings', where: 'Admin', icon: settingsIcon, also: 'attachments chat installation' },
  },
  { path: '/admin/workspaces/:workspaceId/settings', access: 'admin', goTo: false },

  // ---- Whoever is signed in ----
  {
    path: '/preferences',
    access: 'signed-in',
    goTo: { label: 'Preferences', where: 'You', icon: slidersIcon, also: 'theme shortcut appearance' },
  },
  {
    path: '/no-workspaces',
    access: 'signed-in',
    // Where somebody lands when nothing is theirs to see. Going there on purpose is
    // not a thing anybody wants to do.
    goTo: false,
  },
] as const satisfies readonly Page[];

/**
 * Every path this application has, as a type.
 *
 * `routes.tsx` maps this to the component each one renders, in a record keyed by
 * exactly these — so a page added here without an element does not compile, and an
 * element with no entry here does not either. That is the whole mechanism: the two
 * halves cannot be added separately, so neither can be forgotten.
 */
export type PagePath = (typeof PAGES)[number]['path'];

/**
 * The pages Quick actions should offer, with `:workspaceId` filled in.
 *
 * Workspace pages are only offered once a workspace is known, since a link to
 * `/workspace/:workspaceId/actions` with nothing to put in it goes nowhere.
 */
export function goToPages(options: { workspacePath: string | null; showAdmin: boolean; showChat: boolean }) {
  return PAGES.flatMap((page) => {
    if (page.goTo === false) return [];
    if (page.access === 'admin' && !options.showAdmin) return [];
    if (page.path.startsWith('/chat') && !options.showChat) return [];

    const workspaceScoped = page.path.startsWith('/workspace/');
    if (workspaceScoped && options.workspacePath === null) return [];

    const to = workspaceScoped
      ? page.path.replace('/workspace/:workspaceId', options.workspacePath ?? '')
      : page.path;

    return [{ ...page.goTo, to }];
  });
}

/**
 * The things Quick actions can do, with `:workspaceId` filled in.
 *
 * The same walk as [goToPages] over the same list, reading the other field. It
 * is deliberately not folded into that function: what the palette does with
 * these differs from what it does with a destination — they are offered before
 * anything is typed, where a page is one of twenty — and a caller asking for
 * "everything" would have to take them apart again.
 *
 * `where` is the section the page it starts belongs to, worked out by walking
 * up from the address rather than written down a second time: creating an issue
 * belongs under Workspace because that is where issues are.
 */
export function quickActions(options: { workspacePath: string | null; showAdmin: boolean }) {
  // Annotated, because `PAGES` is a const list of exact shapes and only some of
  // them have this field at all; as `Page` it is the optional it was declared.
  return PAGES.flatMap((page: Page) => {
    if (page.action === undefined) return [];
    if (page.access === 'admin' && !options.showAdmin) return [];

    const workspaceScoped = page.path.startsWith('/workspace/');
    if (workspaceScoped && options.workspacePath === null) return [];

    const to = workspaceScoped
      ? page.path.replace('/workspace/:workspaceId', options.workspacePath ?? '')
      : page.path;

    return [{ ...page.action, to, where: sectionAt(to)?.goTo.where ?? 'Workspace' }];
  });
}

/**
 * A page that is somewhere to be, rather than one of something.
 *
 * The distinction is already written down above: a page carrying a `goTo` entry
 * can be gone to by name, and `goTo: false` marks the ones that cannot because
 * they are about a particular thing. Two questions turn on that same line — what
 * the browser tab should say while an entity is still loading, and where
 * switching workspace lands — so it is worth having a name.
 */
export type SectionPage = Page & { goTo: GoTo };

/** Which page a real address is, or undefined where it is none of them. */
function pageAt(pathname: string): Page | undefined {
  // In registry order, which is why `.../issues/new` is listed before
  // `.../issues/:number`: both patterns match that address, and the first one
  // wins here exactly as it does in the router.
  return PAGES.find((page) => matchPath(page.path, pathname) !== null);
}

/**
 * The nearest page at or above [pathname] that is a section in its own right.
 *
 * Walks up a segment at a time, so the editor of one workflow answers Workflows
 * and one user under Admin answers Users. Undefined for an address that is no
 * page of this application at all.
 */
export function sectionAt(pathname: string): SectionPage | undefined {
  let candidate = pathname;

  while (candidate !== '') {
    const page = pageAt(candidate);
    // Spread rather than returned as it stands: narrowing a property does not
    // narrow the object it is on, and `SectionPage` is the whole point here.
    if (page !== undefined && page.goTo !== false) return { ...page, goTo: page.goTo };
    candidate = candidate.slice(0, candidate.lastIndexOf('/'));
  }

  return undefined;
}

/**
 * Which section the address is in, or undefined where it is in none.
 *
 * The one answer to "which link is lit". A deep link into
 * `/workspace/1/agents/7/settings` answers AI, because the page it walks up to
 * says so — nobody had to remember to tell the shell.
 */
export function whereAt(pathname: string): Where | undefined {
  return sectionAt(pathname)?.goTo.where;
}

/** One entry of a section's menu: what to draw, where it goes, and what it is. */
export interface SectionLink {
  label: string;
  icon: string;
  /** With `:workspaceId` filled in — somewhere to actually go. */
  to: string;
  /** The pattern it was made from, so the current page can be recognised. */
  path: string;
}

/**
 * The pages of one section, in the order its menu draws them.
 *
 * Read straight off the registry, so a page moved from one section to another
 * moves in the menu, in the top bar and in Quick actions together. [workspacePath] is
 * what `/workspace/:workspaceId` becomes; a section holding no workspace pages
 * ignores it.
 */
export function sectionLinks(where: Where, workspacePath: string): SectionLink[] {
  return PAGES.flatMap((page) =>
    page.goTo === false || page.goTo.where !== where
      ? []
      : [
          {
            label: page.goTo.label,
            icon: page.goTo.icon,
            to: page.path.replace('/workspace/:workspaceId', workspacePath),
            path: page.path,
          },
        ],
  );
}

/**
 * Where a link at the top of the page goes: the first page of its own menu.
 *
 * Undefined only for a section with no pages at all; every section in
 * [TOP_SECTIONS] has some, so in practice this answers.
 */
export function sectionHome(where: Where, workspacePath: string): string | undefined {
  return sectionLinks(where, workspacePath)[0]?.to;
}

/**
 * Where switching to another workspace lands, from the page open now.
 *
 * The rule is: a list page keeps its place, an entity page falls back to its
 * list. Issues, workflows and the audit log exist in every workspace, so
 * somebody comparing two of them stays on the screen they were reading. One
 * particular thing does not travel — issue #4 over there is a different issue,
 * or none — so a page about one thing lands on the list it was opened from.
 *
 * Everything else, including a page belonging to no workspace, goes to the
 * workspace's own front page. Any query string is dropped: it describes what was
 * being looked at here, and a filter naming this workspace's labels or ids means
 * nothing in the next one.
 */
export function workspaceSwitchPath(pathname: string, workspaceId: string): string {
  const home = `/workspace/${workspaceId}`;
  const section = sectionAt(pathname);

  if (section === undefined || !section.path.startsWith('/workspace/:workspaceId')) return home;
  return section.path.replace('/workspace/:workspaceId', home);
}
