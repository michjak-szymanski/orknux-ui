# Workflows

A workflow is a graph: a trigger at the top, nodes underneath it, and edges
saying what runs after what. It runs when its trigger fires, and only while it
is enabled.

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

## Running

![The executions list: every run, how it ended, how long it took and what started it](/screens/executions.png)

Enable the workflow to let its trigger start it. Each run appears in
**Executions** with:

- the **Run** column, which opens that run — its graph, its steps, timings, and
  what each step passed on;
- the **Workflow** column, which opens the definition it ran from;
- the execution id, for matching against logs.

Runs are carried out by Temporal, so a run that fails part-way is retried
according to the workflow's settings rather than silently lost. Administrators
can open the underlying Temporal workflow from the run page and from Monitoring.
