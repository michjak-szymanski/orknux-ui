# Workflows

A workflow is a graph: a trigger at the top, nodes underneath it, and edges
saying what runs after what. It runs when its trigger fires, and only while it
is enabled. What it runs then is the copy that was published, which is not
always the graph you are looking at; see Draft and published, below.

## The editor

![The workflow editor: the graph on the canvas, what can be added along the top, and the selected node's settings on the right](/screens/editor.png)

The canvas is the workflow. Drag nodes to arrange them, drag from a node's
handle to another node to join them, and select a node to open its panel on the
right.

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
- A node can be **turned**: **Facing** in its panel, or `R` on the canvas. It
  moves where the lines join the node - left to right, top to bottom, right to
  left, bottom to top - and changes nothing about what runs. A long chain simply
  reads better down a screen than off the side of one. Each node is turned on
  its own, so a graph can bend where it needs to.
- Pickers are **typed into** rather than scrolled. Agents, triggers, actions,
  objects, conditions, functions and connections all narrow as you type, with
  the arrows to move and Enter to take.
- Beside each picker is **New**, which opens the builder in a panel down the
  left rather than over the canvas: what you are making and the graph you are
  making it for stay on screen together. A trigger, an action, a condition, an
  object and an agent can each be made this way, and what you make is chosen
  into the node as soon as it exists.
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

Each kind can be **inline** — defined in this workflow only — or made from a
**definition** in the workspace catalogue, which several workflows can share.
Editing the definition changes every workflow using it.

## The catalogue

A definition made once and used by several workflows lives in the workspace's
catalogue, down the left of every workspace page.

![The action catalogue: what each action calls, and what it hands
back](/screens/actions.png)

**Actions** are the calls out — an HTTP request, a message on a connection, a
function, a wait. Each declares its inputs and outputs, and those are what a
node pointing at it is offered to map.

![Conditions: the question each one asks, and what it asks it
of](/screens/conditions.png)

**Conditions** are the questions: a property, a check, and the values to check
against. A condition node follows one edge or the other on the answer.

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

A node with nothing to send - no recipients, or neither a subject nor a body -
is skipped rather than failed. A server that refuses the message fails the step,
and the failure says whether trying again is worth anything.

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

There is one published copy per workflow and publishing replaces it. There is no
history to browse and nothing to roll back to, so the way back to a graph you
preferred is the editor's own **Discard**, before it is published over.

## Running

![The executions list: every run, how it ended, how long it took and what started it](/screens/executions.png)

Enable the workflow to let its trigger start it. Each run appears in
**Executions** with:

- the **Run** column, which opens that run — its graph, its steps, timings, and
  what each step passed on;
- the **Workflow** column, which opens the definition it ran from;
- the execution id, for matching against logs.

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
