"""
Something that thinks out loud, for `task-thinking-check.mjs`.

The check is about a task's page drawing the model thinking *while it thinks*,
and there is no way to watch that without a model that emits reasoning slowly.
Like `image-stub.py` beside it, this cannot live in the browser: the thinking is
produced by the server calling a provider, written into the task's session and
followed by the page over a stream. A stub in the page would be a check of the
stub.

It answers the OpenAI-compatible chat-completions shape with `reasoning_content`
deltas — DeepSeek's spelling, which vLLM, SGLang and llama.cpp copied and which
`ModelChatClient` reads first. Streaming only matters: a task's round is streamed
now, which is the change this check exists for.

Two turns, told apart by what is in the request rather than by a counter here.
The first thinks for [THINK_SECONDS] and then reports progress, which is what the
loop treats as "carry on"; the second sees the loop's own nudge in the
conversation, thinks briefly and calls `task_done`, so the task ends and the
check can assert on a page that reached an ending. Stateless, so two runs cannot
interfere with each other and a restart between them changes nothing.

The pace is the point. A model that emitted its whole reasoning in one frame
would satisfy "the thinking is drawn" and say nothing at all about whether it was
drawn while the model was having it — so the frames are spread over seconds on
purpose, which is what a real reasoning model does anyway.

Python because there is no Node on the machine this is run from and the server is
on the host beside it. Started by hand:

    python scripts/suite/reasoning-stub.py 8198

and pointed at with ORKNUX_REASONING_STUB.
"""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# How long the first round spends thinking, and in how many pieces. Long enough
# that a check can read the elapsed count, wait two seconds and read it again -
# which is the assertion that separates streaming from painting it all at the
# end.
THINK_SECONDS = 12.0
THINK_FRAMES = 24

# And how long the first round spends *writing*, once it has stopped thinking.
#
# The stretch a model spends composing a long answer is the one issue #290 was
# reported from: a task asked for a thousand words thinks for a few seconds and
# then writes for minutes, and for the whole of that the reasoning is over and
# nothing has been said yet. Written in one frame, as this was, that stretch has
# no duration at all and the check below could not have looked at it.
WRITE_SECONDS = 10.0
WRITE_FRAMES = 20

REASONING = (
    "Let me work out what this task is asking for. It wants a report of what "
    "happened last week, so the first thing to do is find out which runs there "
    "were and which of them failed. I should look at the workflow executions "
    "first, then read the steps of anything that ended badly, and only then "
    "write anything down. Writing the report before I have the failures would "
    "be inventing it. "
)

# The loop's own nudge, written into the conversation after a turn that reported
# progress. Its presence is how a second round is told from a first.
CARRY_ON = "Carry on with the task"


def pieces(text, into):
    """`text` cut into `into` roughly equal pieces, none of them empty."""
    size = max(1, len(text) // into)
    return [text[at:at + size] for at in range(0, len(text), size)]


class Thinks(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        if not self.path.endswith("/chat/completions"):
            self.refuse()
            return

        finishing = CARRY_ON in body
        sys.stderr.write("round: %s\n" % ("finishing" if finishing else "thinking"))

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        # A short think on the closing round, so the check can also see a second
        # block settle rather than only the one it watched.
        seconds = 2.0 if finishing else THINK_SECONDS
        frames = 4 if finishing else THINK_FRAMES
        for piece in pieces(REASONING, frames):
            self.frame({"choices": [{"delta": {"reasoning_content": piece}}]})
            time.sleep(seconds / frames)

        if finishing:
            self.frame({"choices": [{"delta": {"tool_calls": [{
                "index": 0,
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "task_done",
                    "arguments": json.dumps({"summary": "Three runs failed last week, all on the same step."}),
                },
            }]}}]})
        else:
            # Written a piece at a time, over seconds, with no more reasoning at
            # all - which is the shape that catches a thinking block still
            # claiming to be arriving while the model has moved on to answering.
            said = "I have read last week's runs and three of them failed. " * 8
            for piece in pieces(said, WRITE_FRAMES):
                self.frame({"choices": [{"delta": {"content": piece}}]})
                time.sleep(WRITE_SECONDS / WRITE_FRAMES)

        self.frame({"choices": [{"delta": {}}], "usage": {"prompt_tokens": 40, "completion_tokens": 20}})
        self.write("data: [DONE]\n\n")

    def do_GET(self):
        """So a provider check against this endpoint reports something sensible."""
        payload = json.dumps({"data": [{"id": "stub-reasoning"}]}).encode("utf-8")
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
            # The server gave up on the round, which is a thing this is here to
            # be on the other end of rather than a fault.
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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8198
    sys.stderr.write("thinking on %d\n" % port)
    # Threading, because a task's turn and a provider check can be in flight at
    # once and a stub that answers one at a time would look like a hung model.
    ThreadingHTTPServer(("0.0.0.0", port), Thinks).serve_forever()
