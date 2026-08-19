# Administration

The admin section is for the organisation rather than for any one workspace.
It is offered only to holders of the admin role.

## Workspaces

![Every workspace on the installation](/screens/admin-workspaces.png)

Create a workspace, rename it, give it a description, and assign the roles whose
holders may see it.

Deleting one is meant to take its contents with it, and today it refuses when
any of the workspace's agents is used by a node in a workflow — the workflow
still points at the agent, so the workspace will not go. Empty the graphs that
use them, or remove the workflows, and the delete goes through.

## Roles

![The roles this installation defines, and what each one opens](/screens/roles.png)

A role is what your provider says about somebody — a directory group, or a claim
from an OIDC provider — mapped once, here, to something this application
understands. Each has scopes, and for now those are `admin` and `user`.

Workspaces are then granted to roles rather than to group names typed in by
hand, so the same role can open several workspaces and a provider change is one
edit instead of many.

The built-in **Administrators** role cannot be edited or removed: an
installation that could delete its way out of having an administrator is one
nobody can get back into.

## Users

![Everybody this installation knows, and where each of them came from](/screens/users.png)

Two kinds of person appear here, and the badge on the row says which.

- **External** users come from your organisation's provider. They are recorded
  the first time they sign in, and almost nothing about them is edited here: the
  provider is what says who they are. Their email address is the one exception,
  below.
- **Internal** users are made here, for somebody the provider does not know - a
  contractor, a service, a person who needs one workspace and nothing else.
  Administrators only, and only this kind can be created.

![One user: the roles they hold, a password if they need one, and the tokens
they carry](/screens/user.png)

An internal user cannot sign in until somebody gives them a **password**, set on
their page and at least twelve characters long. Setting a new one replaces it
without asking for the old one, because an administrator doing this is how
somebody who is locked out gets back in. Changing your own password does ask for
the current one.

Internal users are tried before the directory when somebody signs in, so an
installation that authenticates everybody else through a single sign-on provider
still lets them in. Their roles then work exactly as anybody else's do.

## Email addresses

Every user has an address: somewhere to write to them, when anything needs to.

It arrives on its own. The directory's `mail` attribute, or the OIDC provider's
`email` claim, is read at every sign-in and kept in step with whatever the
provider says, so for most people the field fills itself and is never touched.

Somebody who wants a different address sets their own in **Preferences**. An
administrator can set anybody's from that person's page under Users, external
users included - which is the point of the arrangement, since an external user
is exactly the person whose provider might have the wrong address or none at
all. Once an address has been typed, sign-in leaves it alone. A directory that
overwrote a chosen address every morning would make the field useless: the edit
would last until the next time that person arrived.

Clearing it hands the field back to the provider. The next sign-in seeds it
again from the directory, as though it had never been set.

## Access tokens

A token is a way of being a user without a browser: it is what an agent, a
script or the MCP endpoint uses. They are made on a user's page under **Access
Tokens**, named for what they are for, and the secret is shown once.

- It begins `orkx_`, so one that has leaked is recognisable on sight in a log or
  a paste.
- Only a hash of it is stored, which is why there is no way to see it again.
- It is sent as `Authorization: Bearer orkx_…`, and that is what reaches both
  the API and the MCP endpoint.
- It carries its owner's roles and nothing else. There are no scopes and no
  narrower grant: a token is that user by another door.
- It does not expire. Revoking is how one ends, and each row says when it was
  last used - or that it never has been - so one nobody needs is easy to find.

Tokens belong to internal users. A token for somebody the provider vouches for
would outlive whatever the provider later decides about them.

## Audit logs

![The audit log: who changed what, and when](/screens/audit.png)

There are two, and the difference matters.

- The **organisation audit log** records what happened to the organisation:
  workspaces created, renamed and removed, their directory group and
  description changed, and installation-wide switches pressed.
- Each workspace's own **audit log** records everything that happened inside
  it — workflows, agents, models, memory, objects, integrations, chats.

Both can be filtered by user and by period, and searched.

## Settings

![The switches that belong to the installation rather than to a workspace](/screens/admin-settings.png)

What this installation allows, for every workspace in it.

- **Chat** — whether this installation has a chat at all. Off takes the tab
  away and refuses new messages; conversations already had are kept.
- **Files in chats** — whether messages may carry attachments. Off takes the
  button away; what has already been uploaded stays where it is. It governs the
  files put on an issue as well, whatever the label says, and both use the same
  storage and the same size limit.

Below each switch, in grey, is what the operator set in the configuration file:
where attachments are written, what storage they use, and how large one file may
be. Those are read-only here — a filesystem path is not something to hand a
browser the ability to change.

The configuration file is the floor. An administrator can turn something off
from this screen, but not back on where the file has said no.

## Monitoring

![Monitoring: the health of the service and everything it needs to be up](/screens/monitoring.png)

What is answering and what is not: the server, the database, Temporal, and the
connections workspaces depend on. A run's underlying Temporal workflow can be
opened from here and from the run page.

## Doctor

![Doctor: whether this installation is configured correctly](/screens/doctor.png)

Monitoring asks whether the server can reach the things it needs. Doctor asks
the other question: **is this installation configured correctly?**

They are not the same, and the gap between them is where the worst faults live.
A secret key that was never set is only validated on first use, so the server
starts, every dependency answers and monitoring is entirely green — while every
credential written hours later fails. Doctor checks the key, the credentials
already stored under it, how sign-in is configured, and the schema version, and
says which of them is wrong rather than that something is.

## Plugins

![The plugins loaded into this installation](/screens/plugins.png)

JavaScript loaded into the sandbox to give workflows functions the platform does
not ship. A plugin can be uploaded, fetched from a URL, or written from the
starter this server generates — in JavaScript or TypeScript — and downloaded
again later as whichever of the two it was written in.

A plugin's key is its identity, not its filename: loading the same key again
replaces what is there.

A plugin says what it has to be told before it can work, and each workspace
answers separately: the same plugin points at two different projects for two
different teams. The declaration is read off the plugin when it is loaded and
shown here; the answers are set on each workspace's own Plugins page, either by
typing a value or by pointing at one of that workspace's variables.

A workspace that has not answered something a plugin needs is marked on that
page, in the list and against the parameter itself, and a run that reaches one
of the plugin's functions stops saying which parameter is missing. A parameter
the plugin declared as a secret cannot be typed in at all - the only way to
answer one is a variable, which is encrypted at rest and never shown back.

What a plugin can reach is exactly that list and nothing else. There is no way
for one to ask the server for anything it was not given, which is why declaring
parameters is also the answer to "what data does this plugin see?".

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
