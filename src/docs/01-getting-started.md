# Getting started

Orknux runs work that would otherwise be somebody's job to remember: an event
arrives, a workflow decides what to do about it, and a record of what happened
is kept. This page is the short version of everything the rest of these pages
go into.

## Running it

If somebody has already put an Orknux in front of you, skip this.

`deploy/compose.yaml` in the server repository is a whole installation in one
file: the server, the interface, Postgres, a directory to sign in against, and
Temporal, from the published images. Three lines:

```
curl -O https://raw.githubusercontent.com/michjak-szymanski/orknux-server/main/deploy/compose.yaml
export ORKNUX_SECRET_KEY="$(openssl rand -base64 32)"
docker compose up -d
```

Then open **http://localhost:8080** and sign in as `alice` / `password`. That
one port is the only one published: the interface forwards `/api`, `/graphql`
and `/mcp` to the server, so the browser only ever talks to one address. The
first start takes a minute or two while Temporal and the server apply their
schemas.

**`ORKNUX_SECRET_KEY` has no default, and the stack refuses to start without
one.** That refusal is deliberate. Every credential the server is trusted with -
a model provider key, a Slack token, an MCP secret - is encrypted with that key,
so changing it or losing it leaves all of them unreadable, with nothing to do
but enter them again by hand. It is the thing to get right before you save your
first provider key rather than after, and it belongs wherever you already keep
secrets, backed up somewhere other than the database it protects.

That file runs Postgres, which is what a deployment should use. An installation
for one person or one team can run on a SQLite file instead and drop the
container entirely; see **The database** under Administration for what that
costs.

If you only want to look at Orknux, there is a smaller way in still.
**`orknux-one`** is the server, the interface and a SQLite file in one
container, with nothing to supply and nothing to copy:

```
docker run -d --name orknux -p 8080:8080 -v orknux-data:/var/lib/orknux orknux/orknux-one
```

It writes its own encryption key on the first start and prints an
administrator's password in the log. Use it to try Orknux, to develop against
and to show somebody - and not for work whose runs matter, because there is no
Temporal in it: nothing is retried, nothing resumes, and a restart in the middle
of a run strands that run. It has no directory and no single sign-on either.
This manual describes the product rather than that container, so the pages that
follow are true of it except where they are about those things; `deploy/README.md`
sets out the whole trade.

The `compose.yaml` at the *root* of the repository is a different file and not a
smaller version of this one. It brings up only the dependencies, for working on
Orknux rather than for running it.

`deploy/README.md`, beside the file, is the full account: what each service is
there for, what to change before the installation holds anything real, and what
to look at when it does not come up.

## Signing in

![The sign-in screen](/screens/sign-in.png)

Accounts come from your organisation's provider - there is no sign-up form, and
nobody signs themselves up. Depending on how the installation is configured,
that is either a directory you sign in to with the same username and password
you use elsewhere, or a single sign-on provider that answers for you. An
administrator can also make an account here for somebody the provider does not
know; see Administration.

**Reset**, beside the password box, is for a forgotten password on one of those
locally made accounts. It sends a link to the address on the account; the link
works once and stops working an hour after it was sent, and using it signs that
account out everywhere. A directory or single sign-on password belongs to the
provider, and there is nothing here to reset.

Wrong passwords are counted. Enough of them in a row bring a pause that grows
before each further try, and you are told how long to leave it. Nothing locks -
the pause always ends, and getting it right clears the count - because a lockout
would let anybody shut a colleague out by guessing at their name badly on
purpose.

What you can see afterwards depends on the **roles** your provider's groups and
claims are mapped to.

## Workspaces

![The workspace, with its catalogue down the left and the workflows it holds](/screens/workflows.png)

A workspace is where the work lives. Everything with a name — workflows,
agents, models, variables, connections — belongs to exactly one workspace, and
nothing leaks between them.

Which workspaces you see is decided by the roles you hold. Administrators see
all of them and are the only ones who can create one.

