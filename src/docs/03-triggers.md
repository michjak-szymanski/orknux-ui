# Triggers

A trigger is what starts a workflow. One workflow, one trigger. Triggers live
in the workspace catalogue, so the same trigger can start more than one
workflow.

## Kinds

![The triggers a workspace has defined](/screens/triggers.png)

- **Schedule** — a cron expression. Fires whether or not anybody is looking.
  The form reads the expression back in English under the field as it is typed
  — and says instead that it cannot be parsed, or that it names a date which
  never comes round, which is the moment that warning is any use. The hint
  beside the field names the six positions, seconds first, in the order the
  server reads them.
- **Connection** — something arriving on an integration: a Slack message in a
  channel the workspace is connected to.
- **Webhook** — an HTTP request to a path on this installation.
- **Manual** — somebody presses Run.

## What a Slack connection trigger needs

A **Mention** arrives on any working bot token, because every Slack app that
can be mentioned is already subscribed to `app_mention` — it is what the app
was set up for. A **Message** and a **Reply** need two more things, and they
are configured in two different places on Slack's own site. Missing either one
gives the same symptom: the trigger is enabled, a workflow instances it, its
log is empty, and nothing ever happens.

**1. The event, under Event Subscriptions.** In api.slack.com → your app →
*Event Subscriptions* → **Subscribe to bot events**, add the events for the
conversations you want to hear:

| Conversation | Event |
| --- | --- |
| Public channels | `message.channels` |
| Private channels | `message.groups` |
| Direct messages | `message.im` |
| Group direct messages | `message.mpim` |

A new app has only `app_mention` in that list. **This is the one that catches
people out**, because adding the scope in the next step feels like it should be
enough and is not: a scope says what the token is allowed to read, and a
subscription says what Slack will trouble itself to send. Without the
subscription Slack sends nothing, so there is nothing to be allowed to read.

**2. The scope, under OAuth & Permissions.** `channels:history` for public
channels, and `groups:history`, `im:history` or `mpim:history` for the other
kinds. Slack adds the matching scope for you when you add the event above, but
check it: a token that predates the change carries the old scopes until the app
is **reinstalled to the workspace**, which is the step people skip. A bot token
set up only to post carries none of them.

Add the bot to the channel as well. A subscription and a scope do not put it in
a room it was never invited to.

**What the product can and cannot tell you.** It asks Slack which scopes a
token holds and says so where it matters: the trigger's row in the list is
marked **Will not fire**, its own settings page prints the reason under the
Action picker, and the connection's page says what its token cannot do. Nothing
is marked where Slack said nothing about scopes at all — an absence nobody
reported is not an absence.

It cannot see your event subscriptions. Slack exposes an app's subscription
list to no bot token, so a connection with every scope granted and no
subscription looks, from here, exactly like one nobody has written to. What it
does instead is say when something *did* arrive: the first reply that reaches a
reply trigger without being an answer to one of its watched bots leaves a line
in the trigger's own log. So an empty log means Slack has sent nothing — go and
look at Event Subscriptions — and a log with one line in it means delivery
works and the trigger is watching the wrong bot.

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

## Switching one off

A trigger carries an **Enabled** switch, in three places: the toggle on its row
in the list, and the same switch on the form that creates one and on its own
settings page. Off is not deleted — the definition stays, the workflows pointing
at it stay pointed at it, and nothing starts. A new trigger arrives switched on
unless the form is told otherwise, which is worth doing for a webhook defined
before its caller exists.

Nothing that fires reads it later than it has to: an arriving event and the
scheduler's tick only ever look at enabled definitions, and a request to a
switched-off webhook is answered `404` like any other path nobody has claimed.
Whichever switch is used, the workspace's audit log says so in the same words.

## History

Every trigger keeps a history: when it fired, what set it off, and what came of
it. It is a table, the same shape as the audit log, and it records failures as
well as successes — a request that failed authentication, a payload that did not
match the contract, or an error raised while the trigger ran. If a workflow is
not running when you expect it to, this is the page that says why.
