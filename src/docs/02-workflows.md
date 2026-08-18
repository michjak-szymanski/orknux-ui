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
- **Icons** can be given to any node. A node made from a definition inherits
  the definition's icon.
- Nodes **resize**, and long text wraps rather than spilling.

### Working in it

- **Undo** and **redo** step back and forward through what you have drawn:
  `Ctrl`+`Z` and `Ctrl`+`Shift`+`Z`, with `Ctrl`+`Y` heard for redo as well.
  They are ignored while a caret is in a text box, where the browser's own undo
  is the right one.
- **Save** is `Ctrl`+`S`, and the button says which key it is listening for.
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

Running one again is a fresh run on the same input, and it is a person pressing
a button: it is recorded as manual, and it uses the draft rather than the graph
that ran the first time. That is the point of it - something failed, you changed
the graph, and you want the same event put through what you have now.

Runs are carried out by Temporal, so a run that fails part-way is retried
according to the workflow's settings rather than silently lost. Administrators
can open the underlying Temporal workflow from the run page and from Monitoring.
