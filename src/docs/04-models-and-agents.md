# Models and agents

## Providers and models

![Providers with their endpoints and status, and the models reached through them](/screens/models.png)

A **provider** is somewhere models are reached: an OpenAI-compatible endpoint,
whether that is OpenAI itself, a local llama.cpp or vLLM server, or a proxy of
your own. A **model** is one model on one provider.

Add a model from **Models** in a workspace. The dialog asks for the type first,
because the rest of the form depends on it:

- **Chat** — the models a chat or an agent can talk to. Adding one usually
  discovers what the provider offers and lets you pick from the list.
- **Transcription** — speech to text. Provider is an OpenAI-compatible API,
  given as a server URL and an optional key. No model discovery is attempted:
  a transcription endpoint is not required to have a model list.

Transcription models never appear in the chat model dropdown. They are for
hearing, not for answering.

The model list shows each model's type, its provider, and what it has been used
for. Usage over time is charted on the same page.

![A provider on its own page: where it is, how it authenticates, and what it
said when it was last asked](/screens/model-provider.png)

A provider's page is also where it is tested. The status is the answer to the
last check, not a guess: a provider with no credential fails the check rather
than waiting to fail at the first question.

## Workspace models

Two model choices belong to the workspace rather than to a conversation:

- the **companion model**, used for the small jobs nobody should have to pick a
  model for — naming a chat, for instance. Clearing it switches those jobs off
  rather than falling back to something you did not ask for.
- the **speech-to-text model**, used by the microphone in chat. Only a
  transcription model will do.

Both are set in workspace settings, by anyone who can see the workspace.

## Agents

![The workspace's agents](/screens/agents.png)

An agent is a model with a brief: instructions, and access to the workspace's
skills, tools and memory. Agents can be used from chat and as a node in a
workflow, where their input comes from the parameters the node is given.

- **Skills** are written instructions the agent can draw on, grouped into
  catalogs.
- **Tools** are things the agent can call, including MCP servers connected to
  the workspace.
- **Memory** is what a workspace has written down for its agents to read.

![One agent's settings: the model it answers on, its brief, and the catalogs and
tools it was granted](/screens/agent-settings.png)

## Skills and tools

![The workspace's skills, in the catalogs they are grouped into](/screens/skills.png)

A **skill** is written instruction — how to answer in a thread, when to escalate
somebody — kept as markdown that opens with a frontmatter header naming it. That
header is what an agent reads to decide whether the skill applies before it
reads the rest.

![The skill editor](/screens/skill-editor.png)

Agents are granted whole **catalogs** rather than single skills, so adding a
skill to a catalog gives it to every agent already holding that catalog.

![The workspace's tools](/screens/tools.png)

A **tool** is JavaScript an agent may call while it answers. Unlike a function,
which a workflow node calls with arguments it mapped, a tool is offered to the
model and called if the model decides to.

![The tool editor](/screens/tool-editor.png)

## Letting an agent drive orknux

An agent's settings carry one switch that is not an MCP server: **Orknux**. It
lets the agent ask this installation about itself — its workspace's workflows,
runs and agents — and, unlike the AI button, to start a workflow, which really
runs it.

It is deliberately not listed among the workspace's MCP servers. Those are
addresses somebody registered, with a credential; this is the application the
agent is already inside, so there is nothing to register and nothing to point
at. Off for every agent until somebody turns it on, and turning it on is
recorded in the audit log.

An agent that starts a workflow which asks an agent is a loop nothing here
breaks, so grant it where that is not a risk.

## Driving orknux from outside

The same tools are offered over **MCP**, for an agent that runs somewhere else —
on a laptop, in an editor, in another product. One server per workspace:

```
http://your-orknux/mcp/{workspaceId}
```

It speaks JSON-RPC over HTTP POST, and it authenticates the way everything else
here does: sign in first (`POST /api/session`) and send the session with the
request, or send an access token as `Authorization: Bearer orkx_…`, which is the
usual way in for something with no browser to keep a cookie in. Tokens are made
on a user's page; see Administration. What you may see through it is what you may
see in this interface — the same check, on the same workspace — and what you may
change is what you could already change by hand. Being reachable by an agent
grants nothing extra.

Everything with a page of its own comes back with its address, so an agent that
mentions a run can link you to it.

The workspace's own MCP servers, listed under Integrations, are a different
thing entirely: those are servers somebody registered for agents to call *out*
to. This is the way *in*.

### The tracker, over MCP

The workspace's issues are offered here too: list them, filtered by assignee, by
state, by labels or by a search; read one with its comments; comment on it; move
it between open and closed; and change its title, description or labels. An issue
is addressed by the number people say, so #4 to an assistant is #4 on the page.

### Waiting to be told

One tool answers slowly on purpose. `orknux_news` gives whoever is asking what
has happened on the issues that concern them since they last read: assigned,
closed, reopened, commented on, or their name written somewhere. It also takes a
number of seconds to **wait** for. Given one, it holds the call open until
something happens or the time runs out, up to five minutes.

That is what lets an assistant be told rather than have to keep asking. Reading
marks it read and no place-marker comes back, so something that forgets
everything between one session and the next neither repeats a week of events nor
silently skips them.

An issue can be assigned to an agent as easily as to a person, and the same tool
takes the agent's name, so an agent can be asked to read what it has been sent
rather than what its owner has.

## Integrations

![The workspace's connections and the MCP servers its agents may
reach](/screens/integrations.png)

**Integrations** holds the workspace's connections — Slack, MCP servers, HTTP
endpoints. A connection made in the admin section can be marked as the default
for new workspaces; that setting lives on the connection's own page.
