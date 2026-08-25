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

The model list shows each model's type, its provider, and whether it is switched
on. Usage over time is charted on the model's own page.

![A provider on its own page: where it is, how it authenticates, and what it
said when it was last asked](/screens/model-provider.png)

A provider has a **type** of its own, and there are five: **OpenAI**,
**Anthropic**, **Azure OpenAI**, **Ollama** and **Custom**. It decides how the
address is built and how the key is sent rather than which company answers, so
anything speaking the OpenAI shape at an address of its own is a **Custom**
provider. That is how Google's models are reached: the endpoint is
`https://generativelanguage.googleapis.com/v1beta/openai` with a Gemini key, and
the model list, chat, streaming and tool calls all behave. There is no Google
type. The one that used to be here sent the header Google's own API wants to
addresses that API does not have, so it could not work either way round;
providers stored as it became Custom providers on upgrade, endpoint and key
untouched.

**Ollama** takes the address the daemon listens on — `http://localhost:11434`,
which is where an operator naturally points it. Its OpenAI-compatible half lives
under `/v1` and the type adds that segment itself, so nobody has to know it, and
an endpoint already written `.../v1` is left as it is rather than doubled. That
segment used to be yours to remember: pointed at the bare port, a provider that
was perfectly correct reported *"No model list — check the endpoint"* about an
endpoint that was right.

The key a provider calls with is one of two things, and they are exclusive. It
is either the provider's own value, which is what nearly every provider has and
what has always happened here; or it is read from one of the workspace's
**variables** — a secret, not a value — that somebody else maintains. Every
provider type offers both.

The choice belongs to the field, not to the form. It sits beside the name of the
box it decides — **Value** or **Reference**, next to *API Key*,
or next to *Client Secret* where the authentication method makes it one — and
only the control belonging to the half chosen is drawn: a box to type into, or a
list of the workspace's secrets to pick from. That is on purpose and it is not
only tidiness. A form holding a key and a reference at once is a form somebody
fills in twice, and the pair is refused; and where something asks for two
secrets, as a Slack connection does with its bot token and its app token, each
one answers for itself rather than both being decided by a switch above them.

Reading a secret is worth it wherever one key is behind more than one provider.
Three providers on one OpenAI key meant typing it into each of them, and
rotating it meant remembering which ones; pointed at a secret instead, the
rotation is one edit on the **Variables** page. The secret is read at the moment
the provider is called, so a new value is in use immediately, with nothing to
save here.

The reference is held by identity rather than by name. Renaming the variable, or
moving it to another catalog, does not disturb the provider — and deleting it is
refused while any provider reads it, naming the ones that do. Only a secret will
do: a value is returned with the variable listing, and a key on a listing is a
key on a screen.

A provider reading a secret has no key of its own to reveal; reveal it from the
**Variables** page, where the reading is recorded against the secret.

A provider's page is also where it is tested. The status is the answer to the
last check, not a guess: a provider with no credential fails the check rather
than waiting to fail at the first question. Where the credential is a reference
that has come apart — a restore, or a database edited by hand — the provider
says so in words about the variable, on its row and on its page. That is
deliberate. A provider that cannot read its key fails a check exactly the way an
unreachable one does, and "check the endpoint" is the wrong afternoon.

A model's own page carries the two numbers that decide how much can be put in
front of it: its **Context Window**, which is how much it reads at once, and its
**Max Output**, which is the most it will write in one answer. Both are in
tokens, both are as the provider states them — nothing here asks the model — and
either can be left empty, which means not recorded rather than zero. They belong
to the model and not to the provider: one provider serves models whose windows
differ by an order of magnitude, so a single number kept beside the key would be
wrong for all but one of them. The window is what a session's memory is a share
of, so a model with none recorded leaves every agent on it with the built-in
allowance, and setting a share against it is refused until the number is there.

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

Everything this card names is defined somewhere else in the workspace, and every
one of them carries the mark that opens it: the model beside its picker, and a
catalog, a tool or an MCP server at the end of its own row. They open in a tab
of their own, so going to read what something is does not throw away a form that
has not been saved — and pressing one grants nothing.

