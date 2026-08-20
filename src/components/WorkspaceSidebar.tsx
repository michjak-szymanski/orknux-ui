import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import type { Workspace } from '../api/workspaces';
import { sectionAt, sectionLinks } from '../navigation';
import type { Where } from '../navigation';
import { rememberWorkspace } from '../session/lastWorkspace';
import { cachedWorkspaces, loadWorkspaces } from '../session/workspaces';
import { SidebarNavItem } from './AppShell';

export interface WorkspaceSidebarProps {
  workspaceId: string;
  /** Called with the workspaces once loaded, so pages can show the workspace's name. */
  onWorkspacesLoaded?: (workspaces: Workspace[]) => void;
}

const WORKSPACE_LIST_SIZE = 100;

/**
 * Which menu the address falls under when it falls under none.
 *
 * Only reachable if this column is drawn on a page the registry does not know,
 * which the router does not allow. A workspace's front page is the least
 * surprising place to be pointed at if it ever happens.
 */
const FALLBACK: Where = 'Flow';

/**
 * The menu down the side of a workspace page.
 *
 * There are three of these now — AI, Workflow and Workspace (issue #110) — and
 * this component is all three, because which one it is follows from the address
 * rather than from anything the page says. That is deliberate: a page used to
 * name its own menu entry (`active="agents"`), which meant every page stated
 * where it lived a second time, and the three sections would have made it a
 * third. The registry says it once; this reads it.
 */
export function WorkspaceSidebar({ workspaceId, onWorkspacesLoaded }: WorkspaceSidebarProps) {
  const { pathname } = useLocation();

  // So the top bar's section links and the workspace selector can come back
  // here from the admin side.
  useEffect(() => rememberWorkspace(workspaceId), [workspaceId]);

  useEffect(() => {
    const known = cachedWorkspaces();
    // The page waits on this for the workspace's name, so a cached list has to
    // reach it now rather than after a round trip it does not need.
    if (known !== null) onWorkspacesLoaded?.(known);

    loadWorkspaces(WORKSPACE_LIST_SIZE)
      .then((list) => onWorkspacesLoaded?.(list))
      // A failed revalidation leaves the page with whatever the cache had, which
      // is almost certainly still right.
      .catch(() => undefined);
    // The callback is only a notification; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    The nearest page above here that is somewhere to be — so the editor of one
    function marks Functions, and one agent's settings marks Agents, without
    either page saying so.
  */
  const here = sectionAt(pathname);
  const links = sectionLinks(here?.goTo.where ?? FALLBACK, `/workspace/${workspaceId}`);

  return (
    <>
      {/*
        The workspace selector used to be here, under the logo. It is in the top
        right now, beside the account (issue #106), because it belongs to every
        screen and not only to the ones with this column on them. Where switching
        lands is still `workspaceSwitchPath`; the shell calls it.
      */}
      {links.map((link) => (
        <SidebarNavItem
          key={link.path}
          label={link.label}
          icon={link.icon}
          /* The pattern, not the address: `/workspace/1` and `/workspace/2` are
             the same entry of the same menu. */
          active={link.path === here?.path}
          to={link.to}
        />
      ))}
    </>
  );
}
