import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { Workspace } from '../api/workspaces';
import activityIcon from '../assets/activity.svg';
import bellIcon from '../assets/bell.svg';
import bookIcon from '../assets/book.svg';
import boxIcon from '../assets/box.svg';
import memoryIcon from '../assets/memory.svg';
import botIcon from '../assets/bot.svg';
import chartNetworkIcon from '../assets/chart-network.svg';
import clipboardListIcon from '../assets/clipboard-list.svg';
import codeIcon from '../assets/code.svg';
import databaseIcon from '../assets/database.svg';
import filterIcon from '../assets/filter.svg';
import gitBranchIcon from '../assets/git-branch.svg';
import lockKeyholeIcon from '../assets/lock-keyhole.svg';
import plugIcon from '../assets/plug.svg';
import settingsIcon from '../assets/settings.svg';
import puzzleIcon from '../assets/puzzle.svg';
import toolIcon from '../assets/tool.svg';
import alertTriangleIcon from '../assets/alert-triangle.svg';
import { workspaceSwitchPath } from '../navigation';
import { rememberWorkspace } from '../session/lastWorkspace';
import { cachedWorkspaces, loadWorkspaces } from '../session/workspaces';
import { SidebarNavItem, WorkspaceSelector } from './AppShell';

export type WorkspaceSection =
  | 'executions'
  | 'workflows'
  | 'actions'
  | 'functions'
  | 'triggers'
  | 'conditions'
  | 'agents'
  | 'tools'
  | 'skills'
  | 'objects'
  | 'variables'
  | 'plugins'
  | 'memory'
  | 'issues'
  | 'audit'
  | 'integrations'
  | 'models'
  | 'settings';

export interface WorkspaceSidebarProps {
  workspaceId: string;
  active: WorkspaceSection;
  /** Called with the workspaces once loaded, so pages can show the workspace's name. */
  onWorkspacesLoaded?: (workspaces: Workspace[]) => void;
}

const WORKSPACE_LIST_SIZE = 100;

export function WorkspaceSidebar({ workspaceId, active, onWorkspacesLoaded }: WorkspaceSidebarProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Painting from cache is what stops the selector emptying and refilling on a
  // navigation that never left the workspace: this sidebar is a new mount, but
  // the list it needs is the one the last mount already fetched.
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => cachedWorkspaces() ?? []);

  // So the top bar's Workspace tab can come back here from the admin side.
  useEffect(() => rememberWorkspace(workspaceId), [workspaceId]);

  useEffect(() => {
    const known = cachedWorkspaces();
    // The page waits on this for the workspace's name, so a cached list has to
    // reach it now rather than after a round trip it does not need.
    if (known !== null) onWorkspacesLoaded?.(known);

    loadWorkspaces(WORKSPACE_LIST_SIZE)
      .then((list) => {
        setWorkspaces(list);
        onWorkspacesLoaded?.(list);
      })
      .catch(() => {
        // A failed revalidation is not a reason to throw away a list that is
        // almost certainly still right.
        if (known === null) setWorkspaces([]);
      });
    // The callback is only a notification; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/*
        Changing workspace used to change page as well: whatever was open, the
        selector sent you to the front of the new workspace. Now it keeps the
        screen where the screen exists in both — a list page keeps its place, an
        entity page falls back to its list, since issue #4 there is a different
        issue or none. `workspaceSwitchPath` is where that is written down.
      */}
      <WorkspaceSelector
        workspaces={workspaces}
        selectedId={workspaceId}
        onSelect={(id) => navigate(workspaceSwitchPath(pathname, id))}
      />
      <SidebarNavItem
        label="Executions"
        icon={gitBranchIcon}
        active={active === 'executions'}
        to={`/workspace/${workspaceId}/executions`}
      />
      <SidebarNavItem
        label="Workflows"
        icon={chartNetworkIcon}
        active={active === 'workflows'}
        to={`/workspace/${workspaceId}`}
      />
      <SidebarNavItem
        label="Actions"
        icon={activityIcon}
        active={active === 'actions'}
        to={`/workspace/${workspaceId}/actions`}
      />
      <SidebarNavItem
        label="Functions"
        icon={codeIcon}
        active={active === 'functions'}
        to={`/workspace/${workspaceId}/functions`}
      />
      <SidebarNavItem
        label="Triggers"
        icon={bellIcon}
        active={active === 'triggers'}
        to={`/workspace/${workspaceId}/triggers`}
      />
      <SidebarNavItem
        label="Conditions"
        icon={filterIcon}
        active={active === 'conditions'}
        to={`/workspace/${workspaceId}/conditions`}
      />
      <SidebarNavItem
        label="Agents"
        icon={botIcon}
        active={active === 'agents'}
        to={`/workspace/${workspaceId}/agents`}
      />
      <SidebarNavItem
        label="Tools"
        icon={toolIcon}
        active={active === 'tools'}
        to={`/workspace/${workspaceId}/tools`}
      />
      <SidebarNavItem
        label="Skills"
        icon={bookIcon}
        active={active === 'skills'}
        to={`/workspace/${workspaceId}/skills`}
      />
      <SidebarNavItem
        label="Variables"
        icon={lockKeyholeIcon}
        active={active === 'variables'}
        to={`/workspace/${workspaceId}/variables`}
      />
      {/*
        Beside Variables, because that is what most of a plugin's parameters end
        up pointing at, and because both answer the same question: what this
        workspace has told something that runs on its behalf.
      */}
      <SidebarNavItem
        label="Plugins"
        icon={puzzleIcon}
        active={active === 'plugins'}
        to={`/workspace/${workspaceId}/plugins`}
      />
      <SidebarNavItem
        label="Objects"
        icon={boxIcon}
        active={active === 'objects'}
        to={`/workspace/${workspaceId}/objects`}
      />
      <SidebarNavItem
        label="Memory"
        icon={memoryIcon}
        active={active === 'memory'}
        to={`/workspace/${workspaceId}/memory`}
      />
      {/* What is wrong with this workspace's work, beside the work itself. */}
      <SidebarNavItem
        label="Issues"
        icon={alertTriangleIcon}
        active={active === 'issues'}
        to={`/workspace/${workspaceId}/issues`}
      />
      <SidebarNavItem
        label="Audit Log"
        icon={clipboardListIcon}
        active={active === 'audit'}
        to={`/workspace/${workspaceId}/audit`}
      />
      <SidebarNavItem
        label="Integrations"
        icon={plugIcon}
        active={active === 'integrations'}
        to={`/workspace/${workspaceId}/integrations`}
      />
      <SidebarNavItem
        label="Models"
        icon={databaseIcon}
        active={active === 'models'}
        to={`/workspace/${workspaceId}/models`}
      />
      <SidebarNavItem
        label="Settings"
        icon={settingsIcon}
        active={active === 'settings'}
        to={`/workspace/${workspaceId}/settings`}
      />
    </>
  );
}
