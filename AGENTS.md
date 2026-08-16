# Working in orknux-ui

Notes for anyone — human or agent — changing this repository. See
[README.md](README.md) for what the app is and how to run it.

## Commands

There is no Node on the development machine. Everything goes through the compose
`dev` service:

```
docker compose up dev
docker compose run --rm dev npm run typecheck   # tsc -b
docker compose run --rm dev npm run build
docker compose restart dev                      # after adding or renaming files
```

**The restart matters.** Vite serves stale modules over the Docker bind mount
after a file is added; a page that "ignores" a new component is almost always
that, not the code. It happens to edited files too — a CSS rule that reads as
having no effect is worth restarting before it is worth debugging.

`npm run typecheck` is `tsc -b`, not `tsc --noEmit`: this is a solution-style
tsconfig, and `--noEmit` silently checks nothing.

## Structure

```
src/api/         one module per server aggregate: queries, mutations, types
src/components/  the app shell, sidebars, dialogs, shared table pieces
src/pages/       one directory per screen: Page.tsx + Page.module.css
src/session/     the signed-in user, and how it is shown
src/styles/      design tokens
```

- **CSS Modules only**, and every colour, space and radius comes from
  `tokens.css`. New value? Add a token rather than a literal.
- **Server access goes through `src/api`.** Components never call `graphql()`
  directly. The client sends the session cookie and unwraps GraphQL errors into
  `ApiError`. The one call that is not GraphQL lives there too: chat streaming
  reads server-sent events off a `POST` with `fetch`, since `EventSource` only
  does GET and there is a message to send.
- Pages own their loading and error state and render it inline (`Loading…`, the
  message, an empty note) rather than throwing.
- Dialogs are native `<dialog>` elements sharing `Dialog.module.css`.
- **`color-scheme` is a token too.** `:root` declares `dark` and the light theme
  declares `light`, which is what makes the browser's own furniture — scrollbars,
  form controls, the flash before first paint — follow the theme. It is the one
  surface the colour tokens cannot reach, so hiding scrollbars is not the fix.
- **An editor is a textarea over a coloured copy.** No editor component ships
  here: `highlightJs` and `highlightMarkdown` tokenize to HTML, a `<pre>` renders
  it underneath, and a transparent textarea on top draws only the caret and the
  selection. Both must share every property that decides where a glyph lands —
  font, size, line-height, padding, wrapping, tab-size — or the caret drifts from
  the text. Keep palettes to colour alone: a bold run can measure differently and
  drag the rest of the line out of alignment.
- **What a model writes is rendered markdown, not text.** `Markdown` wraps
  `react-markdown` with GFM and `remark-breaks` — the last because a chat is not a
  document and a model that answers on ten lines means ten lines. Raw HTML stays
  off: model output is untrusted, and a prompt can ask for anything.

## Implementing a design

Designs arrive as Figma frames. Pull them with the Figma MCP tools, then adapt:
the returned React + Tailwind is a reference, never the output. Reuse the
existing components and tokens, and download the exported SVGs into
`src/assets/` rather than hand-writing icon paths. Say so explicitly when the
implementation departs from the design.

Icons are `<img>` elements with a light stroke baked into the file, and the light
theme darkens them with one rule in `tokens.css` that matches `img` itself. Do
not narrow that rule to the URL: a build inlines every icon under 4kB as a
`data:image/svg+xml` URI, so a selector like `[src$='.svg']` matches everything
in development and nothing in production. An icon carrying colour of its own — a
toggle is green for on — opts out with `data-keeps-colour`. If a photograph or
an avatar ever lands in an `<img>`, that rule is the thing to revisit.

## Verifying

Typechecking is not evidence the screen works. Verify in a real browser with the
puppeteer image, driving the flow end to end:

```
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e NODE_PATH=/usr/src/app/node_modules -v "<scripts>:/app" -v "<out>:/out" \
  --entrypoint node zenika/alpine-chrome:with-puppeteer /app/flow.js
```

Point Chrome at the host with
`--host-resolver-rules=MAP localhost <host-gateway-ip>`, and give each user their
own `browser.createBrowserContext()` so sessions do not share a cookie jar.
Setting `input.value` from a script does not notify React — go through the native
setter and dispatch an `input` event.

## React Flow

The editor tracks its own selection: `selected` passed through node props is
ignored, and `onSelectionChange` fires with an empty list often enough to clear
state you keep alongside it. React Flow's own selection wins when there is one.
