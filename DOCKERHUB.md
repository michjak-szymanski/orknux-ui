# orknux-ui

The interface for [`orknux/orknux-server`](https://hub.docker.com/r/orknux/orknux-server):
the workflow editor, the run history, the workspace's agents, models, tools and
skills, chat, and the administration screens.

Static files served by nginx, with the API forwarded to the server — so the
browser stays on one origin and the session cookie is first-party.

- **Source:** https://github.com/michjak-szymanski/orknux-ui
- **Licence:** AGPL-3.0-or-later
- **Exposes:** `8080`
- **Runs as:** uid `101`, not root
- **Tags:** `latest` follows `main`; `X.Y.Z` and `X.Y` come from release tags;
  `sha-<commit>` never moves.

## Running it

```yaml
services:
  orknux-ui:
    image: orknux/orknux-ui:latest
    ports: ["80:8080"]
    environment:
      ORKNUX_SERVER_URL: http://orknux-server:8080
    depends_on: [orknux-server]
```

## Settings

| Variable | Default | |
| --- | --- | --- |
| `ORKNUX_SERVER_URL` | `http://orknux-server:8080` | Where `/api`, `/graphql` and `/mcp` are forwarded. The name has to resolve **when the container starts** — nginx looks it up once, so a server that is not up yet stops this container from starting. That is deliberate: an interface that starts without a back end serves a sign-in screen that cannot sign anybody in. |

That is the only setting. Everything else — who may see what, which models exist,
whether chat is on — belongs to the server and is configured there.

## What it serves

- Every route answers with `index.html`, because a single page's URLs are not
  files. A deep link like `/workspace/1/executions` works on a refresh.
- `/assets/*` is content-hashed by the build and cached for a year; `index.html`
  never is, or a deployment would go on serving the previous bundle.
- `/api`, `/graphql` and `/mcp` are forwarded to `ORKNUX_SERVER_URL` with the
  caller's address preserved, so the server logs who did what.
- Answers stream unbuffered, which is what makes a chat appear as it is written
  rather than in one piece at the end.

## Behind a proxy

Terminate TLS in front of it and forward everything to `8080`. The container sets
`X-Forwarded-For` and `X-Forwarded-Proto` on what it passes to the server; if you
put another proxy in front, make sure it does too, or the audit log attributes
every action to the proxy.

## Health

`HEALTHCHECK` fetches `/` inside the container. A healthy container means the
files are being served — it says nothing about whether the server behind it is
answering, which is the Monitoring page's job.
