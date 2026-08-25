"""
An npm registry with three packages in it, for `library-install-check.mjs`.

The installing half of that check cannot be stubbed in the browser: the fetch
happens on the server, from a mutation, and a stub in the page would be a check
of the stub. It also must not reach the real npm - a suite that does goes red
the day somebody unpublishes something, and asserts about a file nobody in this
repository wrote. So this is the same arrangement `image-stub.py` is: a few
dozen lines the *server* can reach, started by hand and pointed at.

Python because there is no Node on the machine this is run from and the server
is on the host beside it. Started:

    python scripts/suite/npm-stub.py 8472

then the server is given ORKNUX_LIBRARY_REGISTRY_URL=http://localhost:8472 and
the check is given ORKNUX_LIBRARY_STUB=1.

It serves a real gzipped tar with a real `package/package.json` in it, because
the reader that opens one is the part most likely to be wrong and a stubbed-out
extraction would test nothing. The `dist.integrity` it states is computed from
the archive it actually built, so the server's own verification is exercised
rather than waved through.

The three packages are the three answers the screen has to be able to give:

    orknux-cjs@1.0.0    CommonJS, one file, requiring nothing - installs
    orknux-umd@1.0.0    a UMD wrapper round the same thing - installs
    orknux-needs@1.0.0  CommonJS calling require("buffer") - refused by name
"""

import base64
import gzip
import hashlib
import io
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

BLOCK = 512

# What the server will see, overridden from the command line. The tarball URL is
# stated by the metadata this serves, so it has to be the address the *server*
# reaches rather than the one this process bound.
BASE = "http://localhost:8472"

CJS = """'use strict'
exports.upper = function (t) { return String(t).toUpperCase() }
exports.tag = 'orknux-cjs'
"""

UMD = """(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.orknuxUmd = factory(); }
}(this, function () {
  return { lower: function (t) { return String(t).toLowerCase(); }, tag: 'orknux-umd' };
}));
"""

NEEDS = """'use strict'
var buffer = require("buffer")
module.exports = { of: function (t) { return buffer.Buffer.from(t) } }
"""


def header(name, size):
    """One ustar header block, checksummed the way tar checksums one."""
    block = bytearray(BLOCK)

    def put(at, text):
        raw = text.encode("utf-8")
        block[at:at + len(raw)] = raw

    put(0, name)
    put(100, "0000644 ")
    put(108, "0000000 ")
    put(116, "0000000 ")
    put(124, "%011o " % size)
    put(136, "00000000000 ")
    # The checksum is computed with its own eight bytes read as spaces.
    put(148, "        ")
    block[156] = ord("0")
    put(257, "ustar 00")
    put(148, "%06o  " % sum(block))
    return bytes(block)


def tarball(files):
    """`package/<path>` for each entry, gzipped, with the two closing blocks."""
    raw = io.BytesIO()
    with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
        for path, content in files.items():
            body = content.encode("utf-8")
            gz.write(header("package/" + path, len(body)))
            gz.write(body)
            gz.write(bytes((BLOCK - len(body) % BLOCK) % BLOCK))
        gz.write(bytes(BLOCK * 2))
    return raw.getvalue()


def package(name, version, described, entry, source):
    return {
        "version": version,
        "archive": tarball({
            "package.json": json.dumps(described),
            entry: source,
        }),
    }


PACKAGES = {
    "orknux-cjs": package(
        "orknux-cjs", "1.0.0",
        {"name": "orknux-cjs", "version": "1.0.0", "main": "index.js"},
        "index.js", CJS,
    ),
    "orknux-umd": package(
        "orknux-umd", "1.0.0",
        {"name": "orknux-umd", "version": "1.0.0", "main": "index.js"},
        "index.js", UMD,
    ),
    "orknux-needs": package(
        "orknux-needs", "1.0.0",
        {"name": "orknux-needs", "version": "1.0.0", "main": "index.js"},
        "index.js", NEEDS,
    ),
}


class Registry(BaseHTTPRequestHandler):

    def do_GET(self):
        path = self.path.split("?")[0].strip("/")
        parts = path.split("/")

        # /<name>/-/<name>-<version>.tgz
        if len(parts) == 3 and parts[1] == "-":
            held = PACKAGES.get(parts[0])
            if held is not None and parts[2] == "%s-%s.tgz" % (parts[0], held["version"]):
                return self.answer(held["archive"], "application/octet-stream")
            return self.missing()

        # /<name>/<version>
        if len(parts) == 2:
            held = PACKAGES.get(parts[0])
            if held is not None and parts[1] == held["version"]:
                integrity = "sha512-" + base64.b64encode(
                    hashlib.sha512(held["archive"]).digest()
                ).decode("ascii")
                body = json.dumps({
                    "name": parts[0],
                    "version": held["version"],
                    "dist": {
                        "tarball": "%s/%s/-/%s-%s.tgz" % (BASE, parts[0], parts[0], held["version"]),
                        "integrity": integrity,
                    },
                })
                return self.answer(body.encode("utf-8"), "application/json")

        return self.missing()

    def answer(self, body, kind):
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def missing(self):
        """A name nobody published, which is the registry's own answer to one."""
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("npm-stub %s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8472
    BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:%d" % port
    print("npm stub on %d, serving %s" % (port, ", ".join(sorted(PACKAGES))), flush=True)
    HTTPServer(("0.0.0.0", port), Registry).serve_forever()
