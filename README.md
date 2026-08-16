# orknux-ui

The front end for
[orknux-server](https://github.com/michjak-szymanski/orknux-server): React +
TypeScript, built with Vite, styled with CSS Modules over the design tokens in
`src/styles/tokens.css`. Workflows are edited on a React Flow canvas.

# Running

Node is not installed locally, so the toolchain runs in Docker:

```
docker compose up dev                          # dev server on http://localhost:5173
docker compose run --rm dev npm run typecheck  # tsc -b
docker compose run --rm dev npm run build      # production bundle into dist/
```

The UI talks only to orknux-server, which in turn reaches orknux-connector and
orknux-workflow. In the orknux-server checkout:

```
docker compose up -d              # postgres, openldap and temporal
./mvnw spring-boot:run -pl app    # http://localhost:8080
```

The dev server proxies `/api` and `/graphql` to it (override with `ORKNUX_SERVER_URL`),
so the browser stays on one origin and the session cookie is first-party.
Sign in with a directory user from `docker/ldap/bootstrap.ldif` — `alice` / `password`
sees everything, `bob` / `password` only the workspaces his groups grant.

# Objectives
- React Flow for visualizing and editing ai workflows
- React + other for management/configuration views

# UI Flow

## UI structure
We have five distinct kinds of pages
- login page (for an admin or workspace access)
- admin management page (where admin settings can be adjusted, including workspace listing, allows to create workflow templates)
- workspace management page (connections to Slack, GH, Jira, etc, agent definitions, models, tools and skills)
- workflow edit page (React Flow -> allows editing agentic workflows, and a workflow is built as a graph PER workspace)
- chat, where a person talks to one of the workspace's models directly

Preferences sits outside all of them: it belongs to the person rather than to any
workspace, so it has no sidebar.

## Admin page

Administrators only; everyone else is sent to their first workspace, or to a "no workspaces
yet" page when their directory groups grant none.

| route                                | page                                                         |
|--------------------------------------|--------------------------------------------------------------|
| `/admin`                             | Workspaces, with create / rename / delete                    |
| `/admin/audit`                       | Admin audit log, filtered and paged                          |
| `/admin/integrations`                | Default connections assigned to new workspaces               |
| `/admin/monitoring`                  | Health of the server and its dependencies, and both versions |
| `/admin/workspaces/:workspaceId/settings` | Workspace settings, including the LDAP group            |

And outside any section:

| route          | page                                                    |
|----------------|---------------------------------------------------------|
| `/login`       | Sign in                                                 |
| `/chat`        | Chats with the workspace's models                       |
| `/preferences` | The signed-in person's own settings, including the theme |
| `/no-workspaces` | Shown when someone's directory groups grant none       |

## Workspace pages

| route                                              | page                          |
|----------------------------------------------------|-------------------------------|
| `/workspace/:workspaceId`                                    | Workflows                     |
| `/workspace/:workspaceId/executions`                         | Runs of the workspace's workflows  |
| `/workspace/:workspaceId/executions/:executionId`            | One run: graph, log, node panel |
| `/workspace/:workspaceId/actions`                            | The workspace's action catalogue   |
| `/workspace/:workspaceId/functions`                          | The workspace's JavaScript functions |
| `/workspace/:workspaceId/functions/:functionId`              | One function: editor and properties |
| `/workspace/:workspaceId/conditions`                         | The workspace's condition catalogue |
| `/workspace/:workspaceId/triggers`                           | The workspace's trigger catalogue  |
| `/workspace/:workspaceId/agents`                             | Agents, and their settings    |
| `/workspace/:workspaceId/agents/:agentId/settings`           | One agent: model, tools, skills |
| `/workspace/:workspaceId/tools`                              | The workspace's tools         |
| `/workspace/:workspaceId/tools/:toolId`                      | One tool: JavaScript editor   |
| `/workspace/:workspaceId/skills`                             | The workspace's skills        |
| `/workspace/:workspaceId/skills/:skillId`                    | One skill: markdown editor    |
| `/workspace/:workspaceId/models`                             | Providers, and the models reached through them |
| `/workspace/:workspaceId/models/providers/new`               | Add a provider                |
| `/workspace/:workspaceId/models/providers/:providerId`       | Provider settings             |
| `/workspace/:workspaceId/models/:modelId`                    | One model: quotas and usage   |
| `/workspace/:workspaceId/audit`                              | Workspace audit log                |
| `/workspace/:workspaceId/integrations`                       | MCP servers and connections   |
| `/workspace/:workspaceId/integrations/servers/:serverId`     | MCP server settings           |
| `/workspace/:workspaceId/integrations/connections/:connectionId`       | Connection settings           |
| `/workspace/:workspaceId/workflows/:workflowId/editor`       | The React Flow editor         |
| `/workspace/:workspaceId/workflows/:workflowId/settings`     | Workflow settings             |
| `/workspace/:workspaceId/actions/:actionId`                  | One action in the catalogue   |
| `/workspace/:workspaceId/conditions/:conditionId`            | One condition in the catalogue |

# Licence

**GNU Affero General Public License v3.0 or later** — see [LICENSE](LICENSE),
and [NOTICE](NOTICE) for the section 7(b) term requiring the attribution this
interface displays to be preserved.

That attribution is the line in the shell and on the sign-in screen; it is drawn
by `src/components/Attribution.tsx`.

Copyright (C) 2026 Michał Szymański.
