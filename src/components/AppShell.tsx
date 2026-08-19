import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { Workspace } from '../api/workspaces';
import { cachedWorkspaces, loadWorkspaces } from '../session/workspaces';
import bookIcon from '../assets/book.svg';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import doorOpenIcon from '../assets/door-open.svg';
import orknuxMark from '../assets/orknux-mark.svg';
import settingsIcon from '../assets/settings.svg';
import shieldIcon from '../assets/shield.svg';
import { lastWorkspaceId } from '../session/lastWorkspace';
import { sectionAt, workspaceSwitchPath } from '../navigation';
import { useInstallation } from '../session/installation';
import { setSidebarCollapsed, useSidebarCollapsed } from '../session/sidebar';
import { Attribution } from './Attribution';
import { CommandPalette } from './CommandPalette';
import { NotificationBell } from './NotificationBell';
import { QuickChat } from './QuickChat';
import styles from './AppShell.module.css';

export interface AppShellUser {
  name: string;
  role: string;
  initials: string;
  /** From the directory's mail attribute; the menu drops the line when absent. */
  email?: string;
  /**
   * Holds the installation's admin role.
   *
   * Carried on the user rather than asked for by each page, because it decides
   * whether the corner offers the admin section at all — and a page that forgot
   * to say would otherwise offer it to everybody.
   */
  admin: boolean;
}

export interface AppShellProps {
  user: AppShellUser;
  /** Which top-bar link is current. */
  section: 'admin' | 'workspace' | 'chat' | 'docs' | 'none';
  /** Destination for the Workspace link; the link is inert while no workspace is known. */
  workspacePath?: string;
  /**
   * Whether the admin section is offered — the button in the corner, and the
   * admin pages in Go to.
   *
   * Defaults to what [user.admin] says, which is the answer: a page passing it
   * is only repeating the session. It used to default to `true`, so the pages
   * that did not pass it — the manual, a workspace's settings — offered an admin
   * button to anybody who opened them.
   */
  showAdmin?: boolean;
  /** Page-specific sidebar content. Null when the page hides the sidebar. */
  sidebar: ReactNode;
  /** The workflow editor fills the workspace itself. */
  hideSidebar?: boolean;
  /**
   * What is open here — the workflow being edited, the issue being read — for
   * the browser tab.
   *
   * Left out by a page that is a list rather than a thing, and left out while
   * the thing is still on its way: the shell falls back to the section's own
   * name, so a tab says "Tools" for the moment before it can say which tool,
   * and never says `undefined` or an id.
   */
  title?: string;
  /**
   * Scrolls the content rather than the window.
   *
   * For pages that are long by nature — the documentation — where the top bar
   * and the contents down the side should stay where they are instead of
   * riding up out of view.
   */
  scrollContent?: boolean;
  onSignOut?: () => void;
  children: ReactNode;
}

/** How many workspaces to look at when deciding where the Workspace tab goes. */
const WORKSPACE_LOOKUP = 100;

/**
 * Where the Workspace tab goes when the page it is on knows no workspace: the workspace last
 * looked at, or the first one visible. Without it the tab is dead on every
 * admin page but the dashboard.
 */
function useWorkspaceFallback(needed: boolean): string | undefined {
  const [path, setPath] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!needed) return;
    // The remembered id is checked rather than trusted: it outlives the
    // workspace it names, and a tab pointing at a workspace nobody can see is
    // worse than one pointing at the first they can.
    // Through the same cache the sidebar uses, so the tab and the selector agree
    // and two mounts do not make two requests for one list.
    loadWorkspaces(WORKSPACE_LOOKUP)
      .then((workspaces) => {
        const remembered = lastWorkspaceId();
        const live = workspaces.find((entry) => entry.id === remembered) ?? workspaces[0];
        setPath(live === undefined ? undefined : `/workspace/${live.id}`);
      })
      .catch(() => setPath(undefined));
  }, [needed]);

  return path;
}

/** The product's own site, where the mark in the corner goes. */
const WEBSITE = 'https://orknux.ai';

/** What the tab says when there is nothing else to say. */
const PRODUCT = 'Orknux';

/**
 * Names the tab after whatever this page is showing: `<what is open> - Orknux`.
 *
 * The product name goes last because a tab strip with a dozen tabs in it cuts
 * the end off, and the half worth keeping is the half that says which of the
 * dozen this one is. Somebody with three of these open is looking for an issue
 * and a workflow, not for three tabs all beginning "Orknux".
 *
 * Here rather than on each page, which is the point: a page written tomorrow is
 * named after its section without anybody remembering to do anything, because
 * every screen in this application is drawn inside this shell and the section
 * is already written down in `navigation.ts`. A page that opens one thing says
 * so by passing its name, and that is the only line it has to write.
 */
