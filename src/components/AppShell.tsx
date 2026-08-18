import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { loadWorkspaces } from '../session/workspaces';
import chevronDownIcon from '../assets/chevron-down.svg';
import doorOpenIcon from '../assets/door-open.svg';
import orknuxMark from '../assets/orknux-mark.svg';
import panelCollapseIcon from '../assets/panel-collapse.svg';
import settingsIcon from '../assets/settings.svg';
import { lastWorkspaceId } from '../session/lastWorkspace';
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
}

export interface AppShellProps {
  user: AppShellUser;
  /** Which top-bar link is current. */
  section: 'admin' | 'workspace' | 'chat' | 'docs' | 'none';
  /** Destination for the Workspace link; the link is inert while no workspace is known. */
  workspacePath?: string;
  /** The admin section is only offered to holders of the admin role. */
  showAdmin?: boolean;
  /** Page-specific sidebar content. Null when the page hides the sidebar. */
  sidebar: ReactNode;
  /** The workflow editor fills the workspace itself. */
  hideSidebar?: boolean;
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

export function AppShell({
  user,
  section,
  workspacePath,
  sidebar,
  hideSidebar = false,
  scrollContent = false,
  showAdmin = true,
  onSignOut,
  children,
}: AppShellProps) {
  const workspaceFallback = useWorkspaceFallback(workspacePath === undefined);
  const { pathname } = useLocation();
  const collapsed = useSidebarCollapsed();
  const installation = useInstallation();

  return (
    <div className={scrollContent ? `${styles.shell} ${styles.shellFixed}` : styles.shell}>
      <header className={styles.topNav}>
        {/* Brand and sections travel together; the box between them is centred. */}
        <div className={styles.topLeft}>
        <div className={styles.brand}>
          <span className={styles.logoIcon}>
            {/* 24x20 is the mark's own ratio, and the size the website header uses. */}
            <img src={orknuxMark} alt="" width={24} height={20} />
          </span>
          <p className={styles.wordmark}>ORKNUX</p>
        </div>

        <nav className={styles.navLinks} aria-label="Sections">
          <span className={styles.navDivider} aria-hidden="true" />
          {showAdmin && (
            <TopNavLink to="/admin" current={section === 'admin'}>
              Admin
            </TopNavLink>
          )}
          <TopNavLink to={workspacePath ?? workspaceFallback} current={section === 'workspace'}>
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
          <TopNavLink to="/docs" current={section === 'docs'}>
            Docs
          </TopNavLink>
        </nav>
        </div>

        {/* Between the sections and the account, where a location bar goes. */}
        <CommandPalette
          workspacePath={workspacePath ?? workspaceFallback}
          showAdmin={showAdmin}
          showChat={installation?.chatEnabled === true}
        />

        {/*
          The bell and the name are one item, not two.

          This bar is a three-column grid - left, the centred search, right -
          and a fourth child made a fourth cell, which pushed the user block
          onto a row of its own underneath the header. They belong together
          anyway: the bell is about the person whose name is beside it.
        */}
        <div className={styles.topRight}>
          <NotificationBell />
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
            {/*
              The toggle belongs to the shell rather than to each sidebar: it is
              the column being collapsed, not what happens to be in it, so every
              screen gets it without having to remember to.
            */}
            <button
              type="button"
              className={styles.collapseToggle}
              onClick={() => setSidebarCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            >
              <img src={panelCollapseIcon} alt="" width={16} height={16} />
            </button>
          </nav>
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
      {section !== 'chat' && <QuickChat workspacePath={workspacePath ?? workspaceFallback} />}

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

export interface WorkspaceSelectorProps {
  workspaces: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

/** "Workspaces / <name>" with a chevron; a real select so it stays keyboard-usable. */
export function WorkspaceSelector({ workspaces, selectedId, onSelect }: WorkspaceSelectorProps) {
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
            Workspaces / {workspace.name}
          </option>
        ))}
      </select>
      <img className={styles.workspaceChevron} src={chevronDownIcon} alt="" width={16} height={16} />
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
