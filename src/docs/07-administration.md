# Administration

The admin section is for the organisation rather than for any one workspace.
It is offered only to holders of the admin role.

## Workspaces

Create a workspace, rename it, give it a description, and assign the roles whose
holders may see it. Deleting one takes its contents with it.

## Roles

A role is what your provider says about somebody — a directory group, or a claim
from an OIDC provider — mapped once, here, to something this application
understands. Each has scopes, and for now those are `admin` and `user`.

Workspaces are then granted to roles rather than to group names typed in by
hand, so the same role can open several workspaces and a provider change is one
edit instead of many.

The built-in **Administrators** role cannot be edited or removed: an
installation that could delete its way out of having an administrator is one
nobody can get back into.

## Audit logs

There are two, and the difference matters.

- The **organisation audit log** records what happened to the organisation:
  workspaces created, renamed and removed, their directory group and
  description changed, and installation-wide switches pressed.
- Each workspace's own **audit log** records everything that happened inside
  it — workflows, agents, models, memory, objects, integrations, chats.

Both can be filtered by user and by period, and searched.

## Settings

What this installation allows, for every workspace in it.

- **Chat** — whether this installation has a chat at all. Off takes the tab
  away and refuses new messages; conversations already had are kept.
- **Files in chats** — whether messages may carry attachments. Off takes the
  button away; what has already been uploaded stays where it is.

Below each switch, in grey, is what the operator set in the configuration file:
where attachments are written, what storage they use, and how large one file may
be. Those are read-only here — a filesystem path is not something to hand a
browser the ability to change.

The configuration file is the floor. An administrator can turn something off
from this screen, but not back on where the file has said no.

## Monitoring

What is answering and what is not: the server, the database, Temporal, and the
connections workspaces depend on. A run's underlying Temporal workflow can be
opened from here and from the run page.

## Doctor

Monitoring asks whether the server can reach the things it needs. Doctor asks
the other question: **is this installation configured correctly?**

They are not the same, and the gap between them is where the worst faults live.
A secret key that was never set is only validated on first use, so the server
starts, every dependency answers and monitoring is entirely green — while every
credential written hours later fails. Doctor checks the key, the credentials
already stored under it, how sign-in is configured, and the schema version, and
says which of them is wrong rather than that something is.

## Plugins

JavaScript loaded into the sandbox to give workflows functions the platform does
not ship. A plugin can be uploaded, fetched from a URL, or written from the
starter this server generates — in JavaScript or TypeScript — and downloaded
again later as whichever of the two it was written in.

A plugin's key is its identity, not its filename: loading the same key again
replaces what is there.

## Configuration

The settings an operator owns live under `orknux` in the application's YAML:

```yaml
orknux:
  chat:
    enabled: true
  attachments:
    enabled: true
    storage: FILESYSTEM
    location: /var/lib/orknux/attachments
    max-file-size-mb: 25
  logging:
    file: /var/log/orknux/orknux.log
    format: json
  temporal:
    ui-url: http://temporal:8080
```

Name an absolute path for `location` in a deployment: relative resolves against
the working directory, which in a container is not somewhere anyone goes
looking.
