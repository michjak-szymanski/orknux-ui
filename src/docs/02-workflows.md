# Workflows

A workflow is a graph: a trigger at the top, nodes underneath it, and edges
saying what runs after what. It runs when its trigger fires, and only while it
is enabled. What it runs then is the copy that was published, which is not
always the graph you are looking at; see Draft and published, below.

## The list

**Workflows**, under **Workflow** in the menu down the left, is every workflow
the workspace has, with when each of them last ran and when it is next due.

**Sort** names the field it sorts on — **Name**, **Last run** or **Switched
on** — with a single arrow beside it for the direction. It starts at A to Z
rather than at the newest, because a column of names is read that way round. The
ordering is the server's, over the whole list rather than over the rows on
screen: sorting ten of a hundred looks like it worked until the row somebody
wanted turns out to be on page three. Next Run is a column and deliberately not
something to sort on — it is the soonest of however many cron expressions the
workflow's triggers carry, worked out one workflow at a time, and nothing has
ever written it down to order by.

The line at the bottom says how many there are and how many are shown, and how
many at a time sits in it: 10, 25, 50 or 100. The order is in the address, so
"the ones nobody has run" is a link rather than a paragraph of instructions;
how many at a time is remembered in your browser instead, because it says how
much of a screen you have rather than what you are looking at.

## The editor

