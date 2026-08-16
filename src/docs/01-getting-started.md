# Getting started

Orknux runs work that would otherwise be somebody's job to remember: an event
arrives, a workflow decides what to do about it, and a record of what happened
is kept. This page is the short version of everything the rest of these pages
go into.

## Signing in

![The sign-in screen](/screens/sign-in.png)

Accounts come from your organisation's provider, not from Orknux — there is no
sign-up form, and nobody is created here. Depending on how the installation is
configured, that is either a directory you sign in to with the same username and
password you use elsewhere, or a single sign-on provider that answers for you.

What you can see afterwards depends on the **roles** your provider's groups and
claims are mapped to.

## Workspaces

![The workspace, with its catalogue down the left and the workflows it holds](/screens/workflows.png)

A workspace is where the work lives. Everything with a name — workflows,
agents, models, variables, connections — belongs to exactly one workspace, and
nothing leaks between them.

Which workspaces you see is decided by the roles you hold. Administrators see
all of them and are the only ones who can create one.

The workspace picker sits at the top of the sidebar. The tab bar above it moves
between the three parts of the product:

- **Workspace** — everything a workspace owns.
- **Chat** — talking to a model, with your workspace's agents and tools within
  reach. Can be switched off for an installation.
- **Admin** — the organisation: its workspaces, its connections, and what this
  installation allows. Administrators only.

## Finding things

The box in the middle of the top bar is the command palette. Open it with your
Go To shortcut — `Ctrl`/`Cmd` + `K` unless you have changed it in Preferences —
type a few letters of any page, and press Enter. It knows every page in the
current workspace as well as the admin ones.

## Your first workflow

1. Open **Workflows** in a workspace and create one.
2. Give it a **trigger** — what starts it. A schedule, a message on a
   connection, or a webhook.
3. Add nodes to the canvas and join them: **actions** do things, **conditions**
   choose between paths, **agents** ask a model, **objects** assemble a shape
   for the next node to read.
4. Watch the **Things to fix** panel. It refreshes as you edit and lists what is
   still missing — an unset parameter, a node with nothing feeding it.
5. Enable the workflow. Every run then shows up under **Executions**, with the
   graph, the steps, and what each one passed on.
