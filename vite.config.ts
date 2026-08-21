import { readFileSync } from 'node:fs';
import { Agent } from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.ORKNUX_SERVER_URL ?? 'http://localhost:8080';

// The monitoring screen shows the version this bundle was built at, so it comes
// from the one place that already records it.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/*
 * One connection to the server, reused, instead of a new one per request.
 *
 * What vite's `server.proxy` is underneath sets `agent: false` on every request
 * it forwards and adds `Connection: close` with it, so each proxied call opened
 * a TCP connection of its own and threw it away. From this container that
 * connection crosses Docker Desktop's host gateway to reach the server on the
 * Windows machine, and the crossing loses a SYN every few hundred attempts.
 * Losing one is not free: Linux retries at 1s, then 3s, 7s, 15s, 31s, 63s, and
 * the request waits for whichever attempt gets through. That is the whole of
 * issue #163 — a few requests per thousand hanging for thirty-five seconds,
 * which is the fifth rung of that ladder.
 *
 * Measured, from inside the container: 500 bare TCP connects to the gateway ran
 * a median of 1ms with one at 1011ms, while 500 connects to a port in the same
 * container never passed 1ms. The dev server is not slow and the proxy is not
 * confused; it was simply making the risky crossing 1,600 times where one would
 * have done.
 *
 * Reusing the connection does not repair the gateway. It stops walking through
 * it: the server allows a hundred requests per connection and answers the
 * hundredth with `Connection: close`, so the agent is told to retire the socket
 * rather than racing the server for it.
 *
 * `timeout` is how long a socket may sit unused in the pool before it is
 * dropped — deliberately shorter than the server's own patience, so the stale
 * end is always ours. It is not a limit on a request: node destroys a socket on
 * timeout only while it is in the free list, so the checks that wait minutes on
 * one API call are untouched by it.
 */
const PROXY = {
  changeOrigin: true,
  agent: new Agent({ keepAlive: true, keepAliveMsecs: 1_000, timeout: 30_000 }),
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  server: {
    port: 5173,
    /*
     * The dev server runs in a container against a bind-mounted working copy,
     * and filesystem events do not cross that boundary on Windows or macOS: the
     * watcher hears nothing, so vite goes on serving the module it transformed
     * at startup while the file on disk has moved on. It looks exactly like an
     * edit that did not work — a browser reload does not help, because the
     * staleness is on the server side. Polling costs a directory scan a second
     * and removes the whole class of it.
     */
    watch: { usePolling: true, interval: 1000 },
    // Keeps the browser on one origin, so the session cookie is first-party.
    proxy: {
      '/api': { ...PROXY, target: API_TARGET },
      '/graphql': { ...PROXY, target: API_TARGET },
      /*
       * The MCP endpoint. Nothing in this bundle calls it — an outside agent
       * connects to the server directly — but without this a request to it from
       * this origin reaches the dev server instead and 404s, which reads as
       * "that endpoint does not exist" rather than "it is on the other port".
       */
      '/mcp': { ...PROXY, target: API_TARGET },
    },
  },
});
