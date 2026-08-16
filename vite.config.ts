import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.ORKNUX_SERVER_URL ?? 'http://localhost:8080';

// The monitoring screen shows the version this bundle was built at, so it comes
// from the one place that already records it.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
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
      '/api': { target: API_TARGET, changeOrigin: true },
      '/graphql': { target: API_TARGET, changeOrigin: true },
      /*
       * The MCP endpoint. Nothing in this bundle calls it — an outside agent
       * connects to the server directly — but without this a request to it from
       * this origin reaches the dev server instead and 404s, which reads as
       * "that endpoint does not exist" rather than "it is on the other port".
       */
      '/mcp': { target: API_TARGET, changeOrigin: true },
    },
  },
});