![The workflow editor: the graph on the canvas, what can be added along the top, and the selected node's settings on the right](/screens/editor.png)

The canvas is the workflow. Drag nodes to arrange them, drag from a node's
handle to another node to join them, and select a node to open its panel on the
right. An edge is dragged by either of its ends: take hold of the arrow and drop
it on another node's input to send it somewhere else, or take hold of the other
end to change where it leaves from. A line dropped on nothing goes back where it
was, and one dropped on wiring the graph already has is left alone.

Lines are routed for you, and where two nodes sit awkwardly a line can run
through whatever is between them. A line is pulled through **points**: a small
handle at its middle, or its label where it has one. Drag a point and the line
bends to follow it.

A line takes as many points as it needs, because a line that has to get round
two things cannot be bent through one. **Double-click the line** to put a point
where you clicked — it goes into the gap you aimed at, so a line already bent
twice can be bent again between those two — and **double-click a point** to take
it off. Taking the last one off leaves the line running where it was routed.

A point that has focus can be worked from the keyboard: the arrow keys nudge it,
Delete or Escape takes it off, and `+` puts another one after it. Delete there
means this point rather than this line, which is what the canvas would otherwise
have done with it.

Where a line has been pulled to is remembered by your browser and nowhere else.
It is an arrangement of your own view: a colleague opening the same workflow
sees the lines routed as they were drawn for them, and it does not travel with
an export. A line deleted from the graph forgets its points, so drawing it
again starts it straight.

- **Things to fix** lists what is not yet valid, and refreshes as you edit.
  A workflow with entries here can be saved but should not be trusted to run.
- **Parameter connections** are drawn as labelled edges: where a node reads a
  value from an earlier one, the edge says which fields travel along it.
- **Input and output dots** are told apart by shape: an input is hollow and an
  output is filled, a socket and a plug. A turned node moves where each dot
  sits, so where it sits cannot be what tells you which it is. Shape rather than
  colour, because colour is already carrying which of a condition's two ways out
  is which.
- **Icons** can be given to any node. A node made from a definition inherits
  the definition's icon.
- Nodes **resize**, and long text wraps rather than spilling.

### Working in it

- **Undo** and **redo** step back and forward through what you have drawn:
  `Ctrl`+`Z` and `Ctrl`+`Shift`+`Z`, with `Ctrl`+`Y` heard for redo as well.
  They are ignored while a caret is in a text box, where the browser's own undo
  is the right one.
- **Save** is `Ctrl`+`S`, and the button says which key it is listening for.
- **Run** stands between Save and Publish and starts the workflow as it is on
  screen, saving first if there is anything unsaved, and then opening the new
  run's page. That page is where the steps, their inputs and the log are, which
  is what pressing Run was for; going back to the list to hunt for the newest
  row is a detour past it. A start that is refused - a graph with no nodes has
  nothing to run - is said beside the workflow's name and leaves you in the
  editor, because there is no run at the other end to go and look at.
- A node can be **turned**, three ways that are one act: the **Turn** button, a
  rotate arrow standing just off the selected node's top-right corner,
  **Facing** in its panel, or `R` on the canvas. The button is there because
  turning is something somebody does four times in a row, and a panel on the
  far side of the screen is a long way to go for that. It moves where the lines
  join the node - left to right, top to bottom, right to left, bottom to top -
  and changes nothing about what runs. A long chain simply reads better down a
  screen than off the side of one. Each node is turned on its own, so a graph
  can bend where it needs to.
- A node can be **copied**: **Duplicate** in the toolbar, or `Ctrl`+`D` on the
  canvas. The copy points at the same action, trigger, condition, agent or
  object - two nodes running one action is the ordinary case - and carries its
  description, its icon, which way it faces and what it passes on. It is not
  wired to anything: a copy joined to everything the original was joined to is
  rarely the graph anybody wanted, and for a condition it is not even clear
  which of the two answers the copy's lines should leave by. It is named after
  what it was copied from - `Fetch the order copy`, then `copy 2` - so no two
  nodes read identically, and it lands a little below and to the right rather
  than under the original.
- Pickers are **typed into** rather than scrolled. Agents, triggers, actions,
  objects, conditions, functions and connections all narrow as you type, with
  the arrows to move and Enter to take.
- Beside each picker is **New**, which opens the builder in a panel down the
  left rather than over the canvas: what you are making and the graph you are
  making it for stay on screen together. A trigger, an action, a condition, an
  object and an agent can each be made this way, and what you make is chosen
  into the node as soon as it exists.
- **The way out**, the mark beside the picker on a node that already points at
  something, opens it in that same panel — a trigger, an action, a condition
  and an agent alike. Reading a node is a question about the graph, and
  answering it by taking the graph off the screen is a poor answer. An object
  is the exception and opens its own page, because its fields are given there
  and a panel has nowhere to put them. It is still a link, so `Ctrl`, `Cmd`,
  `Shift` or the middle button opens the definition's own page in a tab of its
  own.
- Anything that navigates is a **link**. Clicking one saves the graph and goes;
  `Ctrl`, `Cmd`, `Shift` or the middle button opens it in a new tab and leaves
  what you were doing where it was.

![The builder, open down the left: what is being made, and the graph it is being
made for, on screen together](/screens/node-builder.png)

Every one of those keystrokes is yours to change, in Preferences.

## Kinds of node

| Node | What it does |
| --- | --- |
| Action | Calls something outside: an HTTP request, a message on a connection. |
| Condition | Chooses which edge to follow, on an expression over what it was given. |
| Agent | Asks a model, with the workspace's skills and tools available to it. |
| Function | Runs JavaScript on the values handed to it. |
| Object | Assembles a named shape, field by field, for later nodes to read. |
| Session | Names the conversation the agent it leads to keeps, so what is said outlives the run. |

Each kind can be **inline** — defined in this workflow only — or made from a
**definition** in the workspace catalogue, which several workflows can share.
Editing the definition changes every workflow using it.

A session node is the one kind nothing may lead *into*, and it leads only to an
agent. It carries two parameters: **sessionKey**, which is what the conversation
is called, and **sessionKeyPrefix**, which is optional and is what it is filed
under. Both are values or references like any other parameter, so a key read
from the event — the ticket a mention names, the customer an order belongs to —
gives each of them a conversation of its own, and a run a week later that
computes the same key carries on where the last one left off. An agent with no
session node beside it answers and forgets. What is kept is on the workspace's
Sessions page, described under AI.

## The catalogue

A definition made once and used by several workflows lives in the workspace's
catalogue, listed under **Workflow** in the menu down the left.

![The action catalogue: what each action calls, and what it hands
back](/screens/actions.png)

**Actions** are the calls out — an HTTP request, a message on a connection, a
function, a wait. Each declares its inputs and outputs, and those are what a
node pointing at it is offered to map.

![Conditions: the question each one asks, and what it asks it
of](/screens/conditions.png)

**Conditions** are the questions: a property, a check, and the values to check
against. A condition node follows one edge or the other on the answer.

![A condition on its own page: what it asks, and what it asks it
of](/screens/condition.png)

A condition is a **page**, at `/conditions/<id>`, and a new one is written at
`/conditions/new`. That matters because an address can be kept: a half-written
condition survives a reload, can be sent to somebody, and opens in a tab of its
own from the list.

A condition can ask a **function** instead of a property, and then **Open
definition** sits beside the picker and opens that function in a new tab rather
than in this one. The form you are in is holding edits nobody has saved, and in
the workflow editor the same form is a panel beside the graph - a jump in the
same tab would take both off screen.

It is the same form wherever it is: this page, the editor's node panel, and the
trigger and action dialogs all draw it, so there is one thing to learn rather
than two that drift apart.

![The workspace's functions](/screens/functions.png)

**Functions** are JavaScript called from an action node with the arguments that
node maps to them.

![The function editor: the source, the parameters it takes, and what it
returns](/screens/function-editor.png)

A function is written in TypeScript and stored together with the JavaScript
compiled from it, so what runs is always what was written. Its parameters are
declared rather than guessed at, and the workspace variables it may read are
granted one by one — naming a secret is not enough to reach it.

![The objects a workspace has declared](/screens/objects.png)

**Objects** are the shapes that travel between nodes: named fields with types,
which an object node fills in and later nodes read field by field.

## Sending mail

A workflow can send email, and it takes two things: a connection that knows the
mail server, and a **Send Email** action that says what to send.

The connection is made under the workspace's Integrations, as **Email (SMTP)**.
It holds the host, the **Security** it speaks (STARTTLS, TLS, or none at all),
the port, and the **From Address** every mail sent through it comes from. A
login is optional: leave the username empty and it sends without authenticating.
The password is encrypted where it is stored, like every other credential here.
**Test Connection** opens a session and authenticates without sending anything,
so a wrong password is found before a workflow finds it.

The action takes **To**, **Subject**, **Body**, **Cc** and **Reply To**. To and
Cc each take several addresses, separated by commas or semicolons. The body is
plain text. What is written on the definition is where each node starts, and a
node may say something different, which is how one Send Email serves several
workflows.

The from-address is the connection's and is not a parameter: a provider that has
not authorised an address will refuse the message however good the password is.

Mail does not go through the installation's proxy rules. Those match an address
and cover outbound HTTP, and a mail server is named by host here rather than by
URL; see Administration.

A node with nothing to send - no recipients, or neither a subject nor a body -
is skipped rather than failed. A server that refuses the message fails the step,
and the failure says whether trying again is worth anything.

## Making an HTTP request

An HTTP action takes a method, a URL, a body and its **headers**, and the
headers are rows rather than a blob of JSON. Each row is a name, a switch
reading **Value** or **Reference**, and the thing itself.

**Value** is used exactly as written. **Reference** points the row at one of
this workspace's variables, which is read when the action runs and is shown
nowhere else - not back in this form, not in a run's record, not in the text of
an error. That is the reason the switch exists: a bearer token in a header used
to be pasted in as literal text, into a field that was never a credential field,
stored unencrypted, and readable by anyone who could open the action.

A variable a header names counts as in use, so deleting it is refused with the
action named - the same refusal a function's granted variable has always had.

Headers saved before this were a JSON blob and are left exactly as they are
until somebody saves the form. One that no longer reads as JSON is not silently
dropped: the form says so and keeps the text, because a request that quietly
sends no headers at all is worse than one that says it cannot.

## Values and references

Every parameter is either **written** or **referenced**. There are no
placeholders and no template syntax: what you type is used exactly as typed,
and a value that should come from somewhere else is chosen from the dropdown
of what is actually in scope.

References are paths — `trigger.threadTs`, `classify.output.label` — and the
picker only offers paths that exist at that point in the graph. This is why the
graph knows which fields travel along which edge, and why it can tell you before
you run it that a node is reading something nothing produces.

## Objects

An object node declares a shape and fills it in. Pick a shape from the
workspace's objects, or define the fields inline, and write or reference each
field. What comes out is one value under the node's output name, which the next
node can read field by field.

## When a node fails

A step that fails stops the run where it happened, which is the right thing when
nothing else was going to work either and the wrong thing when the failure was a
provider having a bad minute. So an action and an agent each carry two settings
of their own, in the node's panel. Nothing else does: a condition that does not
hold has answered, and an object node assembles what it was already handed.

**Retries** is how many goes in all rather than how many extra ones — one is the
single attempt every step has always had. Beside it, **initial wait** is what the
node leaves before its second attempt, and **multiplier** is what that wait is
multiplied by after each one: 1 repeats it, 2 doubles it, and 1.5 grows it
without doubling. A provider asking to be left alone is then left alone for
longer each time instead of being knocked on at the same interval.

Under the three is a line saying what they come to — *"up to 5 attempts over
about 2m"* — because the numbers compose in a way nobody works out in their head,
and that sentence is the one worth reading before saving.

Three more sit behind **Ceiling, jitter and budget**, and most nodes never need
any of them:

- **Maximum wait** stops the curve growing past a number you choose. It is only
  offered where the wait grows, since a wait that repeats cannot reach a ceiling.
  No single wait ever passes an hour whatever is set here.
- **Jitter** is how much of a wait may be taken off it at random — 0 is none,
  0.25 takes off up to a quarter, 1 draws each wait from anywhere up to what the
  curve asked for. It only ever shortens, so every other number stays the most
  that can happen. It is what stops a hundred runs that failed on one outage all
  coming back at the same instant, which is how a service that is struggling gets
  held down.
- **Budget** is a wall clock: *give up after this long whatever you are doing.*
  It is the only setting that can stop a node with attempts still in hand, and
  the only one that counts the work as well as the waiting — five attempts at a
  request that times out after a minute is five minutes of run that none of the
  waits above account for. A node that reaches it stops there, and says so in the
  run's log.

A node saved before any of this had a fixed wait, or that wait doubling, and
means exactly what it meant: doubling is a multiplier of 2, and a fixed wait is a
multiplier of 1.

A failure that is already settled never spends an attempt. A request refused for
what it said will be refused the same way in ten seconds; only the failures that
might come out differently — a timeout, a rate limit, a connection that dropped —
are asked again. Worth knowing before you turn retries on for an agent: **every
attempt is another call you are billed for**, and nothing here caps that.

**When it fails** is the other one. Off, a failure ends the run. On, the node
grows a second handle and the run carries on down whatever is wired to it, drawn
as a red **If fails** line beside the green **If works** one — so the graph says
what to do about a failure rather than the run simply stopping. Both ways out
can be renamed, the same as a condition's two, because the words beside the
handles are most of what makes a graph legible. The step records its failure
either way; what changes is whether anything happens next. Switching it back off
takes the failure line with it, since a line leaving by a door that is no longer
there could not be saved.

## What a component was

Every save of a function keeps the version it replaced, and so does every save
of a tool, a skill and an agent. **History** is that list: who saved it, when,
what it was called then if the name has changed since, and — when a row is
opened — the code or the prose it held. It sits in the panel beside what you are
editing for a function, a tool and a skill, and on the agent's own settings page.
**Restore this version** makes an older one current again.

The list is fetched when the panel is opened rather than with the component. A
tool edited fifty times in an afternoon is fifty copies of its source, and none
of that is wanted by somebody who came to change a description.

Restoring asks nothing first, deliberately. It keeps what it displaces exactly
as a save does, so the button that made the mistake is the button that takes it
back, and a dialog guarding an undoable act is a dialog people learn to dismiss.
What the editor was holding is read again afterwards, because a form left with
the version from before the restore would put that version straight back on its
next save.

A component's history begins with the first save after this arrived. Nothing
from before it was kept, there having been nothing keeping it.

How long these are kept is an administrator's setting, fourteen days unless it
has been changed; see Administration. A version is a whole copy of what the
component was rather than a note of what changed, which is why there is a number
on it at all.

A workflow has a history too, and it is versioned by publishing rather than by
saving; see **Draft and published**, below. **Variables are deliberately not
versioned.** Their values are encrypted, and keeping old ones would mean keeping
old secrets.

## Leaving with something unsaved

The function, tool, object and skill editors hold work the server has not been
told about, and all four used to lose it without a word: a link followed, a Back
press, and twenty minutes were gone.

They ask now. The question is only asked where something has actually changed —
what is on screen compared against what was loaded, rather than a flag set by
the first keystroke, so somebody who types a character and deletes it is not
stopped by it. It offers to save and go as well as to go anyway, because the
alternative is three gestures for the answer almost everybody wants. A save the
server refuses leaves you where you are with the reason on the page, since
leaving on a save that did not happen is exactly the loss the question exists to
prevent.

Closing the tab or reloading is the browser's own warning rather than this one.
Asking is the whole of what a page may do about it there.

## Deleting something in use

Deleting a definition that something still points at used to go through, and
what it left behind was a workflow that stopped working with nobody having
touched it. An action calling a function that is gone, an agent granted a tool
that no longer exists, a webhook checked against a shape nobody kept: each of
those fails later, somewhere else, and says nothing about the delete that caused
it.

The delete is refused instead, and the refusal names what is in the way — *Act
is used by the published workflow Answer, so it cannot be deleted*. It covers
actions, agents, conditions, functions and triggers, which are pointed at by an
id, and tools, skill catalogs and memory catalogs, which are granted to an agent
by name. A variable is refused for the same reason where an action's header
references it, which is new: a header pointing at a variable that is gone would
send an empty one. The way through is to change what is in the way first: take the node
off the graph, take the grant off the agent, and the delete goes through. It is
the rule a variable has always had.

**A published copy counts as well as the graph on the canvas.** A workflow
published months ago goes on calling the definitions its nodes name, so an
action whose node was taken off the canvas and never republished is exactly the
case that asking the drawing alone would have let through.

A grant is a name rather than an id, which is why a tool or a catalog is refused
even though nothing would have been left dangling by it. Nothing dangles, and
that is the problem: the agent's screen goes on listing a grant that now means
nothing, and a name can be bound again — make a tool called `weather` tomorrow
and every agent still holding that grant is handed whatever it now does, which
nobody chose.

Objects are the deliberate exception, and only half an exception. A function's
parameters, a tool's parameters and a node on a canvas name an object as an
annotation: losing it degrades what the editor draws above the code, on the
screen where somebody would fix it, and no run resolves it. A webhook's input
object is not an annotation but the contract every arriving request is checked
against, and a request that matches nothing is answered `404` — so an object a
webhook names is refused, and so is one another object's field points at.

## Draft and published

Saving and publishing are two different acts, and the difference decides what an
event actually runs.

- **Save** writes the draft. The draft is the graph on your screen, and editing
  a published workflow puts it back into draft.
- **Publish** takes a copy of the draft and stores it. That copy is what runs
  from then on, and it does not change again until it is published again.

What runs which:

| Started by | Runs |
| --- | --- |
| A trigger, a schedule, a webhook | the published copy |
| The API, and an assistant over MCP | the published copy |
| **Run**, pressed by a person | the draft |

Run uses the draft because that is what pressing it means: the graph on my
screen, now. Everything else uses the published copy, because a half-finished
edit saved at five o'clock should not be what answers a webhook at six.

A workflow that has **never been published has nothing to run**. Its trigger
fires, finds no published copy, and the firing is recorded as a failure in the
trigger's history. The badge beside the workflow's name in the editor says
**Draft** or **Published**, and **Publish** stays lit while there is anything
left to publish - a graph that was never published, or one edited since it was.

Publishing saves first, so what is published is always what is on screen. A
graph with no nodes in it is refused: *Add at least one node before publishing*.

**Every publication is kept.** The workflow's settings page lists them — when,
and by whom — marks the one that runs as **Live**, and **Restore** puts an older
one back into service. Restoring publishes that graph again rather than reviving
its row, so the list only ever grows and a rollback is something that happened
rather than a gap where something used to be; the row it adds says which
publication it copied.

Restoring does not touch the draft on the canvas. The draft is what somebody is
in the middle of, it is not versioned, and overwriting it would destroy
unpublished work with nothing to get it back from. What changes is what triggers
and schedules run — and the badge reads **Draft** while the two differ, rather
than pretending the canvas is what is running.

So a workflow's versions are its publications and not its saves: a draft is a
draft. The way back from a save you regret is still the editor's own
**Discard**, which puts the graph back as it was last saved.

How long publications are kept is the same administrator's setting that governs
the rest of the component history, and the live one is never swept whatever its
age — it is not history, it is what the workflow runs. See Administration.

**What is published is the graph, not the components it calls.** The copy holds
the nodes, what each one passes and the arrows between them - and, for the
function, agent or condition a node names, only which one. Editing that function
changes what the published workflow does the next time it runs. Nothing is
republished and the badge does not change, because the graph did not. If you need
a published workflow to keep behaving exactly as it does, take a copy of the
function rather than editing the one it calls.

## Running

![The executions list: every run, how it ended, how long it took and what started it](/screens/executions.png)

Enable the workflow to let its trigger start it. Each run appears in
**Executions** with:

- the **Run** column, which opens that run — its graph, its steps, timings, and
  what each step passed on;
- the **Workflow** column, which opens the definition it ran from;
- the execution id, for matching against logs.

Removing a workflow leaves every run of it here, and those runs say so. The name
stays on the row and on the run's own page, because it is the only record of
what ran, with **removed** beside it and nowhere to click: the editor would
answer *No workflow assignment with id 373*, which reads as a broken page rather
than as a workflow somebody deleted. The **Workflow** filter is built from the
workflows the runs actually name rather than from the ones the workspace still
lists, so those runs can be singled out instead of only scrolled past, and the
removed ones are marked **(removed)** in it — the filter gains the reach without
passing them off as live ones.

![One run: its summary, and the graph as it ran with each node marked by how it
went](/screens/execution-detail.png)

Opening a run shows the graph as it ran, each node carrying its own outcome and
timing, with the log underneath.

**Re-run** puts the same event through the workflow again. The input is carried
over, because a re-run starting from nothing is a run with nobody left to
answer, and the point of it is the thing that happened put through a graph you
have changed since. It is recorded as manual however the first run started,
since a person pressed it, and it runs the same kind of graph the first run did:
the draft for a run somebody started by hand, the published copy for one a
trigger started. Re-running what a webhook did against a half-finished edit
would not be re-running what the webhook did.

### Re-running from a step

A run that failed at the last node of six should not have to redo the five that
worked. For a node that sends a message, files a ticket or takes a payment,
doing it again is not a repeat but a second occurrence, so the safe thing to do
with a fixed node further down was often to do nothing at all.

Select a node on a finished run's page and its details offer
**Re-run from here**. The workflow starts again at that node, carrying what the
earlier run had produced by the time it reached it. The steps ahead of it are
not performed again: they appear in the new run as what they were, marked
**Carried over**, showing the earlier run's status and times. Leaving them blank
would have read as a run that never started, and a step saying it completed at
09:14 when the run began at 11:02 is a lie unless something on it says where it
came from.

It refuses, and says which, wherever starting there would mean guessing: a step
that never ran, a node the graph no longer has, a branch the earlier run did not
take, a condition whose answer was not recorded, a run that has not finished,
and a node edited since to read something the earlier run never produced. A run
that quietly reads blank where the earlier one read a channel is worse than
being told it cannot be started.

A run made by either kind of re-run says where it came from: a **Started from →
Run #N** row under the Run ID, linking back to the run it was started from.

Runs are carried out by Temporal, so a run that fails part-way is retried
according to the workflow's settings rather than silently lost. Administrators
can open the underlying Temporal workflow from the run page and from Monitoring.
