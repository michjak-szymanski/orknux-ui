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

### Authentication

Webhook authentication is chosen per trigger.

- **None** — the endpoint is open. Anybody who knows the path can fire it.
- **Function** — a workspace function is called with the request, and must
  return a boolean. `true` fires the trigger; anything else is answered `401`,
  and the refusal is written to the trigger's history.

## History

Every trigger keeps a history: when it fired, what set it off, and what came of
it. It is a table, the same shape as the audit log, and it records failures as
well as successes — a request that failed authentication, a payload that did not
match the contract, or an error raised while the trigger ran. If a workflow is
not running when you expect it to, this is the page that says why.
