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
- **Code is edited in Monaco; prose is not.** `CodeEditor` wraps Monaco for
  functions, tools and plugins, and `components/monaco.ts` sets it up once for
  the whole application — two workers, and a theme built from the same values
  `tokens.css` holds, because an editor nearly the colour of the panel around it
  looks like a bug. It replaced a textarea over a highlighted copy, which worked
  until it had to do anything an editor does: Tab moved focus out of the box,
  there was nothing to complete with, and every metric of the two layers had to be
  kept in step by hand.
- **That older arrangement is still what the skill editor is**, because markdown
  wants no language service. `highlightMarkdown` tokenizes to HTML, a `<pre>`
  renders it underneath, and a transparent textarea on top draws only the caret
  and the selection. The two must share every property that decides where a glyph
  lands — font, size, line-height, padding, wrapping, tab-size — or the caret
  drifts from the text, and a palette has to be colour alone: a bold run measures
  differently and drags the rest of the line out of alignment.
- **A page is added in two files or it is added in neither.** `src/navigation.ts`
  holds `PAGES` (the path, who may see it, how Go to names it) and
  `src/routes.tsx` maps each path to a component. `PAGE_ELEMENTS` is an exact
  record over those paths, so half a page is a compile error rather than a route
  that silently does nothing. `App.tsx` hand-writes only `/login` and the
  catch-all; do not add routes to it.
- **A keyboard shortcut is a setting.** `src/session/shortcut.ts` is the one place
  a binding is defined, remembered in `localStorage` and read through
  `useSyncExternalStore`; the Preferences page records a new keystroke and offers
  a reset. A new shortcut goes there and is offered there — a binding hardcoded
  into a page is one nobody can change and one that collides with somebody's
  screen reader.
- **The English sentence is the translation key.** The interface is read in
  English or in Polish, and the source still says `t('Add Connection')` rather
  than a key nobody could guess: `src/i18n/pl.ts` maps that sentence to the
  Polish one, and `t` falls back to what it was handed, so a string nobody has
  translated reads as correct English rather than as a key. Three reasons, and
  the third settled it - there are sixteen hundred of these and inventing
  sixteen hundred names is sixteen hundred chances to paste the wrong one;
  `git grep "Add Connection"` is how anybody finds the screen a report is about;
  and `hint-prose-check` reads the source for prose, so a key would have blinded
  it to every sentence in the product at once. It learnt to unfold `{t('…')}`
  instead, and sees exactly what it saw before.

  What that costs is that rewording an English string orphans its translation,
  silently. `catalogue-check` is what makes it loud: it fails on any entry keyed
  on English that has left `src/`. A call site with no Polish is only counted,
  because a language being worked on is the ordinary state of one.

  Identifiers, hosts, token prefixes, example values and the product's own name
  are not wrapped, deliberately: they are the same in every language.

- **A refusal from the server is translated from its code, not its sentence.**
  Every `…ExceptionResolver` sends `extensions.code` - the exception's class
  name, less `Exception` - and `extensions.arguments` where the sentence carries
  values; `src/i18n/refusals.ts` is keyed on that, and `client.ts` puts it
  together in one place rather than at the ninety `catch`es that print
  `cause.message`. The English sentence still arrives in `message` and is what
  is shown for anything the catalogue has no Polish for.

- **The language is a property of the person**, held on their row and mirrored
  into `localStorage` so the first paint is right. `src/session/language.ts` is
  the one place it lives; `navigator.language` is an opening guess and only for
  somebody who has never chosen. `t` is not reactive by itself - `App.tsx` keys
  the whole tree on the language, so a switch remounts the application.

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

**Undo is whole-graph snapshots, not a command log.** A step is nodes, edges and
the fingerprint the dirty check uses, pushed after a half-second pause so typing
a name is one step rather than one per letter. Restoring a step has to re-seed
the side panel's draft as well, or the panel writes the fields it was holding
back over the node that was just restored — which reads as undo not working. The
stack is cleared on load and on Discard, so redo cannot walk forward into a graph
that was thrown away, and `Ctrl+Z` inside a text box is left to the browser.

**A node carries its orientation.** Which side its input and output sit on is the
node's own, saved with it, so a graph can run down the screen and turn along the
way. Anything that lays out or draws an edge has to read it rather than assume
left to right.

**Rebuilding the node objects throws away what React Flow measured, and there are
two halves to that.** `initialWidth` / `initialHeight` say how big a box is
before anything has measured one, and without them an unmeasured node is drawn
`visibility: hidden` — issues #235 and #242. `measured` is the other half and it
is what keeps the *lines*: an edge is drawn from where its two nodes' handles
are, React Flow keeps those positions in bookkeeping of its own, and
`parseHandles` in `@xyflow/system` carries them across a rebuild only for a node
whose object says `measured`. Leave it off and the boxes are on the canvas with
nothing joining them, which is issue #259. Both pages that mount a canvas rebuild
their nodes from an answer — the run's on every read, the editor's in `loadGraph`
— so both say it: the run page can name the size, because every step's box is
exactly 200 by 90, and the editor hands back the measurement React Flow already
made, because its nodes are resizable and a size named for one would be a lie the
box could contradict. `scripts/graph-lines-check.mjs` watches both, every
animation frame.