![One agent's settings: its brief, the model it answers on, and the share of
that model's window its sessions are given](/screens/agent-settings.png)

## Skills and tools

![The workspace's skills, in the catalogs they are grouped into](/screens/skills.png)

A **skill** is written instruction — how to answer in a thread, when to escalate
somebody — kept as markdown that opens with a frontmatter header naming it. That
header is what an agent reads to decide whether the skill applies before it
reads the rest.

![The skill editor](/screens/skill-editor.png)

Agents are granted whole **catalogs** rather than single skills, so adding a
skill to a catalog gives it to every agent already holding that catalog. It is
also why a catalog an agent holds cannot be deleted, and the refusal names the
agents: a grant is a name, so nothing would have broken loudly — the agent would
simply have stopped knowing what the catalog held. A single skill carries no
grant and deletes as it always did. See *Deleting something in use* under
Workflows.

![The workspace's tools](/screens/tools.png)

A **tool** is JavaScript an agent may call while it answers. Unlike a function,
which a workflow node calls with arguments it mapped, a tool is offered to the
model and called if the model decides to. A tool an agent has been granted
cannot be deleted while the grant is there, for the reason a skill catalog
cannot.

A tool may **import** the workspace's functions, so logic a workflow already has
need not be written a second time for an agent to reach it. Its editor has the
same **Imports** and **Libraries** sections a function's has, and the code calls
them the same way — `imports.name(…)`. Nothing imports a tool: the direction is
one way, which is also why a tool cannot be caught in an import loop. It is set
out under Workflows, in *One function calling another*.

![The tool editor](/screens/tool-editor.png)

Beside Validate is a **wand**, and it is the quickest way to get help with what
is on the screen. It opens the quick chat with this tool already in hand, so a
question about the code does not have to describe the code first. What comes
back, when the answer is a change, is drawn against what the tool says now, with
Accept and Reject underneath it.

Accepting compiles the change in the browser and saves it, exactly as Save
does - what runs is the JavaScript stored beside the TypeScript it came from.
Nothing is written before that, and whichever you press is said back into the
conversation, so a change that will not compile can be answered rather than
silently dropped. The function editor's wand works the same way.

## Keeping what they were

An agent, a tool and a skill each keep the version they replaced every time they
are saved, and each has a **History** beside it: who saved it, when, what the
prompt or the code said then, and a button that puts it back. A tool's and a
skill's are in the panel beside the editor; an agent's is on its settings page,
under the form and above the way to delete it.

It is the same mechanism a function has, and it is set out under Workflows, in
*What a component was* — including how long a version is kept, which is an
administrator's to decide. It is worth most here: a prompt is written by trying
something, and without this the version that worked is only in somebody's memory
of what they typed.

## Memory

![What the workspace has written down, in the catalogs it keeps them in](/screens/memory.png)

A **memory** is a fact about this workspace that nobody should have to work out
twice — that the export runs at 02:00, that one customer asked never to be
phoned. It is the other half of a skill: a skill says how to work, a memory says
what is true here.

Memories live in **catalogs**, and agents are granted whole catalogs, exactly as
they are for skills. Adding a memory to a catalog gives it to every agent
already holding that catalog, and nothing has to be granted again.

An agent that holds at least one catalog is offered a tool called
`memory_search`, and only the catalogs it was granted are searched. So memory is
not pushed into every prompt: the agent asks when it thinks there is something
to know, the same way it reaches for any other tool.

A memory catalog an agent holds cannot be deleted either, and the refusal names
the agents holding it. Removing one memory from a catalog is not the same act
and is not refused: the catalog is what an agent is granted, so deleting one
takes the whole folder from everybody at once.

Each catalog has its own search, a filter by who wrote a memory and a sort, since
a catalog somebody has been adding to for a year is longer than a page.

## Sessions

![Every conversation this workspace's agents have kept, and how much was said in
each](/screens/sessions.png)

A **session** is one running conversation, kept apart from any single run. An
agent node answers and, ordinarily, forgets: the next run starts from nothing.
A session is what makes the second run remember the first.

Nothing on this page creates one, and there is no button that suggests
otherwise. A session appears the first time an agent node carrying a
**sessionKey** runs, and every later node that computes the same key writes into
the same conversation. Where that key is set is the **session node** in the
workflow editor, described under Workflows. The key is what a conversation is
called; the optional prefix is what it is filed under, and the two are shown
together as `prefix:key`. Keys belong to a workspace, so two workspaces both
keying on `standup` are keeping two separate conversations.

Because the key is usually computed rather than typed, one workflow keeps as
many conversations as it has things to talk about. The workflow these pictures
are taken from keys on the ticket a Slack mention names, so each ticket has a
thread of its own and a second question about the same ticket continues the
first.

![One session, narrowed to what was said: a question, the answer, and the same
ticket asked about again a run later](/screens/session.png)

Opening one shows the transcript, oldest first, a day at a time. Every line
names somebody and says what kind of line it is:

- **User** — what was put to the agent. On a workflow node that is the node's
  own name, since the node is who asked.
- **Agent** — what it answered.
- **Tool** — a call the model made, with the arguments it sent. Not what came
  back, which is why that line is often JSON and often long.
- **System** — a note from orknux itself, such as an agent that could not
  answer and why.

A long line is folded to a few lines with the full length on the button that
opens it, so a transcript with a thousand-line tool call in it is still
readable. The search, the four kind filters and the sort apply to the
transcript rather than to the list of sessions — and with none of the four
picked you are looking at every kind, not at nothing. The picture above has
User and Agent ticked, which is why the tool calls the agent made between the
two answers are not in it.

What the agent is handed on its next turn is the recent **User** and **Agent**
lines, not the whole transcript and not the tool calls: enough of the
conversation to carry on, without a fortnight of it arriving in one prompt.

How much of it is **Session Memory**, on the agent's own settings card. It is a
share of the context window of the model that agent uses — one number, from
which how many turns come back, how much of them, how much of what its tools
last returned and how much of any single result are all worked out. A share
rather than a count because the window is what the budget is spent out of, and
on the agent rather than on the installation because what a sensible budget is
depends on what that agent's tools give back: one reading whole files needs a
different allowance from one reading issue lists, and both may be pointed at the
same model.

Left at **Default** an agent has set no share of its own, and what it gets then
is decided one step further out. Moving the slider shows what the share works
out to against the model chosen just above it, in tokens — approximate ones:
they are counted in characters, the only unit every model agrees on, and
reported at four characters to the token. A share the model cannot give is
refused before it is saved, with a sentence naming that model and its numbers,
because the alternative is finding out on somebody's turn when the provider
refuses the request. Choose the model first: until there is one, there is no
window to take a share of and the slider says so by staying where it is. The
mark beside the picker opens that model's page in a tab of its own, which is
where its window is recorded and where a refusal about a window that is not
recorded is put right.

There are three steps, and they are consulted in this order: **the agent's own
share, then the workspace's default, then the built-in allowance.** An agent
that has answered for itself is never overruled by the two below it. One that
has not follows **Default Session Memory** on the workspace's settings page,
under Agents; and where the workspace has decided nothing either — which is what
every workspace does until somebody sets it — the fixed built-in allowance
applies, which is what every agent had before any of this could be set. So an
agent at Default says which of the two it landed on, under the slider: *the
workspace's 25%*, or *the built-in allowance*.

![Agents in workspace settings: the share every agent that has set none of its
own gets, and the model the figures under it are for](/screens/workspace-agents.png)

The workspace's default is set the same way, on the same track, and it is a
percentage for the same reason — except that here the argument is stronger,
because a workspace runs several models at once whose windows differ by an order
of magnitude, and a share is the only unit that can be stated once and mean
something against all of them. Which is also why it is judged on the bounds
alone: refusing a default because the smallest model in the workspace could not
give it would refuse a setting that is right for every other model in it, and
for agents that may never use that one. The refusals that name a model still
happen, against the model an agent actually uses, where its budget is worked
out. To see what the default would mean on any one of them, pick it under
**Worked Out Against** — the figures are that model's, and changing the picker
changes nothing that is saved.

**Continue in chat** is how a person joins a conversation the agents have been
having. The chat it opens is bound to this session and holds what was already
said, so what you tell it is written back here and the next run to read the key
finds it. It shows the tool calls too, drawn between the turns they were made
between and marked as calls rather than as anything anybody said — a chat is
opened to work out what an agent did, and an answer with no sign of the lookup
that produced it reads as the agent having simply known. The model is still not
given them, for the reason above: the calls are on the page, not in the prompt.
Calls made in the chat itself stay on this page, which is where the whole
conversation is. **Remove session** takes the conversation and every line in it, and
says so before it does; nothing makes a session again by hand, because a session
exists only because a run computed its key.

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

## Letting an agent run commands on a machine

An agent's settings carry a second switch of that kind: **Shells**. An agent
that has it can open a session on a machine an administrator has configured, run
commands in a working directory of its own on it, and close the session - which
destroys that directory and everything in it.

It is plural because from where the agent sits the question is "may I run a
command somewhere" rather than "may I run one on build-box-3". Which machine a
session lands on is decided when it opens, and the answer names it.

This is the one thing here that acts outside the application, and nothing in the
application decides which commands are safe. There is no denylist, deliberately:
reading a shell command and saying what it will do cannot be done reliably, and
a list that is nearly right is worse than none because it tells an administrator
they are protected. What contains this is the machine - point a shell at
something you are willing to lose, and give the account the least privilege that
is useful.

Every command an agent runs is written to the workspace's audit log under the
agent's own name, with what it exited with. Which machines there are, and
whether there are any at all, is an administrator's decision; see
Administration.

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

It can also **file** one. An assistant that finds something and can only describe
it in a conversation is one whose findings depend on somebody else writing them
down, which is the failure a tracker exists to prevent. A filed issue is under
the name of whoever is asking, and assigned to nobody: deciding who should look
at something is a judgement for a person, and an assistant that assigned its own
findings would be handing out work.

Instead it names **observers**: the people or agents who should hear about it,
who then get everything the reporter and the assignee get without being given
the work. Naming nobody tells the installation's administrators, because an
issue assigned to no one and watched by no one is a report written into an empty
room. A name it cannot find is refused and nothing is filed, so a report that
reached nobody is never mistaken for one that landed. See Issues.

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

A connection has a kind — **Slack**, **Email (SMTP)** or **HTTP endpoint** — and
the kind decides what it asks for.

**GitHub** and **Jira** used to be kinds of their own. Neither was ever
implemented: nothing called a GitHub or a Jira API through a connection, so both
were plain HTTP endpoints wearing a service's name, and configuring one gave you
something that tested green and could not be used. They are gone, and the
connections that were stored as one are HTTP endpoints now, with the same
address, the same credential and the same headers.

The **HTTP endpoint** kind was called **Webhook**. The word named the wrong end
of the wire: a webhook is a path *this* installation exposes for somebody else
to call, which is what a webhook *trigger* is, while a connection is a URL this
installation sends a request to. Whether the far end calls what it is listening
on a webhook is the far end's business and was never visible from here.

**Slack** takes a bot token beginning `xoxb-`, and optionally an app-level token
beginning `xapp-`. The second decides what the connection does: given one,
orknux listens for mentions and starts the triggers waiting on them; left empty,
the connection only sends. There used to be two Slack kinds to choose between,
"outgoing only" and "Socket Mode", and they were one integration wearing two
names — whichever was picked, it listened the moment it held an app-level token.
Connections stored as Socket Mode became Slack connections on upgrade, both
tokens where they were, and go on listening exactly as they did.

**A Slack action has one Target field, and it takes a channel or a person.** You
are not asked which: type a name, a handle, an address or an id, with or without
its `#` or `@`, and the send resolves it when the message goes. There used to be
a **Channel**/**User** dropdown beside the field, and nothing read it to send
anything — its only real job was choosing which of Slack's two lookups answered a
question about what you had typed, and those lookups are one now. What was left
was a control that changed nothing when the workflow ran, narrowed the list of
suggestions to half of what it could offer, and got the check wrong whenever it
disagreed with the name beside it. Actions saved with the old setting keep their
target names and go on sending to them.

**What you type is checked as you type it.** Under the field, orknux says whether
that connection can see what is there — the name Slack gave it back when it
could, a mark saying whether it turned out to be a channel or a person, and a
note when it could not.

The same answer appears in the workflow editor, under a node's **target**
parameter, since that is where a step names who it is writing to. Only on the
**Value** tab: a **Reference** is read out of the run when the run reaches it, so
there is nothing to look up beforehand.

**The same field offers what that connection can see.** A list opens under it
with the channels *and* the people that match what has been typed so far — one
list, each row marked with which of the two it is — narrowing as you type, driven
by the arrow keys, taken with Enter or a click, and put away with Escape. Taking
one fills the field in, and nothing more happens to it: the check goes quiet
afterwards, because a name Slack has just offered is not a name worth asking
Slack about.

It suggests and it never fences. Anything can still be typed whether or not the
list holds it, and plenty of correct things never will: an id pasted out of
somebody else's message, a colleague who joined a minute ago, a private channel
this bot was never invited to, an archived channel. Where only the first few of
what matched came back the list says so, because one that quietly left the rest
out would read as the whole of what exists; and where nothing can be looked up at
all it says why, rather than opening empty and looking like a Slack with nothing
in it.

There are three answers rather than two, and the third is the one that catches
people out. A bot token set up only to post carries no permission to look
anything up: `users:read` for people, `channels:read` for channels, and sending a
message needs neither. So a perfectly working connection can be unable to answer
the question at all, and that reads as **not checked** rather than as **not
found** — one wants a scope added to the Slack app, the other wants the name
corrected, and confusing them sends you to the wrong place. The same answer comes
back for a Slack larger than one lookup reads, because ruling a name out from a
list that was cut short would be worse than saying nothing.

Nothing here refuses a save. The field stays free text and the action stores
exactly what you typed, whatever the note says, because a private channel this
bot was never invited to, a colleague who joined a minute ago and an id pasted
out of somebody else's message all look identical to a typo from outside.

A Slack connection is asked neither for an address nor for how it authenticates.
There is one Slack Web API and a bot token is a bearer token, so both are
already settled and a field offering to change them would be showing you a
decision it is not making. Either token can be revealed from its own field
afterwards, which is the only way to tell which one is stored, and the audit log
says which of the two was revealed rather than only that something was.
