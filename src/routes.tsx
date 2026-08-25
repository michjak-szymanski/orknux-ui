import type { ReactNode } from 'react';

import type { SessionUser } from './api/session';
import type { PagePath } from './navigation';
import { AdminAuditPage } from './pages/admin/AdminAuditPage';
import { AdminDoctorPage } from './pages/admin/AdminDoctorPage';
import { AdminIntegrationsPage } from './pages/admin/AdminIntegrationsPage';
import { AdminLibrariesPage } from './pages/admin/AdminLibrariesPage';
import { AdminMonitoringPage } from './pages/admin/AdminMonitoringPage';
import { AdminNetworkingPage } from './pages/admin/AdminNetworkingPage';
import { AdminShellPage } from './pages/admin/AdminShellPage';
import { AdminTemplatePage } from './pages/admin/AdminTemplatePage';
import { AdminTemplatesPage } from './pages/admin/AdminTemplatesPage';
import { AdminShellSettingsPage } from './pages/admin/AdminShellSettingsPage';
import { AdminPage } from './pages/admin/AdminPage';
import { AdminPluginsPage } from './pages/admin/AdminPluginsPage';
import { AdminRolesPage } from './pages/admin/AdminRolesPage';
import { AdminUserPage } from './pages/admin/AdminUserPage';
import { WorkspaceIssuePage } from './pages/workspace/WorkspaceIssuePage';
import { WorkspaceIssuesPage } from './pages/workspace/WorkspaceIssuesPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { ActionSettingsPage } from './pages/workspace/ActionSettingsPage';
import { WorkspaceSettingsPage as AdminWorkspaceSettingsPage } from './pages/workspace-settings/WorkspaceSettingsPage';
import { AgentSettingsPage } from './pages/workspace/AgentSettingsPage';
import { AgentsPage } from './pages/workspace/AgentsPage';
import { ChatPage } from './pages/chat/ChatPage';
import { ConditionSettingsPage } from './pages/workspace/ConditionSettingsPage';
import { ConnectionSettingsPage } from './pages/workspace/ConnectionSettingsPage';
import { DocsPage } from './pages/docs/DocsPage';
import { ExecutionDetailPage } from './pages/workspace/ExecutionDetailPage';
import { ExecutionsPage } from './pages/workspace/ExecutionsPage';
import { FunctionEditorPage } from './pages/workspace/FunctionEditorPage';
import { McpServerSettingsPage } from './pages/workspace/McpServerSettingsPage';
import { MemoryEditorPage } from './pages/workspace/MemoryEditorPage';
import { ModelSettingsPage } from './pages/workspace/ModelSettingsPage';
import { NoWorkspacesPage } from './pages/no-workspaces/NoWorkspacesPage';
import { ObjectEditorPage } from './pages/workspace/ObjectEditorPage';
import { PreferencesPage } from './pages/preferences/PreferencesPage';
import { ProviderSettingsPage } from './pages/workspace/ProviderSettingsPage';
import { SessionDetailPage } from './pages/workspace/SessionDetailPage';
import { SkillEditorPage } from './pages/workspace/SkillEditorPage';
import { ToolEditorPage } from './pages/workspace/ToolEditorPage';
import { TriggerSettingsPage } from './pages/workspace/TriggerSettingsPage';
import { WorkflowEditorPage } from './pages/workspace/WorkflowEditorPage';
import { WorkflowSettingsPage } from './pages/workspace/WorkflowSettingsPage';
import { WorkspaceActionsPage } from './pages/workspace/WorkspaceActionsPage';
import { WorkspaceAuditPage } from './pages/workspace/WorkspaceAuditPage';
import { WorkspaceConditionsPage } from './pages/workspace/WorkspaceConditionsPage';
import { WorkspaceFunctionsPage } from './pages/workspace/WorkspaceFunctionsPage';
import { WorkspaceIntegrationsPage } from './pages/workspace/WorkspaceIntegrationsPage';
import { WorkspaceMemoryPage } from './pages/workspace/WorkspaceMemoryPage';
import { WorkspaceModelsPage } from './pages/workspace/WorkspaceModelsPage';
import { WorkspaceObjectsPage } from './pages/workspace/WorkspaceObjectsPage';
import { WorkspaceSettingsPage } from './pages/workspace/WorkspaceSettingsPage';
import { WorkspaceSessionsPage } from './pages/workspace/WorkspaceSessionsPage';
import { WorkspaceTasksPage } from './pages/workspace/WorkspaceTasksPage';
import { TaskPage } from './pages/workspace/TaskPage';
import { WorkspaceSkillsPage } from './pages/workspace/WorkspaceSkillsPage';
import { WorkspaceToolsPage } from './pages/workspace/WorkspaceToolsPage';
import { WorkspaceTriggersPage } from './pages/workspace/WorkspaceTriggersPage';
import { WorkspacePluginsPage } from './pages/workspace/WorkspacePluginsPage';
import { WorkspaceVariablesPage } from './pages/workspace/WorkspaceVariablesPage';
import { WorkspaceWorkflowsPage } from './pages/workspace/WorkspaceWorkflowsPage';

