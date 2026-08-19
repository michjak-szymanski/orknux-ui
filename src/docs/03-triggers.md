# Triggers

A trigger is what starts a workflow. One workflow, one trigger. Triggers live
in the workspace catalogue, so the same trigger can start more than one
workflow.

## Kinds

![The triggers a workspace has defined](/screens/triggers.png)

- **Schedule** — a cron expression. Fires whether or not anybody is looking.
- **Connection** — something arriving on an integration: a Slack message in a
  channel the workspace is connected to.
- **Webhook** — an HTTP request to a path on this installation.
- **Manual** — somebody presses Run.

## Webhooks

A webhook trigger takes two things:

- a **URL**, which is a path on this installation. It must be relative —
  absolute URLs are refused, because the endpoint is served here and nowhere
  else.
- an **input object**, which is the contract. A request whose body does not
  match that shape is answered `404`, the same as a path nobody has claimed:
  an endpoint that only half exists is not an endpoint.

A body that is not JSON at all gets the same `404`, and so does a path whose
trigger is switched off. The point is that every no reads alike. The
endpoint is open to the internet by necessity - a build server cannot sign in -
so anything that answered a real path differently from an absent one would let a
stranger map out which paths this installation has armed, one request at a time.
Nothing is lost by it: the owner is told, in the trigger's own history, which of
those it actually was.

A body is capped at **1 MB**. Anything larger is refused with `413` before it is
read, and never reaches a trigger or its history - an anonymous caller should
not get to choose how much memory a request costs. `ORKNUX_WEBHOOK_MAX_BODY_SIZE`
raises it where a sender genuinely posts more.

### Authentication

Webhook authentication is chosen per trigger.

- **None** — the endpoint is open. Anybody who knows the path can fire it.
- **Function** — a workspace function is called with the request, and must
  return a boolean. `true` fires the trigger; anything else is answered `401`,
  and the refusal is written to the trigger's history.

The `401` is deliberately not folded into the `404` above. By the time it is
answered the caller has already sent something shaped like the contract, which
is not a thing found by guessing - and an integration whose credential has
expired is owed the difference between "you are not who you say" and "there is
nothing here".

## What a trigger runs

A trigger starts the workflow's **published** copy. Editing and saving a graph
does not change what fires tonight; publishing does. See Workflows.

A workflow that has never been published cannot be started by a trigger at all.
The firing still happens and is still recorded, saying it started none of the
workflows it was for - which is the thing to look for when a schedule appears to
be doing nothing.

## History

Every trigger keeps a history: when it fired, what set it off, and what came of
it. It is a table, the same shape as the audit log, and it records failures as
well as successes — a request that failed authentication, a payload that did not
match the contract, or an error raised while the trigger ran. If a workflow is
not running when you expect it to, this is the page that says why.