A workspace you cannot see is one you cannot address either. Anything named by
an id your roles do not reach answers exactly as an id nobody ever used does:
there is no such thing. That holds whether you were reading it or changing it.
It is a strange answer the first time you meet it, and it is the right one - the
alternative tells anybody with an account roughly how much this installation
holds and what of, one number at a time.

The top bar carries the whole of it. On the left, beside the mark, are the four
parts of the product you work inside. Each one opens a menu of its own down the
left-hand side:

- **AI** — what a model is given to work with: agents, models, tools, skills,
  memory and the sessions its agents have kept.
- **Workflow** — the work itself and what it is made of: executions, workflows,
  actions, functions, triggers, conditions and objects.
- **Workspace** — what the whole of it is set up with: variables, plugins,
  issues, the audit log, integrations and settings.
- **Chat** — talking to a model, with your workspace's agents and tools within
  reach. Can be switched off for an installation.

A page belongs to exactly one of them, so opening a link somebody sent you
lights the part it lives in and puts that menu beside it. Nothing changed
address when the sections were split up: a bookmark saved before still opens the
same page.

On the right, in front of your account: the **workspace picker**, then **Docs**,
then **Admin** - the organisation, its workspaces, its connections and what this
installation allows, offered only to administrators - and the notification bell.

The picker is there on every screen, including the docs and the admin section,
which are exactly the places somebody wants to get back to a workspace from.
Changing it keeps you where you are when that means anything: a list stays the
same list in the workspace you moved to, while a page about one particular thing
falls back to its list, since issue #4 somewhere else is a different issue or
none at all.

The menu down the left **collapses** to its icons, by the round handle on the
edge of the column. It stays collapsed until you open it again, on every page
and in every workspace, because the pages that most need the width - a graph, a
long issue - are the ones you stay on.

Each workspace also keeps a tracker of what is wrong with its work; see Issues.
The bell beside your name is where anything that concerns you on one of them
turns up, whichever workspace it happened in.

## Finding things

![The command palette, open on a letter: pages, and the things the workspace
holds, in one list](/screens/command-palette.png)

The box in the middle of the top bar is the command palette. Open it with your
Search shortcut — `Ctrl`+`Q` unless you have changed it in Preferences — type a
few letters, and press Enter.

It knows every page in the current workspace and the admin ones, and it knows
what the workspace *holds*: a trigger, a function, an agent, a variable and the
catalog it is in are all reachable by name, and so is an open issue, by its
title or by its number. Each row says what kind of thing it is, so two things
with similar names can be told apart before you press Enter.

It also holds a few things to *start* — **Create issue**, **Create function**,
**Create condition** — each marked with a plus, and each offered before you
type anything at all. That is what the box is called after: it searches, and it
creates.

## Your first workflow

1. Open **Workflows** in a workspace and create one.
2. Give it a **trigger** — what starts it. A schedule, a message on a
   connection, or a webhook.
3. Add nodes to the canvas and join them: **actions** do things, **conditions**
   choose between paths, **agents** ask a model, **objects** assemble a shape
   for the next node to read.
4. Watch the **Things to fix** panel. It refreshes as you edit and lists what is
   still missing — an unset parameter, a node with nothing feeding it.
5. **Publish** it. Publishing takes a copy of the graph, and that copy is what a
   trigger runs; a workflow nobody has published has nothing to run.
6. Enable the workflow. Every run then shows up under **Executions**, with the
   graph, the steps, and what each one passed on.

## Your own preferences

![Preferences: what belongs to you rather than to any workspace](/screens/preferences.png)

Preferences belong to the person signed in rather than to any workspace —
the theme among them — so they follow you into every workspace you can see.

Every keystroke this application listens for is set here too: **Search**,
**Save**, **Format**, **Turn Node**, **Undo**, **Redo** and **Duplicate Node**.
Each is changed by
pressing the keys you want rather than by picking from a list, because which
keys are free depends on your browser and your machine and not on this
application. All of them but Turn Node have to carry a modifier: a bare letter
would fire while somebody was typing, and turning a node is only ever heard on
the canvas.