/** What a page needs to render: who is signed in, and how they sign out. */
export type PageElement = (session: SessionUser, onSignOut: () => void) => ReactNode;

/**
 * What each page renders.
 *
 * Keyed by `PagePath`, which is derived from the registry in `navigation.ts` — so
 * this record must have an entry for every page and may have entries for nothing
 * else. Both directions are compile errors: a page added to the registry with no
 * element here does not build, and an element here with no registry entry does not
 * either.
 *
 * That is the point. A page used to be added by writing a route, and appearing in
 * Quick actions was a second, separate, forgettable step — which was duly forgotten twice.
 * Now the two halves cannot be written apart from each other.
 */
export const PAGE_ELEMENTS: Record<PagePath, PageElement> = {
  '/workspace/:workspaceId': (session, onSignOut) => <WorkspaceWorkflowsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/executions': (session, onSignOut) => <ExecutionsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/triggers': (session, onSignOut) => <WorkspaceTriggersPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/actions': (session, onSignOut) => <WorkspaceActionsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/conditions': (session, onSignOut) => <WorkspaceConditionsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/issues': (session, onSignOut) => <WorkspaceIssuesPage session={session} onSignOut={onSignOut} />,
  /* Before the one with an id in it: `new` is a page, not an issue called new. */
  '/workspace/:workspaceId/issues/new': (session, onSignOut) => <WorkspaceIssuePage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/issues/:number': (session, onSignOut) => <WorkspaceIssuePage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/functions': (session, onSignOut) => <WorkspaceFunctionsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/agents': (session, onSignOut) => <AgentsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/objects': (session, onSignOut) => <WorkspaceObjectsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/variables': (session, onSignOut) => <WorkspaceVariablesPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/plugins': (session, onSignOut) => <WorkspacePluginsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/memory': (session, onSignOut) => <WorkspaceMemoryPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/skills': (session, onSignOut) => <WorkspaceSkillsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/tools': (session, onSignOut) => <WorkspaceToolsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/sessions': (session, onSignOut) => <WorkspaceSessionsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/tasks': (session, onSignOut) => <WorkspaceTasksPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/models': (session, onSignOut) => <WorkspaceModelsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/integrations': (session, onSignOut) => <WorkspaceIntegrationsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/audit': (session, onSignOut) => <WorkspaceAuditPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/settings': (session, onSignOut) => <WorkspaceSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/executions/:executionId': (session, onSignOut) => <ExecutionDetailPage session={session} onSignOut={onSignOut} />,
  /* Before the one with an id in it: `new` is a page, not an action called new. */
  '/workspace/:workspaceId/actions/new': (session, onSignOut) => <ActionSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/actions/:actionId': (session, onSignOut) => <ActionSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/functions/new': (session, onSignOut) => <FunctionEditorPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/functions/:functionId': (session, onSignOut) => <FunctionEditorPage session={session} onSignOut={onSignOut} />,
  /* Before the one with an id in it: `new` is a page, not a condition called new. */
  '/workspace/:workspaceId/conditions/new': (session, onSignOut) => <ConditionSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/conditions/:conditionId': (session, onSignOut) => <ConditionSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/triggers/:triggerId': (session, onSignOut) => <TriggerSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/integrations/servers/:serverId': (session, onSignOut) => <McpServerSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/integrations/connections/:connectionId': (session, onSignOut) => <ConnectionSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/tools/:toolId': (session, onSignOut) => <ToolEditorPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/objects/:objectId': (session, onSignOut) => <ObjectEditorPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/skills/:skillId': (session, onSignOut) => <SkillEditorPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/models/providers/new': (session, onSignOut) => <ProviderSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/models/providers/:providerId': (session, onSignOut) => <ProviderSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/models/:modelId': (session, onSignOut) => <ModelSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/agents/:agentId/settings': (session, onSignOut) => <AgentSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/workflows/:workflowId/editor': (session, onSignOut) => <WorkflowEditorPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/workflows/:workflowId/settings': (session, onSignOut) => <WorkflowSettingsPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/memory/new': (session, onSignOut) => <MemoryEditorPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/memory/:memoryId': (session, onSignOut) => <MemoryEditorPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/sessions/:sessionId': (session, onSignOut) => <SessionDetailPage session={session} onSignOut={onSignOut} />,
  '/workspace/:workspaceId/tasks/:taskId': (session, onSignOut) => <TaskPage session={session} onSignOut={onSignOut} />,
  '/chat': (session, onSignOut) => <ChatPage session={session} onSignOut={onSignOut} />,
  '/chat/:chatId': (session, onSignOut) => <ChatPage session={session} onSignOut={onSignOut} />,
  '/docs': (session, onSignOut) => <DocsPage session={session} onSignOut={onSignOut} />,
  '/docs/:page': (session, onSignOut) => <DocsPage session={session} onSignOut={onSignOut} />,
  '/admin': (session, onSignOut) => <AdminPage session={session} onSignOut={onSignOut} />,
  '/admin/audit': (session, onSignOut) => <AdminAuditPage session={session} onSignOut={onSignOut} />,
  '/admin/integrations': (session, onSignOut) => <AdminIntegrationsPage session={session} onSignOut={onSignOut} />,
  '/admin/plugins': (session, onSignOut) => <AdminPluginsPage session={session} onSignOut={onSignOut} />,
  '/admin/libraries': (session, onSignOut) => <AdminLibrariesPage session={session} onSignOut={onSignOut} />,
  '/admin/templates': (session, onSignOut) => <AdminTemplatesPage session={session} onSignOut={onSignOut} />,
  /* Before the one with an id in it: `new` is a page, not a template called new. */
  '/admin/templates/new': (session, onSignOut) => <AdminTemplatePage session={session} onSignOut={onSignOut} />,
  '/admin/templates/:templateId': (session, onSignOut) => (
    <AdminTemplatePage session={session} onSignOut={onSignOut} />
  ),
  '/admin/networking': (session, onSignOut) => (
    <AdminNetworkingPage session={session} onSignOut={onSignOut} />
  ),
  '/admin/shell': (session, onSignOut) => <AdminShellPage session={session} onSignOut={onSignOut} />,
  /* Before the one with an id in it: `new` is a page, not a shell called new. */
  '/admin/shell/new': (session, onSignOut) => <AdminShellSettingsPage session={session} onSignOut={onSignOut} />,
  '/admin/shell/:shellId': (session, onSignOut) => <AdminShellSettingsPage session={session} onSignOut={onSignOut} />,
  '/admin/roles': (session, onSignOut) => <AdminRolesPage session={session} onSignOut={onSignOut} />,
  '/admin/users': (session, onSignOut) => <AdminUsersPage session={session} onSignOut={onSignOut} />,
  /* Before the one with an id in it: `new` is a page, not a user called new. */
  '/admin/users/new': (session, onSignOut) => <AdminUserPage session={session} onSignOut={onSignOut} />,
  '/admin/users/:userId': (session, onSignOut) => <AdminUserPage session={session} onSignOut={onSignOut} />,
  '/admin/monitoring': (session, onSignOut) => <AdminMonitoringPage session={session} onSignOut={onSignOut} />,
  '/admin/doctor': (session, onSignOut) => <AdminDoctorPage session={session} onSignOut={onSignOut} />,
  '/admin/settings': (session, onSignOut) => <AdminSettingsPage session={session} onSignOut={onSignOut} />,
  '/admin/workspaces/:workspaceId/settings': (session, onSignOut) => <AdminWorkspaceSettingsPage session={session} onSignOut={onSignOut} />,
  '/preferences': (session, onSignOut) => <PreferencesPage session={session} onSignOut={onSignOut} />,
  '/no-workspaces': (session, onSignOut) => <NoWorkspacesPage session={session} onSignOut={onSignOut} />,
};
