"""
Something that draws, for `image-model-check.mjs`.

The check drives the interface against a real server, and the drawing it is
about happens on that server rather than in the page - so unlike every other
stub in this folder it cannot live in the browser. A stub in the page would be
a check of the stub.

It answers OpenAI's image API and nothing else: a POST to /images/generations
comes back with `data[0].b64_json`, which is the shape `ModelImageClient` reads
first. The picture is a red square, small enough to be a literal here and real
enough that a browser can decode it and report a size - which is the assertion
that separates a picture from a broken image.

Python because there is no Node on the machine this is run from and the server
is on the host beside it. Started by hand:

    python scripts/suite/image-stub.py 8199

and pointed at with ORKNUX_IMAGE_STUB.
"""

import base64
import json
import sys
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer


def square(side=64, colour=(220, 60, 60)):
    """A PNG of one colour, built here rather than carried as a blob."""

    def chunk(kind, payload):
        body = kind + payload
        return (
            len(payload).to_bytes(4, "big")
            + body
            + (zlib.crc32(body) & 0xFFFFFFFF).to_bytes(4, "big")
        )

    header = chunk(b"IHDR", side.to_bytes(4, "big") + side.to_bytes(4, "big") + bytes([8, 2, 0, 0, 0]))
    # One filter byte then RGB triples, per row, which is filter type 0.
    raw = b"".join(b"\x00" + bytes(colour) * side for _ in range(side))
    return b"\x89PNG\r\n\x1a\n" + header + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PICTURE = base64.b64encode(square()).decode("ascii")


class Draws(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        asked = self.rfile.read(length)
        if not self.path.endswith("/images/generations"):
            self.answer(404, {"error": {"message": "No such endpoint here"}})
            return

        sys.stderr.write("drew: %s\n" % asked.decode("utf-8", "replace")[:200])
        self.answer(200, {"data": [{"b64_json": PICTURE}]})

    def do_GET(self):
        # So a provider check against this endpoint reports something sensible.
        self.answer(200, {"data": [{"id": "stub-image"}]})

    def answer(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8199
    sys.stderr.write("drawing on %d\n" % port)
    HTTPServer(("127.0.0.1", port), Draws).serve_forever()