function useDocumentTitle(title: string | undefined, pathname: string) {
  // The section is what the tab says until the thing arrives — and on the pages
  // that are a section and nothing else, what it keeps saying.
  const named = title ?? sectionAt(pathname)?.goTo.label;

  useEffect(() => {
    document.title = named === undefined ? PRODUCT : `${named} - ${PRODUCT}`;
    // Back to the bare product name on the way out, so the tab does not still
    // name a tool while the login form is on screen.
    return () => {
      document.title = PRODUCT;
    };
  }, [named]);
}

export function AppShell({
  user,
  section,
  workspacePath,
  sidebar,
  hideSidebar = false,
  scrollContent = false,
  showAdmin,
  title,
  onSignOut,
  children,
}: AppShellProps) {
  const workspaceFallback = useWorkspaceFallback(workspacePath === undefined);
  const { pathname } = useLocation();
  const collapsed = useSidebarCollapsed();
  const installation = useInstallation();

  // The session's answer unless a page insisted on one, so the admin button and
  // the admin half of Go to appear together and only for an administrator.
  const canAdmin = showAdmin ?? user.admin;
  const workspaceHere = workspacePath ?? workspaceFallback;

  useDocumentTitle(title, pathname);

  return (
    <div className={scrollContent ? `${styles.shell} ${styles.shellFixed}` : styles.shell}>
      <header className={styles.topNav}>
        {/* Brand and sections travel together; the box between them is centred. */}
        <div className={styles.topLeft}>
        {/*
          Out to the product's own site, and in a tab of its own.

          It leaves the application, which is the whole reason for the target:
          somebody with a half-written workflow open should not lose it to a
          click on the logo. That is how the two links in the footer already
          behave — the licence and the source — and this is the third link out
          of an interface that otherwise only goes to itself.

          Nothing is lost by it. The mark was inert before this, and the way
          back to a workspace is the Workspace tab immediately beside it.
        */}
        <a className={styles.brand} href={WEBSITE} target="_blank" rel="noreferrer noopener">
          <span className={styles.logoIcon}>
            {/* 24x20 is the mark's own ratio, and the size the website header uses. */}
            <img src={orknuxMark} alt="" width={24} height={20} />
          </span>
          <p className={styles.wordmark}>ORKNUX</p>
        </a>

        {/*
          What is left on this side is where the work is: the workspace you are
          in, and the chat about it. Admin and the manual moved to the corner
          with the account (issue #106) — both are somewhere you step out to,
          not a section of the thing being worked on.
        */}
        <nav className={styles.navLinks} aria-label="Sections">
          <span className={styles.navDivider} aria-hidden="true" />
          <TopNavLink to={workspaceHere} current={section === 'workspace'}>
            Workspace
          </TopNavLink>
          {/*
            Dropped rather than disabled where the installation has no chat: a
            tab that leads to "this is turned off" is a worse answer than no tab.
            Absent while the settings are unknown, so it does not appear and
            vanish a moment later.
          */}
          {installation?.chatEnabled === true && (
            <TopNavLink to="/chat" current={section === 'chat'}>
              Chat
            </TopNavLink>
          )}
        </nav>
        </div>

        {/* Between the sections and the account, where a location bar goes. */}
        <CommandPalette
          workspacePath={workspaceHere}
          showAdmin={canAdmin}
          showChat={installation?.chatEnabled === true}
        />

        {/*
          The corner: which workspace, then where else to go, then what is
          waiting, then who you are.

          One cell rather than several. This bar is a three-column grid — left,
          the centred search, right — and a fourth child made a fourth cell,
          which pushed the user block onto a row of its own underneath the
          header.

          The order runs from the broadest thing to the most personal, and it is
          also the order of how often it is used the other way round: the account
          stays on the outside edge where it has always been, so nothing anybody
          already knows where to find has moved. Between them a rule separates
          the selector — the one control that changes what the whole page is
          about — from the three small round things, which are tighter to each
          other than to their neighbours so five items read as three groups.
        */}
        <div className={styles.topRight}>
          <WorkspaceSwitcher workspacePath={workspaceHere} />
          <div className={styles.topRightIcons}>
            <TopIconLink to="/docs" icon={bookIcon} label="Docs" current={section === 'docs'} />
            {/*
              Not rendered at all for anybody else, rather than hidden: a button
              drawn and then covered is still in the tab order and still read
              aloud, and the pages behind it refuse them anyway.
            */}
            {canAdmin && (
              <TopIconLink to="/admin" icon={shieldIcon} label="Admin" current={section === 'admin'} />
            )}
            <NotificationBell />
          </div>
          <UserMenu user={user} onSignOut={onSignOut} />
        </div>
      </header>

      <div className={styles.workspace}>
        {!hideSidebar && (
          <nav
            className={collapsed ? `${styles.sidebar} ${styles.sidebarCollapsed}` : styles.sidebar}
            aria-label="Primary"
          >
            {sidebar}
          </nav>
        )}
        {!hideSidebar && (
          /*
            The handle that shuts the column, on the edge it moves.

            It belongs to the shell rather than to each sidebar - it is the
            column being collapsed, not what happens to be in it - and it has now
            been in four wrong places (issue #108): the attribution strip
            underneath, where it fell below the fold; a row of its own at the
            top; stuck to the view, which floated it over the menu as the page
            scrolled; and tucked against the first item, where a glyph centred in
            its hit area still read as part of that row.

            A sibling of the column rather than a child, because a collapsed
            column clips its own overflow to hide the labels, and anything
            straddling that edge from the inside would be cut in half. It is
            anchored to whichever width the column currently has, so it follows
            the edge when the edge moves.
          */
          <button
            type="button"
            className={collapsed ? `${styles.edgeHandle} ${styles.edgeHandleShut}` : styles.edgeHandle}
            onClick={() => setSidebarCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          >
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </button>
        )}
        {/*
          Keyed by the path so React replaces the node on navigation, which is
          what restarts the entrance animation. The editor fills the workspace
          itself and is left alone: animating a canvas that then measures itself
          makes it measure the wrong thing.
        */}
        <main
          key={hideSidebar ? undefined : pathname}
          className={
            [
              styles.content,
              hideSidebar ? styles.contentFlush : styles.contentEnter,
              scrollContent ? styles.contentScroll : '',
            ]
              .filter(Boolean)
              .join(' ')
          }
        >
          {children}
        </main>
      </div>

      {/*
        Mounted here rather than per page, which is what "on every page" has to
        mean: a page that forgot to include it would be the one page somebody
        had a question about. It shows itself only where the workspace has
        chosen a model for it.

        Except in the chat, where it would be a second, smaller conversation
        floating over the one already open — two boxes to type a question into,
        one of which keeps no history.
      */}
      {section !== 'chat' && <QuickChat workspacePath={workspaceHere} />}

      {/*
        The attribution the licence asks to be kept visible. In the shell rather
        than on a page, for the same reason: every signed-in screen is drawn
        inside this, so there is no screen it can be missing from.
      */}
      <footer className={styles.attributionBar}>
        <Attribution compact />
      </footer>
    </div>
  );
}

/**
 * The top-bar user block. Clicking it opens the account menu, which is where
 * signing out lives; without an [onSignOut] handler the block stays inert.
 */
function UserMenu({ user, onSignOut }: { user: AppShellUser; onSignOut?: () => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const onPreferences = useLocation().pathname.startsWith('/preferences');

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const userBlock = (
    <>
      <span className={styles.userText}>
        <span className={styles.userName}>{user.name}</span>
        <span className={styles.userRole}>{user.role}</span>
      </span>
      <span className={styles.avatar} aria-hidden="true">
        {user.initials}
      </span>
    </>
  );

  if (onSignOut === undefined) {
    return (
      <div className={onPreferences ? `${styles.userMenu} ${styles.userMenuCurrent}` : styles.userMenu}>
        {userBlock}
      </div>
    );
  }

  return (
    <div className={styles.userMenuWrapper} ref={container}>
      {/*
        Marked while Preferences is open, the way a section link is marked while
        its section is: the account block is how that page was reached, so it is
        where somebody looks to see they are still in it.
      */}
      <button
        type="button"
        className={
          onPreferences
            ? `${styles.userMenu} ${styles.userMenuButton} ${styles.userMenuCurrent}`
            : `${styles.userMenu} ${styles.userMenuButton}`
        }
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
      >
        {userBlock}
      </button>

      {open && (
        <div className={styles.userDropdown} role="menu">
          <Link
            to="/preferences"
            className={styles.menuItem}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <img src={settingsIcon} alt="" width={14} height={14} />
            Preferences
          </Link>
          <span className={styles.menuRule} aria-hidden="true" />
          <button
            type="button"
            className={styles.logOut}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <img src={doorOpenIcon} alt="" width={14} height={14} />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One of the small round destinations in the corner — the manual, the admin
 * section.
 *
 * A link with a name rather than an icon in a div: it is read aloud as "Docs,
 * link", it is in the tab order where it is on screen, and the browser's own
 * open-in-a-new-tab works on it. The title says the same thing to a pointer,
 * since the label itself is not drawn.
 */
function TopIconLink({
  to,
  icon,
  label,
  current,
}: {
  to: string;
  icon: string;
  label: string;
  current: boolean;
}) {
  return (
    <Link
      to={to}
      className={current ? `${styles.iconLink} ${styles.iconLinkCurrent}` : styles.iconLink}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      title={label}
    >
      <img src={icon} alt="" width={16} height={16} />
    </Link>
  );
}

/**
 * Which workspace, in the corner.
 *
 * It was under the logo, in the sidebar, which meant it was missing from every
 * screen with no sidebar — the manual, the chat, the admin section — and those
 * are exactly the screens somebody comes back to a workspace from. Here it is on
 * every screen, because the shell is.
 *
 * Nothing about *where* switching lands is decided here: that is
 * `workspaceSwitchPath`, unchanged from where the sidebar called it. A list page
 * keeps its place, a page about one thing falls back to its list, and a screen
 * belonging to no workspace goes to the new workspace's front page.
 */
function WorkspaceSwitcher({ workspacePath }: { workspacePath?: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // From the cache first, so moving between pages does not empty and refill it.
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => cachedWorkspaces() ?? []);

  useEffect(() => {
    loadWorkspaces(WORKSPACE_LOOKUP)
      .then(setWorkspaces)
      // A list that cannot be fetched is a selector that is not drawn, not an
      // error over somebody's page.
      .catch(() => undefined);
  }, []);

  const selectedId = workspacePath?.split('/').pop() ?? '';
  // Nothing to select yet — no workspaces, or the fallback still on its way.
  // Drawn with a value matching no option, a select shows an empty box.
  if (!workspaces.some((workspace) => workspace.id === selectedId)) return null;

  return (
    <>
      <WorkspaceSelector
        workspaces={workspaces}
        selectedId={selectedId}
        onSelect={(id) => navigate(workspaceSwitchPath(pathname, id))}
      />
      <span className={styles.topRightRule} aria-hidden="true" />
    </>
  );
}

function TopNavLink({ to, current, children }: { to?: string; current: boolean; children: ReactNode }) {
  const className = current ? `${styles.navLink} ${styles.navLinkCurrent}` : styles.navLink;

  if (to === undefined) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }

  return (
    <Link to={to} className={className} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}

/** Sidebar footer on the admin side. */
export function LdapStatus({ connected = true }: { connected?: boolean }) {
  return (
    <div className={styles.sidebarFooter}>
      <hr className={styles.divider} />
      <p className={styles.ldapStatus}>
        <span className={connected ? styles.statusDotOnline : styles.statusDotOffline} aria-hidden="true" />
        {connected ? 'LDAP Connected' : 'LDAP Unavailable'}
      </p>
    </div>
  );
}

interface WorkspaceSelectorProps {
  workspaces: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * The workspace's name with a chevron; a real select, so it opens with the
 * keyboard, is announced as a listbox, and behaves as the platform's own.
 *
 * The name alone, without the "Workspaces / " it carried in the sidebar: the
 * heading was worth having in a column with nothing else in it, and is a
 * hundred pixels of a corner that now holds four other things. What it is, is
 * what the label says.
 */
function WorkspaceSelector({ workspaces, selectedId, onSelect }: WorkspaceSelectorProps) {
  return (
    <div className={styles.workspaceSelector}>
      <select
        className={styles.workspaceSelect}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="Selected workspace"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      <img className={styles.workspaceChevron} src={chevronDown12Icon} alt="" width={12} height={12} />
    </div>
  );
}

export interface SidebarNavItemProps {
  /**
   * Usually a string. Takes nodes so a caller can mark part of it — the docs
   * search picks out the term it matched on inside the page's title.
   */
  label: ReactNode;
  icon: string;
  active?: boolean;
  /** Omitted while the destination does not exist yet. */
  to?: string;
  /** Small dot on the right, used for the current section on the admin sidebar. */
  indicator?: boolean;
}

export function SidebarNavItem({ label, icon, active = false, to, indicator = false }: SidebarNavItemProps) {
  const className = active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem;

  const body = (
    <>
      {/*
       * Masked rather than drawn: the icon files hardcode their stroke colour,
       * so an <img> is a fixed grey no CSS can reach. Masking takes the file's
       * alpha as the shape and paints it with background-color, which lets the
       * active item's icon carry the brand colour.
       */}
      <span
        className={styles.navIcon}
        /*
         * The quotes are load-bearing. Vite inlines these icons as data URIs
         * whose attributes are single-quoted, and an unquoted CSS url() token
         * cannot contain a quote character — the declaration is dropped and the
         * span renders as a solid block.
         */
        style={{ maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` }}
        aria-hidden="true"
      />
      <span className={styles.navLabel}>{label}</span>
      {indicator && <span className={styles.activeIndicator} aria-hidden="true" />}
    </>
  );

  if (to === undefined) {
    return (
      <span className={className} aria-disabled="true">
        {body}
      </span>
    );
  }

  return (
    <Link to={to} className={className} aria-current={active ? 'page' : undefined}>
      {body}
    </Link>
  );
}
