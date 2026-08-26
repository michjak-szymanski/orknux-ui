"""
A model that works slowly enough to be interrupted, for `task-message-check.mjs`.

The check is about saying something to a task *while it is working*, and there
is no way to do that to a task that is already over. A model pointed at
`.invalid` fails a task in forty milliseconds - `task-live-check` measured it -
so a check written against one would be typing into a page that had finished
before it loaded. This is a model that spends [SAY_SECONDS] on its first round,
which is a window somebody can act inside.

Like `reasoning-stub.py` beside it, it cannot live in the browser. What is being
checked is that words typed into a page reach a model the *server* is talking
to, and a stub in the page would be a check of the stub.

Two rounds, told apart by what is in the request rather than by a counter here,
so two runs cannot interfere with each other and a restart between them changes
nothing:

  * A request that does not mention a table is the first round. It says what it
    has done, slowly, and asks for nothing - which the loop treats as progress
    and comes back for another turn.
  * A request that mentions one is a round the message reached. It calls
    `task_done` with a summary saying so, which is what makes the check an
    assertion about the *work* changing shape rather than about a row in a
    table changing a flag.

[TABLE] is what the check types, and it is fixed rather than stamped because the
stub cannot know what the check made up. The stamped half of the check is the
task's title, which keeps two runs apart everywhere it matters.

Python because there is no Node on the machine this is run from and the server is
on the host beside it. Started by hand:

    python scripts/suite/message-stub.py 8199

and pointed at with ORKNUX_MESSAGE_STUB.
"""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# How long the first round takes, and in how many pieces. Long enough for a
# check to load the page, read that it is working, type into the box and press
# send - and long enough that the message is visibly unread for a while, which
# is the state this feature is honest about.
SAY_SECONDS = 24.0
SAY_FRAMES = 24

# What the check types into the box. Its arrival in the conversation is the only
# thing that tells the second round from the first.
TABLE = "a table"

PROGRESS = (
    "I have read last week's runs and three of them failed. I am writing it up "
    "as prose, a paragraph for each failure, and will say when it is done. "
)


def pieces(text, into):
    """`text` cut into `into` roughly equal pieces, none of them empty."""
    size = max(1, len(text) // into)
    return [text[at:at + size] for at in range(0, len(text), size)]


class Works(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        if not self.path.endswith("/chat/completions"):
            self.refuse()
            return

        told = TABLE in body
        sys.stderr.write("round: %s\n" % ("told about the table" if told else "working"))

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        if told:
            # It changes what it is producing and stops, which is the whole
            # point of the feature: the artifact took a different shape because
            # somebody said so while the work was going on.
            self.frame({"choices": [{"delta": {"tool_calls": [{
                "index": 0,
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "task_done",
                    "arguments": json.dumps({
                        "summary": "Rewritten as a table of the three failed runs, as you asked.",
                    }),
                },
            }]}}]})
        else:
            for piece in pieces(PROGRESS, SAY_FRAMES):
                self.frame({"choices": [{"delta": {"content": piece}}]})
                time.sleep(SAY_SECONDS / SAY_FRAMES)

        self.frame({"choices": [{"delta": {}}], "usage": {"prompt_tokens": 40, "completion_tokens": 20}})
        self.write("data: [DONE]\n\n")

    def do_GET(self):
        """So a provider check against this endpoint reports something sensible."""
        payload = json.dumps({"data": [{"id": "stub-message"}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def frame(self, body):
        self.write("data: %s\n\n" % json.dumps(body))

    def write(self, text):
        try:
            self.wfile.write(text.encode("utf-8"))
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # The server gave up on the round - a task that was stopped while
            # this was still talking. Something to be on the other end of rather
            # than a fault.
            pass

    def refuse(self):
        payload = json.dumps({"error": {"message": "No such endpoint here"}}).encode("utf-8")
        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8199
    sys.stderr.write("working slowly on %d\n" % port)
    # Threading, because a task's turn and a provider check can be in flight at
    # once and a stub that answers one at a time would look like a hung model.
    ThreadingHTTPServer(("0.0.0.0", port), Works).serve_forever()
