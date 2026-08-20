import commandIcon from '../assets/command.svg';
import chartLineIcon from '../assets/chart-line.svg';
import fileTextIcon from '../assets/file-text.svg';
import globeIcon from '../assets/globe.svg';
import layersIcon from '../assets/layers.svg';
import plugIcon from '../assets/plug.svg';
import puzzleIcon from '../assets/puzzle.svg';
import settingsIcon from '../assets/settings.svg';
import stethoscopeIcon from '../assets/activity.svg';
import terminalIcon from '../assets/terminal.svg';
import shieldIcon from '../assets/lock-keyhole.svg';
import userIcon from '../assets/user.svg';
import { SidebarNavItem } from './AppShell';
import styles from './AdminSidebar.module.css';

export type AdminSection =
  | 'workspaces'
  | 'users'
  | 'roles'
  | 'audit'
  | 'integrations'
  | 'plugins'
  | 'templates'
  | 'networking'
  | 'shell'
  | 'monitoring'
  | 'doctor'
  | 'settings';

/** The admin sidebar, shared by the workspaces, audit and settings screens. */
export function AdminSidebar({ active }: { active: AdminSection }) {
  return (
    <>
      <SidebarNavItem label="Workspaces" icon={commandIcon} active={active === 'workspaces'} to="/admin" />
      {/* Beside Workspaces, because what a role is for is which workspaces it opens. */}
      <SidebarNavItem label="Users" icon={userIcon} active={active === 'users'} to="/admin/users" />
      <SidebarNavItem label="Roles" icon={shieldIcon} active={active === 'roles'} to="/admin/roles" />
      <SidebarNavItem
        label="Audit Log"
        icon={fileTextIcon}
        active={active === 'audit'}
        to="/admin/audit"
      />
      <SidebarNavItem
        label="Integrations"
        icon={plugIcon}
        active={active === 'integrations'}
        to="/admin/integrations"
      />
      <SidebarNavItem
        label="Plugins"
        icon={puzzleIcon}
        active={active === 'plugins'}
        to="/admin/plugins"
      />
      {/*
        Beside Plugins, because both are things the installation offers to every
        workspace rather than things a workspace owns.
      */}
      <SidebarNavItem
        label="Templates"
        icon={layersIcon}
        active={active === 'templates'}
        to="/admin/templates"
      />
      {/*
        Beside Plugins rather than beside Monitoring: this is something the
        installation is configured with, not something observed about it.
      */}
      <SidebarNavItem
        label="Networking"
        icon={globeIcon}
        active={active === 'networking'}
        to="/admin/networking"
      />
      {/*
        Beside Networking, because both are about how this installation reaches
        something that is not it: one over HTTP and one over SSH.
      */}
      <SidebarNavItem
        label="Shell"
        icon={terminalIcon}
        active={active === 'shell'}
        to="/admin/shell"
      />
      <SidebarNavItem
        label="Monitoring"
        icon={chartLineIcon}
        active={active === 'monitoring'}
        to="/admin/monitoring"
      />
      {/*
        Beside Monitoring, and separate from it: one asks whether things can be
        reached, the other whether this installation is configured to work at all.
      */}
      <SidebarNavItem
        label="Doctor"
        icon={stethoscopeIcon}
        active={active === 'doctor'}
        to="/admin/doctor"
      />

      <SidebarNavItem
        label="Settings"
        icon={settingsIcon}
        active={active === 'settings'}
        to="/admin/settings"
      />
      <hr className={styles.divider} />
    </>
  );
}
