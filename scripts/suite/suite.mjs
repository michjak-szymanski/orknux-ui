/**
 * Which checks there are, and what each one needs before it can be believed.
 *
 * The list is here rather than a glob over the folder so that adding a file is
 * a decision: a script somebody wrote to measure something once should not
 * become a test in CI because it happened to be saved in this directory.
 *
 * `needs` is the honest part. Nearly every one of these drives the real
 * interface against a real server, and they differ in what has to be in that
 * server's database first:
 *
 *   'nothing'   - no server at all. A check that reads the source, or asks a
 *                 compiler about something the interface generates, and would
 *                 only be putting a browser between itself and the answer.
 *   'session'   - an account and nothing else. Runs anywhere the product runs.
 *   'workspace' - a workspace with the ordinary furniture: functions, tools,
 *                 conditions, connections, issues. The seed builds this.
 *   'workflow'  - a workflow with nodes and lines in it, opened in the editor.
 *   'fixture'   - something more particular than the two above; see the note.
 *   'model'     - a model that answers. CI has none, and neither does the
 *                 developer machine this was written on while its stored
 *                 secrets are unreadable. Never run unattended.
 *
 * `ci: false` means exactly one thing: this check is not run by the CI job. The
 * reason is written beside it, and it is never "it is flaky".
 */
export const TESTS = [
  // --- the editor canvas -----------------------------------------------------
  {
    name: 'turn-check',
    what: 'the control that turns a node, and R still doing the same',
    needs: ['workflow'],
  },
  {
    name: 'bend-check',
    what: "a line's points moving it exactly as far as they were dragged, bare and labelled",
    needs: ['workspace'],
    /*
     * It was held back on the fixture rather than on the behaviour: it took
     * whichever line the seeded workflow had most of in the open, which was
     * never reliably a line it could get a handle on. It builds its own graph
     * now - two agents passing a field, two passing none - so it runs anywhere
     * there is an agent to point four nodes at, and removes it afterwards.
     *
     * Both lines matter. Every line on the seeded workflow carries fields, so
     * the labelled one was the only kind ever driven, and the bug that turned
     * up was in the other direction: a labelled line would not take a second
     * bend, because its label lay over the middle of it and answered the
     * double-click that adds a point by taking its own point off. The whole
     * battery now runs twice, once against each kind.
     */
  },
  {
    name: 'editor-graph-check',
    what: 'the editor keeps its graph on the canvas, including across a Discard',
    needs: ['workflow'],
    /*
     * Issue #242, which is #235 on the other page that mounts a canvas. React
     * Flow draws a node it has no measurement for as invisible and drops every
     * measurement whenever the node objects are replaced, and when the
     * replacement lands in the same batch as a measurement the nodes stay hidden
     * until the page is reloaded.
     *
     * The editor is exposed in one place rather than everywhere: its nodes carry
     * `measured` back from React Flow, so every rebuild that spreads what is
     * already there hands the measurement back, and only `loadGraph` - opening
     * the editor, and Discard - builds the objects fresh. So Discard is what is
     * driven, watched every animation frame, because before the fix it blanked
     * all four nodes for exactly one frame on every press.
     *
     * The other half is that these nodes are resizable. One is dragged wider and
     * taller and has to keep the size it was dragged to: a fix that tells React
     * Flow how big an unmeasured node is must not pin a node somebody sized by
     * hand to the minimum.
     */
  },
  {
    name: 'panel-close-check',
    what: 'the × on the builder panel: where it is, that it stays there, and that Escape does it too',
    needs: ['workflow'],
    /*
     * Open definition opens a component down the left of the editor, and the
     * only way out was the Cancel at the foot of a form three screens long.
     * A panel is not a modal - it is opened with `show()`, so it gets neither a
     * backdrop nor an Escape from the browser - which is why both had to be
     * built rather than turned on.
     *
     * The measurement that earns this a place: the panel is scrolled to its end
     * and the × is measured again. A close control that scrolls away with the
     * first field is the same bug spelled differently, and it is invisible in a
     * screenshot of an unscrolled panel.
     */
  },
  {
    name: 'publish-shortcut-check',
    what: 'publishing a workflow from the keyboard, and the Publish control saying which keys',
    needs: ['workspace'],
    /*
     * Issue #233. Builds a one-node workflow of its own and removes it, so no
     * workflow anybody else's check reads is published by running this - and
     * the name carries a timestamp, because removing a workflow keeps its
     * definition and the name with it.
     *
     * Publishes are counted off the wire. A badge reading Published cannot tell
     * one publish from two, and one of the assertions is about exactly that.
     */
  },
  {
    name: 'editor-check',
    what: 'typing in a field name keeps focus, and does not delete the node behind it',
    needs: ['workflow'],
    /*
     * Was held back for waiting on a button called `Object` that nothing draws
     * any more. Nothing was wrong with the editor: issue 127 collapsed the six
     * Add buttons in the toolbar - Trigger, LLM Agent, Action, Condition,
     * Object, LLM Session - into one plus that opens a menu, and all six names
     * are still there one press further in. The check opens the menu, and both
     * bugs it was written for are being watched again.
     */
  },
  {
    name: 'agent-retry-check',
    what: 'an agent node has retries, a failure switch and a second handle',
    needs: ['workflow'],
  },
  {
    name: 'backoff-check',
    what: 'the doubling wait survives a save and a reload',
    needs: ['workflow'],
  },
  {
    name: 'editor-export-check',
    what: 'exporting the workflow on screen, at both depths, and what the file holds',
    needs: ['workflow'],
  },
  {
    name: 'flow-arrow-check',
    what: 'the lines a run travels point, in their own colour, and the dependencies still do not',
    needs: ['workspace'],
    /*
     * Issue #200. It builds its own graph - a flow line, a failure line and an
     * unwired node whose field is read, which is what draws the dashed one -
     * and removes it again, so it needs an agent to point four nodes at and
     * nothing else.
     *
     * It follows the `marker-end` to the `<marker>` it names rather than
     * stopping at "the attribute is set": a URL pointing at a definition
     * nothing rendered draws no arrow, and reads exactly like a fix that
     * landed. `marker-start` is read for the other half of the claim, since an
     * arrow at both ends says nothing about which way the run goes.
     */
  },
  {
    name: 'session-edge-check',
    what: "a session's line drawn as a dependency, against a flow line in the same graph",
    needs: ['workspace'],
    /*
     * A session is not a step - the validator does not count its line towards a
     * node's incoming, and the graph source folds it into the agents it leads to
     * before the engine sees it - and it used to be drawn with the same solid
     * line that means "and then".
     *
     * 'workspace' rather than 'workflow': it builds its own graph, because the
     * one the seed makes has no session node in it, and removes it again. It
     * needs no model and never runs anything - the graph is saved over GraphQL
     * and read back off the canvas.
     */
  },

  // --- the (?) that replaced the prose --------------------------------------
  {
    name: 'hint-hover-check',
    what: 'a hover shows the note, a press pins it, only its close puts it away',
    needs: ['workflow'],
  },
  {
    name: 'hint-placement-check',
    what: 'the note lands under its own control on a page inside the shell',
    needs: ['workflow'],
    /*
     * It named `/admin/shell`, which is the list of machines and has never
     * carried a (?) - so one of its four pages found nothing, wrote "(skipped
     * …: no (?) found)" and moved on, and the run reported three measurements
     * where the file names four. It opens `/admin/shell/new`, which is the form
     * this was meant to be about, and a page that draws no (?) is a failure
     * with a name on it rather than a line of prose in the log.
     */
  },
  {
    name: 'hint-settings-check',
    what: 'the workspace settings pages moved their prose, and kept what should stay printed',
    needs: ['workspace'],
    ci: false,
    /*
     * "plugins: 0 (?) on the page, expecting 1". The plugins page has nothing
     * to explain when no plugin is installed, which is what a fresh
     * installation is - so the check asks for a note on a page that correctly
     * has none. It finds a different page on a database with plugins in it, so
     * what needs deciding is whether the page should carry its note when it is
     * empty, or whether the check should stop asking. That is a product
     * question, not a plumbing one.
     */
  },
  {
    name: 'hint-forms-check',
    what: 'the trigger and condition forms, on a settings page and inside a dialog',
    needs: ['workspace'],
    /*
     * "trigger incoming: the page drew nothing in twenty seconds" was chased
     * with a browser open, and the pages are fine: all three draw their form
     * against the developer's database in well under a second. The check was
     * asking for /triggers/18, /conditions/7 and /agents/9 - the developer's
     * numbers - and a seeded workspace hands those ids to nothing, so what it
     * was photographing was the "That trigger does not exist" card, ninety
     * characters of <main> where it waits for three hundred. It looks the four
     * up by the names `seed-demo.mjs` writes now, and says what a page actually
     * held when one does not settle, so the next one of these cannot be
     * mistaken for a blank screen.
     */
  },
  {
    name: 'trigger-switch-check',
    what: 'the Enabled switch on both screens that define a trigger, and that it saves',
    needs: ['workspace'],
    /*
     * Issues #247 and #257 were the same missing control reported twice, which
     * is why one check drives both screens: the dialog and the settings page
     * are one component, and a fix that reached only one of them is exactly the
     * regression worth catching. Whether a switched-off trigger actually fires
     * is not asked here - a page cannot deliver a Slack mention or turn the
     * clock - and is covered on all three firing paths by the server suite.
     */
  },
  {
    name: 'reply-watch-check',
    what: 'the trigger form once a connection trigger can wait for a message or a reply',
    needs: ['workspace'],
    /*
     * Issue #269. Two events that were in the enum from the start with nothing
     * publishing them, so the form has never drawn either, and each brings
     * something the form has to say for itself: a reply asks a second question
     * - whose messages it watches, which is not the connection it listens on -
     * and a message has to admit how much traffic it is about to let in.
     *
     * Whether either one fires is not asked here, because a page cannot deliver
     * a Slack event. `SlackReplyTriggerTest` matches a reply's `parent_user_id`
     * against the watched bots end to end, and `SlackMessageEventTest` proves
     * the payload carries one at all.
     *
     * The saving half needs a Slack connection whose bot token answers
     * `auth.test`, because only a connection that can say which Slack user it
     * posts as can be watched. Where the seed has none it records that it did
     * not drive that half rather than passing over it in silence.
     */
  },
  {
    name: 'silent-trigger-check',
    what: 'a trigger Slack can never deliver anything to, marked in the list, on its own page and on its connection',
    needs: ['workspace'],
    /*
     * The aftermath of #269, reported as a bug and rightly: the product knew
     * the bot token carried no `channels:history`, knew that means no `message`
     * event will ever arrive, and drew that sentence in exactly one place - a
     * Replies To row, under a checkbox, on a field only a reply opens. Every
     * other surface said Enabled, a connection, an action.
     *
     * Two legs. The real one runs against the server with nothing intercepted
     * and asserts the thing this change is one step away from getting wrong:
     * `receives` is null when Slack's response carried no scope header, that is
     * "nothing reported" rather than "missing", and a connection nothing was
     * said about must not be marked. The forced one rewrites `slackBotUsers` so
     * one connection reports `receives: false` - being unable to receive needs
     * a Slack workspace to be unable to receive in - and reads the three
     * surfaces, the colour the mark is painted, and the sentence behind its (?).
     *
     * The claim that earns it its place is the pair: a message trigger and a
     * mention trigger on the *same* connection, one marked and one not. A check
     * that only proved the mark appears would pass an interface that warned
     * about every incoming trigger, which is a worse fault than the silence -
     * it sends somebody to widen a credential that is right as it is.
     *
     * It counts the questions that reach the wire as well. `slackBotUsers` is a
     * workspace query, so a list of any length asks it once; a row that asked
     * for itself would be a Slack round trip per row.
     */
  },
  {
    name: 'dialog-hint-check',
    what: 'every dialog sentence that moved behind a (?), and every one that did not',
    needs: ['workspace'],
  },
  {
    name: 'admin-hint-check',
    what: 'the six admin screens, same story',
    needs: ['session'],
  },
  {
    name: 'library-install-check',
    what: 'naming a package on the Libraries screen: the field, the pinned version, and the refusal',
    needs: ['session'],
    /*
     * Issue #265. It reaches no registry, and could not be in this suite if it
     * did: what it drives is the half that is answered before anything is
     * fetched - a tag instead of a version - so it runs on a machine with no way
     * out and still measures the sentence somebody is shown.
     *
     * It asks the server whether a registry is configured and asserts about
     * whichever case it finds, rather than assuming the default. Both are real
     * claims: with one, the field is drawn beside the upload; without one, there
     * is no field at all, because a control that fails on being used is the one
     * thing an offline installation should never be shown.
     *
     * Since #274 it has a third half, and that one does need a package to come
     * back: a CommonJS one installs now, and the only way to say so is to
     * install one. It must not be npm's, so it is the arrangement
     * `image-model-check.mjs` already uses for the thing it cannot stub in the
     * browser - `scripts/suite/npm-stub.py`, a registry the *server* can reach,
     * serving a real gzipped tarball. Set ORKNUX_LIBRARY_STUB=1 with the
     * installation pointed at it; unset, the check says so and stops there, and
     * the first two halves are exactly what they were.
     */
  },
  {
    name: 'hint-prose-check',
    what: 'every block of prose still in the open, and the written reason for each one',
    needs: ['workspace'],
    /*
     * The one in this group that is not about a screen somebody already
     * converted. The other six each drive a page whose prose was moved and
     * assert it stayed moved; none of them can say anything about the page
     * nobody has looked at, which is where three reports in twenty minutes came
     * from. This starts from the whole of `src/` and fails on anything left in
     * the open that is not written down with a reason.
     *
     * Its source half needs nothing at all - no browser, no server, no database
     * - and `ORKNUX_SOURCE_ONLY=1` runs that half alone in about a second. The
     * workspace is only for the browser half, which walks every fixed address
     * in `navigation.ts`.
     */
  },
  {
    name: 'status-split-check',
    what: 'four trimmed status lines, and the sentences that had to go somewhere',
    needs: ['workspace'],
    /*
     * The other side of hint-prose-check, which looks for prose still in the
     * open and would be perfectly happy with a status line whose second half
     * was deleted rather than moved. This asserts the move: the state is still
     * printed, and the sentence that left it is inside a `FieldHint` in the
     * same file.
     *
     * Its browser half drives one of the four. The bell's empty panel needs an
     * account with no notifications and the two trigger logs need a workspace
     * nothing has ever fired in, and manufacturing either against a real
     * database means changing somebody's data - so those three are asserted
     * from source and the check says so in its output rather than appearing to
     * measure something it does not.
     */
  },
  {
    name: 'revision-retention-check',
    what: 'how long component history is kept: typed, saved, reloaded, and zero refused',
    needs: ['session'],
  },
  {
    name: 'component-history-check',
    what: "a tool's versions and a workflow's publications: browsed, read, restored",
    needs: ['workspace'],
  },
  {
    name: 'history-hint-check',
    what: "History and Publications: the explanation behind the (?), the state still printed",
    needs: ['workspace'],
    /*
     * Builds a tool, an agent and a workflow of its own and takes them away,
     * because the half that would go unnoticed needs a component with nothing
     * in its history and a workflow nobody has published: "Nothing yet." and
     * "Never published." are statuses rather than explanations and stay
     * printed, and a check that only asked for the absence of prose would pass
     * a panel that had deleted them.
     *
     * Both directions, because the status is the half that goes wrong twice
     * over. It is asserted as the whole string the panel draws rather than a
     * substring of it - a status that runs on into a second sentence about how
     * the panel fills is teaching, and the (?) beside it is where that goes -
     * and every sentence that left the screen is asked for by name in the note,
     * so trimming one on the way behind the control is a failure rather than a
     * tidier screen.
     */
  },

  {
    name: 'icon-chrome-check',
    what: 'the picker hides the furniture and offers everything else, including the seven traps',
    needs: [],
    /*
     * The second check here that opens nothing. It has to be: a hidden icon
     * draws no pixels, so a browser cannot tell an icon deliberately kept out
     * of the picker from one a prefix-anchored regular expression swallowed by
     * accident. `plus-circle`, `search-code`, `save-all`, `sunrise`, `sunset`,
     * `moon-star` and `pen-tool` would each have gone that way silently. It
     * reads the rule out of `IconPicker.tsx` and asserts against every SVG in
     * `assets`, so it covers the icon added tomorrow.
     */
  },

  {
    name: 'row-action-check',
    what: 'the square at the end of a row answers the pointer, and alike on every page',
    needs: ['workspace'],
    /*
     * Reported as a screenshot of three buttons on one row: two did nothing
     * under the pointer and the third turned green. Underneath were sixteen
     * copies of `.rowAction` holding five different answers to `:hover`.
     *
     * It asserts in both places on purpose. The browser half proves the squares
     * answer and answer alike; the source half proves no stylesheet has taken
     * its copy back, which is the only thing that stops the thirteenth copy.
     */
  },

  {
    name: 'composer-target-check',
    what: 'the whole chat composer takes a click, and its one line sits in the middle of it',
    needs: [],
    /*
     * Reported as "the click only activates the input on a narrow area". The
     * box is 54px and the text in it 20, so most of what reads as the field was
     * dead. It asserts the three places somebody actually aims and the box's
     * height, because the padding was cut in the same breath and a check that
     * only proved the clicks would let it grow back.
     *
     * The same 34px of difference was reported again from the other side - the
     * text sat low, with 22px of air above it and 10 below, because the row is
     * aligned to the end so the buttons stay on the floor as the field grows.
     * So the air above and below the line is measured here too, along with the
     * buttons still being on that floor: the box's height, where the text sits
     * in it and where the controls sit beside it are three answers to one
     * arrangement, and a check that holds one of them lets the other two move.
     */
  },

  {
    name: 'chat-off-check',
    what: 'an installation with chat switched off stops offering chat’s settings',
    needs: ['workspace'],
    /*
     * Issue #201. The only check here that changes an installation-wide
     * setting: it turns chat off, reads the workspace's settings page, and puts
     * the switch back in a `finally` - whatever happened in between, including
     * a failed assertion - and then says out loud that it put it back. A check
     * that leaves chat off is a check that broke the thing it was measuring,
     * and every check after it would be reading a different product.
     *
     * It asserts what stays as carefully as what goes. The Quick Chat model is
     * a different feature under the same word - the server's flag governs
     * `ChatAPI` and `ChatStreamAPI`, and the panel answers through its own
     * endpoint - so hiding it here would take away the only way to switch off
     * something that still works.
     */
  },
  {
    name: 'chat-header-check',
    what: 'the title bar is one row, its search searches, and its delete asks first',
    needs: [],
    /*
     * The delete assertion is the one that matters. The trash button called
     * `deleteChat` straight through - one press, nothing said, every message
     * gone - from the header and from the row menu both. The check presses it
     * and asserts the chat is still there.
     */
  },

  {
    name: 'composer-growth-check',
    what: 'Shift+Enter grows the chat box a line at a time, up to the top, and then it scrolls',
    needs: ['workspace'],
    /*
     * Issue #221. The box was one line with a 200px ceiling and no growth at
     * all, so everything past the first line was written into a slot. The check
     * measures the step rather than the direction: "it got bigger" passes on a
     * `min-height` that jumps once and then sticks. It also types far past any
     * fixed ceiling and asserts the title bar is still on screen - the first
     * attempt at this grew for ever and pushed the header off the top, which
     * only a measurement of where things landed could tell from working.
     */
  },

  {
    name: 'send-label-check',
    what: 'the send button says what is happening: waiting for the model, then answering',
    needs: ['workspace'],
    /*
     * Issue #220. "Sending…" stood from the press until the answer was
     * complete, which is a message that left in the first few hundred bytes
     * being reported as still going out for as long as the model thinks - while
     * the conversation two inches below said "Waiting for Gemma 31B…".
     *
     * It stubs `fetch` for the one address the chat streams from, and only that
     * one. Not to avoid the server: what is being checked is *when* each word
     * is shown, and that timing is the model's - a seeded installation has none
     * that answers, and a real one takes anything from half a second to two
     * minutes. Everything else on the page is the real thing.
     */
  },

  {
    name: 'chat-selector-check',
    what: 'the model picker is drawn at its full width, and the link out goes where the name says',
    needs: ['workspace'],
    /*
     * Issue #219. The picker is 560px and was drawn 92px - it kept
     * `max-width: 100%` when it moved from a bar across the screen into the
     * title row, where 100% became the width of a model's name. Both halves are
     * asserted, because either alone would have passed at some point: content
     * clipped inside a box is not the same failure as a box drawn outside its
     * panel, and this had both. The link the same report asked for is followed
     * rather than counted - one that is present and points at the wrong row is
     * the thing a "there is a link" assertion would miss.
     */
  },

  {
    name: 'chat-agents-first-check',
    what: 'the picker above a chat offers agents first, and opens on whichever half holds the ticked one',
    needs: ['workspace'],
    /*
     * Issue #249. Two assertions that a lazy fix would separate: the tabs are
     * in a fixed order whatever the chat holds, and which of them opens follows
     * the chat and defaults to Agents. Reordering the tabs alone passes the
     * first and fails the second, which is why both are here.
     *
     * The chats it reads are made by the check and deleted again - what each
     * one is pointed at is the whole of what this measures, and reading
     * whichever chat happened to be first would measure whatever somebody last
     * left open.
     */
  },

  {
    name: 'chat-workspace-switch-check',
    what: 'switching workspace from a chat leaves you in the chat, about the other workspace',
    needs: ['workspace'],
    /*
     * Issue #250. Staying put is the half a fix that did nothing would also
     * pass, so the check asserts the conversations listed are now the other
     * workspace's and that the corner names it - a chat that has not changed
     * what it is about has not switched anything.
     *
     * It caught its own fix being half-written: the chat page read the
     * remembered workspace through a store but the effect that used it was
     * still keyed to the mount, so the corner moved, the page stayed, and the
     * sidebar went on listing the workspace that had just been left.
     *
     * The fourth assertion is about the rule that did not change: from a list
     * page, switching still lands on the same list in the new workspace.
     */
  },

  {
    name: 'hover-sweep-check',
    what: 'every small icon control on seventeen pages answers the pointer',
    needs: ['workspace'],
    /*
     * The wide one. `row-action-check` proves four pages and the stylesheets
     * behind them, and passed while a fifth of the product's icon controls did
     * nothing - the same square was declared as `.settings`, `.addMenu`,
     * `.refresh` and a bare `.toggle` in nine more files, and a check built
     * around names somebody already knew could not find any of them.
     *
     * This one knows no names: it finds everything drawn at about the size of
     * an icon button and hovers it. It also counts "could not reach it"
     * separately from "it did not respond" - the first version turned a
     * swallowed hover error into fifteen false findings on the triggers page,
     * whose buttons were simply off the right-hand edge.
     */
  },

  {
    name: 'attribution-check',
    what: 'the licence notice is on screen on every shell, and says which version',
    needs: ['workspace'],
    /*
     * The one check here where what breaks is not a bug but a licence term.
     * `Attribution.tsx` argues at length why it exists - AGPL 5(d), the 7(b)
     * term in NOTICE, the section 13 offer of source - and nothing had ever
     * checked it was actually drawn. One `display: none` from a stylesheet it
     * does not own and the obligation stops being met with nothing failing.
     *
     * The version is asserted against `package.json` rather than a number
     * written into the check, so a release bump cannot leave the two
     * disagreeing.
     */
  },

  // --- pages that are pages -------------------------------------------------
  {
    name: 'cron-reading-check',
    what: 'a cron expression reading back as English while it is typed, on both surfaces that ask for one',
    needs: ['workspace'],
    /*
     * Issue #203 made a cron of seconds a schedule the server keeps rather than
     * one it merely accepts, and started refusing an expression that parses and
     * never comes round. The field now says what the expression does, and the
     * (?) beside it names the six positions in the server's own order.
     *
     * Two of its assertions are the ones worth having, and neither shows in a
     * screenshot. It types a character that ruins a good expression and asserts
     * the sentence changes: a reading held in state and updated a render late
     * reads exactly like a reading and is a lie at the one moment somebody is
     * relying on it. And it measures the top of the Timezone field across the
     * longest and shortest readings there are, because a hint that wraps to two
     * lines and back moves everything under it while somebody is typing.
     *
     * It builds its own scheduled trigger over GraphQL for the second surface -
     * the settings card - and removes it again, since the seed does not promise
     * one with a known expression in it.
     */
  },
  {
    name: 'docs-zoom-check',
    what: 'a picture in the manual opens at full size, and keeps its colours on white',
    needs: ['session'],
    /*
     * Issue #217. It measures the picture twice - in the column, then in the
     * viewer - because "a viewer opened" is not the request: a viewer that
     * draws the same 720px picture has zoomed nothing.
     *
     * The light theme half was found while writing it, and is the reason the
     * check does not stop at the click. `tokens.css` darkens every `<img>` to
     * 42% brightness so the stroked icon files stay readable on white, and the
     * manual's forty-six screenshots were going through it too. Nothing failed;
     * the manual was simply illustrated with photographs taken at dusk.
     */
  },
  {
    name: 'recently-opened-check',
    what: 'the box in the top bar puts you back on what you last had open, by a keystroke of its own',
    needs: ['workspace'],
    /*
     * Issue #246. It builds two functions of its own and removes them, so it
     * needs a workspace and nothing that is in one.
     *
     * Two of its assertions are the design rather than the screen, and they are
     * why this is a check and not a screenshot. One renames a function behind
     * the browser's back and requires the list to show the new name: what is
     * stored is an address, and a stored *label* would pass every other
     * assertion here while quietly printing last week's word for ever. The
     * other deletes one and requires the row to be gone, which is the same
     * mechanism read the other way - an entry is only drawn while the thing it
     * names is still in the names the box has already fetched.
     *
     * It also stands over `palette-actions-check`'s ground for one assertion:
     * Create issue has to survive the rows now above it. Two checks asserting
     * one thing is usually a smell, but the whole risk of this change was
     * pushing #218's row off the end of a list of ten.
     */
  },
  {
    name: 'palette-actions-check',
    what: 'Quick actions offers things to do as well as places to go, and is named for it',
    needs: ['workspace'],
    /*
     * Issue #218. The row has to be there before anything is typed - that is
     * the half a check earns its place on, since a quick action nobody knows
     * about is not one - and pressing it has to land on the page that starts an
     * issue rather than on the list of them.
     *
     * It records what typing each word actually offers, which is how it came
     * out that this box scores a row against the whole of what was typed: "new
     * issue" matches nothing at all, because no label and no also-known-as
     * holds that phrase. Left as it is and written down here rather than
     * quietly fixed - one word is what people type into a box this size.
     */
  },
  {
    name: 'admin-width-check',
    what: 'every page under Admin fills the column it was given, and none of them caps it',
    needs: [],
    /*
     * Needs nothing, and is the only one here that does not: it opens no
     * browser and speaks to no server. It reads the admin paths out of
     * `navigation.ts`, follows each through `routes.tsx` to the file that draws
     * it, and asserts that nothing a page puts directly inside `<AppShell>`
     * carries a max-width.
     *
     * That is the point rather than a shortcut. Half these pages need a fixture
     * to render at all - the database this was written against had no template,
     * so `/admin/templates/:templateId` drew nothing - and a measurement only
     * covers the pages that happened to have something in them. Read out of
     * `src/`, it covers every page there is, including the next one somebody
     * adds.
     */
  },
  {
    name: 'condition-page-check',
    what: 'the condition editor as a page: create, find, change, reload, jump to its function',
    needs: ['workspace'],
    /*
     * In, and for two reasons that were both about the check.
     *
     * It waited for a link reading "Open definition", and 2df9a15 made every
     * one of those a mark - the words moved into the title and the
     * aria-label. So it spent thirty seconds waiting for text nothing draws and
     * then reported a missing link on a form that has one. It asks for the
     * accessible name now, which is what the convention actually promises, and
     * checks the mark is a mark.
     *
     * And it was held out of CI for "the workspace has no function to point a
     * condition at" - true, because only a function returning a boolean can
     * answer a condition and the seed writes none. It makes its own now, and
     * deletes it, so it says the same thing on every installation.
     */
  },
  {
    name: 'action-page-check',
    what: 'the action editor as a page: create, find, change, reload, Used by, and the Danger Zone',
    needs: ['workspace'],
    /*
     * An action was the last component edited only in a modal. It follows the
     * condition's page rather than a third arrangement, so this follows
     * `condition-page-check` - with one assertion of its own, that `Used by` is
     * drawn here. #258 put that panel in the dialog because an action had no
     * page, and a check that did not look for it on the page would let it be
     * lost in the move without anything going red.
     *
     * It builds a wait on a fixed time, which is the one subtype that names
     * nothing else in the workspace, and deletes it through the Danger Zone -
     * so the deletion is driven rather than assumed, and nothing is left behind.
     */
  },
  {
    name: 'definition-jump-check',
    what: "the way out of a function's object parameter to that object's editor",
    needs: ['workspace'],
    // Wants a function it can give an object parameter to. ORKNUX_FUNCTION.
  },
  {
    name: 'action-jump-check',
    what: "the way out of an action's four pickers to what they name",
    needs: ['workspace'],
  },
  {
    name: 'used-by-check',
    what: 'where a component is used: both states of the panel, and a row followed to the end',
    needs: ['workspace'],
    /*
     * Issues #258 and #268. It builds its own function and its own tool that
     * imports it, so that both answers are real: a component nothing points at
     * says so in words, and the same component with an importer names it. An
     * empty panel and a panel that failed to load are the same picture, which
     * is why the first half is asserted at all.
     *
     * The row is pressed rather than read. `agent-jump-check` found the failure
     * worth catching here - a link naming one thing and opening another - so
     * what it asserts is the name on the page it landed on, not the href.
     */
  },
  {
    name: 'agent-definition-check',
    what: "an agent node's definition opening in the panel, beside the graph, like a trigger's",
    needs: ['workflow'],
    /*
     * Runs against the workflow the seed builds: a trigger node pointing at a
     * trigger and an agent node pointing at an agent, which is what it presses
     * Open definition on. It saves the agent it opened - with the values it was
     * already holding, and it reads the name back afterwards to say so.
     */
  },
  {
    name: 'agent-memory-check',
    what: "an agent's session memory: the slider, the server's figures, and a refusal that stops Save",
    needs: ['workspace'],
    /*
     * Issue #226. What a session hands back to a model is a share of the chosen
     * model's context window, and every number and every sentence involved is
     * the server's - so what this measures is that the page prints what the API
     * answered, character for character, rather than that the figures are
     * right. A screen that recomputed one of these and landed a token out fails
     * here, which is the whole point of asserting against the API rather than
     * against numbers written into the check.
     *
     * It provokes the refusal rather than hoping for one: it makes a model with
     * a small window that reserves most of it for its answer, so half of that
     * window is a share that model cannot give. Waiting for a seeded model to
     * happen to refuse something is a check that passes on the installations
     * where it does not. Both models and the agent are removed again.
     */
  },
  {
    name: 'workspace-memory-check',
    what: "the workspace's default session memory, what it means per model, and the agent that inherits it",
    needs: ['workspace'],
    /*
     * The follow-up half of #226. The share stayed on the agent and gained a
     * step behind it - agent, then workspace, then the built-in allowance - so
     * there are two screens now and one quantity, and the seam between them is
     * what this drives: a default set on the workspace's settings page has to
     * turn up on an agent that set nothing, named as inherited, and clearing it
     * has to put that agent back on the built-in allowance.
     *
     * The assertion worth the whole check is the one about two models. It makes
     * a 200,000-token window and an 8,000-token one and asks the same 25% of
     * both: the second cannot give it, the screen has to say so in the server's
     * words, and Save has to stay on - because the server judges a workspace
     * default on the bounds alone, deliberately, and a screen that invented a
     * per-model refusal there would refuse a default that is right for every
     * other model in the workspace. A screen that quietly blocked the save
     * would pass every other assertion here.
     *
     * It also reaches past the track's own end once, on purpose. The track
     * stops at the server's ceiling so a share outside the bounds cannot be
     * dragged to; the refusal slot beneath is the safety net for those two
     * copies of the ceiling parting company, and a safety net nothing ever
     * tests is one nobody knows is torn. Both models, the agent and the default
     * are put back afterwards.
     */
  },
  {
    name: 'voice-turn-taking-check',
    what: "the workspace's voice turn-taking: the three boxes, the bounds, and a turn that really ends on them",
    needs: ['workspace'],
    /*
     * Issue #256. Voice mode kept answering while somebody was still talking,
     * three times over two numbers, and the numbers behind it are a judgement
     * about how people talk rather than a fact about audio - so a workspace can
     * move them, and the server stores only a departure from what the interface
     * already does.
     *
     * Two assertions are worth the whole check. The first is that an empty box
     * names voice mode's own value, read out of VoiceMode.tsx by the check
     * rather than written into it: a settings page holding its own copy of 2.5
     * seconds goes on saying 2.5 seconds after that file says something else,
     * which is a form lying about the product it configures, and nothing else
     * here would notice.
     *
     * The second is why this drives audio at all. A setting that is stored and
     * never read is worse than no setting, and every other assertion here would
     * pass on a page that saved three numbers nothing consults. So the panel is
     * given a fake microphone - a file that speaks for a moment and then stops
     * - and the turn is timed twice: once with nothing set, where it has to end
     * on voice mode's own pause, and once with a longer pause set, where it has
     * to end that much later. How far, not whether: a turn that merely took
     * longer would pass on a slow machine.
     *
     * The other two settings are asserted stored, cleared and bounded rather
     * than heard. The sensitivity cannot be defeated by a loud tone - a fixed
     * level qualifies a voice on its own, deliberately, so a silent room is not
     * absurdly sensitive - and the unattended microphone's floor is five
     * minutes, which is not a thing to sit in front of. What can be measured
     * about those two is measured from the source instead: the watching loop
     * has to read all three off the workspace, and a constant put back in the
     * middle of it fails here.
     *
     * Both models, the chat and the settings are put back afterwards.
     */
  },
  {
    name: 'voice-queue-check',
    what: 'what is said or typed while voice mode is busy: held, shown, and sent when the turn comes round',
    needs: ['workspace'],
    /*
     * Issues #254 and #262. The microphone used to close between turns, so
     * everything said while the model was thinking or the answer was being read
     * went nowhere at all - which is most of a conversation. It is held open
     * now and what changes is where the words go.
     *
     * Three of its assertions could not be made any other way. That a message
     * is *added* to the one already waiting rather than replacing it, which is
     * the decision about being talked over and is invisible in any single
     * screenshot. That the waiting message goes out by itself when the turn
     * ends, with nobody pressing anything. And that the panel never says
     * Speaking while no sound has come out - the speech model is stubbed to
     * take a known time over a clip, and the caption is watched across exactly
     * that gap, which is where it used to lie.
     *
     * The last phase is a regression rather than a feature: cutting in used to
     * silence the panel for the rest of the session, with the microphone still
     * working and the answers still arriving. It interrupts on purpose and then
     * insists on hearing the turn after it.
     *
     * The microphone is a file Chromium is told to believe, and the ears, the
     * mouth and the model are stubbed - not to avoid the server, but because
     * every assertion here is about timing that belongs to none of them. The
     * models and the chat it makes are put back afterwards.
     */
  },
  {
    name: 'spoken-answer-check',
    what: 'the speaker under an answer reads what it renders to, a sentence at a time',
    needs: ['workspace'],
    /*
     * Issues #255 and #263 over one seam. It was handed the markdown, so an
     * answer read aloud pronounced the asterisks, the backticks, the hashes and
     * the address inside every link; and it was handed all of it at once, so
     * the wait before the first word was the wait for the last one to be
     * synthesised.
     *
     * The assertions worth the whole check are the last three. Anything that
     * strips a character passes the ones about markup; only a reader that
     * pipelines passes "sound started before the last piece was even asked
     * for", and only one that keeps a lid on it passes "never more than two
     * being made at once" - asking for every piece the moment an answer lands
     * would put a burst on a provider for audio nobody may ever hear.
     */
  },
  {
    name: 'image-model-check',
    what: 'the picture button in a chat, and the drawing it puts in the answer',
    needs: ['workspace'],
    ci: false,
    /*
     * Issue #240, the interface half. The server half is `ChatPictureTest`, ten
     * tests on both engines over a stub on the loopback address: which endpoint
     * is called, which providers are refused without being called, where the
     * bytes go, what the picture cost.
     *
     * What that cannot say is whether anybody can find it. The assertions worth
     * the whole check are the two about the answer bubble - the picture is drawn
     * *inside* it rather than only listed in the file row above the composer, and
     * it has loaded, which is `naturalWidth` and not the presence of an `<img>`,
     * because a broken picture is an `<img>` too. Then the cost line, which must
     * say four cents and must never say $0.00: an image model reports no tokens,
     * so the ordinary arithmetic makes every drawing free.
     *
     * Not in CI, and the reason is one thing. Every other chat check stubs the
     * provider inside the browser; this one cannot, because the drawing happens
     * on the server from a mutation and a stub in the page would be a check of
     * the stub. It needs something answering `/images/generations` that the
     * *server* can reach - `scripts/suite/image-stub.py`, a dozen lines and a red
     * square, named in ORKNUX_IMAGE_STUB - and the CI installation is a
     * container with nothing beside it. Closing that gap means a service in the
     * browser job's compose file, which is a change to how CI is built rather
     * than to this check.
     */
  },

  {
    name: 'speech-chunking-check',
    what: 'what one answer costs to read aloud on each of the three things a workspace can say about cutting it',
    needs: ['workspace'],
    /*
     * The other side of #263. Reading became pipelined and the pieces became
     * sentences, which is the right answer for somebody holding a hands-free
     * conversation and the wrong one for somebody listening to a written
     * answer: they hear the join between every sentence and pay for a request
     * behind each one. It is a listening preference rather than a fact, so the
     * workspace says.
     *
     * The assertion that earns it a place is a count on the wire, and
     * deliberately not the setting read back. Reading it back proves it
     * persisted, which the server's own test already says and which a page that
     * saved the value and went on cutting at sentence ends would also pass. The
     * same answer read three times has to cost one request under None, one per
     * paragraph under Paragraph, and more than either under Sentence - and
     * nothing but a setting that reaches the speech provider produces that.
     *
     * Beside it: all three read the same words in the same order. A mode
     * decides where an answer is cut and never what is in it, and a chunking
     * that dropped a paragraph or read one twice would sail through the counts.
     *
     * The model, the three chats and the workspace's own setting are put back
     * afterwards.
     */
  },
  {
    name: 'agent-jump-check',
    what: "the ways out of an agent's settings to the model, catalogs, tools and servers it names",
    needs: ['workflow'],
    /*
     * Issue #251, filed as "yet another missing link in agent settings" - and
     * the "yet another" is why this drives all five rather than the one that
     * was reported. Every other form that names a definition had been given the
     * mark, one report at a time; this one named a model, three kinds of grant
     * and an MCP server, and pointed at none of them.
     *
     * Two assertions could not be taken on trust. A grant row is a checkbox in
     * a label, so it presses the mark and asserts the grant did not change - a
     * link put inside that label would turn going to read what a tool does into
     * granting it. And it follows a memory catalog's mark to the end, because a
     * catalog is not a page of its own: the link carries which one it means,
     * and the screen at the other end has to open on that one rather than on
     * whichever is first.
     *
     * Both frames, for the reason agent-grants-check gives - the two marks that
     * sit beside a label are painted with class names the frame hands in, so a
     * frame that forgot one is a form with no way out in half the places it is
     * shown. It makes one MCP server to name and removes it; the agent is never
     * saved.
     */
  },
  {
    name: 'model-window-check',
    what: "a model's context window: set on the screen the refusal names, and read by what refused",
    needs: ['workspace'],
    /*
     * Issue #252. The application told people to set a context window on a
     * screen that could only print one - `updateModel` had been in the schema
     * the whole time with no form behind it - so a model discovered from a
     * provider, or added before anybody knew the number, was stuck at nothing
     * and every agent on it fell back to the built-in allowance.
     *
     * The assertion the rest is scaffolding for is the last one: the same model
     * is asked for a session memory budget before and after, and it has to come
     * back refused first, in the sentence that names this screen, and worked
     * out afterwards against the window that was typed. A form that stored this
     * somewhere of its own would pass everything else here.
     *
     * The other one worth having is that the model's prices survive the save.
     * `updateModel` replaces a model's details rather than patching them, so a
     * card that sent only its own two fields would silently clear the three it
     * does not show. It makes a provider and a model of its own and removes
     * them.
     */
  },
  {
    name: 'agent-grants-check',
    what: "an agent's grants: bounded, searchable, and explained behind a (?), on the page and in the panel",
    needs: ['workflow'],
    /*
     * Issues #172 and #173 over the same twenty rows of markup, so one check
     * rather than two runs of the same form.
     *
     * It measures both frames, which is the half that could not be taken on
     * trust: #149 made the settings page and the editor's left panel one
     * `AgentForm`, and the panel is 441px against the page's 1070px - a cap
     * that leaves one readable can leave the other a wall. Every assertion is
     * made twice, once in each.
     *
     * The bound is measured against what the rows wanted rather than against a
     * number: 1638px of tools inside a 240px box. Where a workspace has too few
     * tools or MCP servers to prove that with, it makes its own, and it sweeps
     * both those and any an earlier killed run left behind. It never presses
     * Save, so the agent it drives is read and not written.
     */
  },
  {
    name: 'param-panel-check',
    what: "the function editor's details panel: the row, the notch colour, the mark",
    needs: ['workspace'],
  },
  {
    name: 'leave-guard-check',
    what: 'the function editor asks before unsaved work is walked away from, and only then',
    needs: ['workspace'],
    /*
     * Builds and deletes a scratch function of its own, so no function anybody
     * else's check reads is edited by running this - and sweeps the ones an
     * earlier run was killed before deleting.
     */
  },
  {
    name: 'leave-guard-editors-check',
    what: 'the object, tool and skill editors ask the same, and only then',
    needs: ['workspace'],
    /*
     * Issue #138's other two editors, and the skill editor #159 found had been
     * left out of that list. Builds and deletes a scratch tool, object and
     * skill of its own - and sweeps the ones an earlier run was killed before
     * deleting - so nothing anybody else's check reads is edited by running it.
     * The same drill three times, because a guard that behaves differently on
     * pages of the same shape is three guards.
     */
  },
  {
    name: 'leave-guard-load-check',
    what: 'all four editors are clean the moment they have loaded, before anything is touched',
    needs: ['workspace'],
    /*
     * Issue #175. The two checks above assert the untouched case and both
     * passed while the function and tool editors were rewriting the code column
     * on load - because the components they build agree with their own details
     * panel, and nothing anybody actually stores does. So this one builds
     * components that do not: a function with two externals and a hand-written
     * parameter list, a tool whose parameter names an object. Built and deleted
     * over GraphQL, and swept when an earlier run was killed before deleting.
     */
  },
  {
    name: 'issue-leave-guard-check',
    what: 'an issue being written survives the workspace picker, or is asked about before it does not',
    needs: ['workspace'],
    /*
     * Issue #234. The form was the one editor in the product with no guard on
     * it, and the picker is the one exit no click listener can see - so this
     * drives the picker rather than a link, and measures the corner as well as
     * the address: a question answered with Cancel used to leave the select
     * naming a workspace nobody was in.
     *
     * Needs a second workspace to switch to and says so rather than passing
     * quietly when there is only one. Files and deletes issues of its own in
     * both, and sweeps what an earlier killed run left in either.
     */
  },
  {
    name: 'issue-label-guard-check',
    what: 'a label added to an issue and saved leaves nothing to be warned about',
    needs: ['workspace'],
    /*
     * Issue #282, and it is the guard's comparison rather than its exits. The
     * labels are a set the server hands back sorted and the box appends to what
     * is on screen, so comparing them position by position reported an issue as
     * unsaved for as long as it stayed open whenever a label was added that did
     * not sort last - and reopening it, which takes both sides from the same
     * answer, said nothing, which is what made it read as a ghost.
     *
     * Two labels are driven rather than one, because a label that sorts last
     * never reproduced it and a fix asserted only against that would pass
     * without doing anything. The third case adds a label and does not save it:
     * a comparison loose enough to end the false warning must not be so loose
     * that it stops noticing a real change.
     */
  },
  {
    name: 'validate-status-check',
    what: 'the Validate status says what it checked, beside the button that checks it',
    needs: ['workspace'],
    /*
     * The status read "Not checked yet." in a footer, and the owner asked what
     * it meant. It is measured on all four editors that have a Validate button,
     * in all three of its states, and the distance to the button is measured in
     * pixels rather than read off the markup - "beside" is a distance. The
     * function editor's two panel paragraphs, moved behind a (?) on their
     * headings in the same pass, are asserted here too, along with the
     * "Open Variables" link that stayed in the open because a (?) that swallows
     * a navigation control makes the control unreachable.
     */
  },
  {
    name: 'split-check',
    what: "the function editor's split drags, survives a reload, and remeasures Monaco",
    needs: ['workspace'],
  },
  {
    name: 'typing-race-check',
    what: 'typing fast comes out character for character, and the four things allowed to overwrite it still can',
    needs: ['workspace'],
    /*
     * Issue #198. `CodeEditor` wrote its model back from its `value` prop
     * whenever the two differed, which for an editor is a race rather than a
     * rule: a passive effect runs after paint, so a keystroke landing in that
     * gap left it writing the text from one character ago back over the model
     * and sending the caret home. Typed at 15ms a key, an ordinary line came out
     * as "';n 'o' retu) 4154262ion1787".
     *
     * The delay is the whole point of this one. Playwright's default typing
     * speed is slower than a person's and does not reproduce it - which is how
     * every other check that drives this editor went on passing while real text
     * was being scrambled - so it types at 15ms and compares the whole string.
     *
     * The other half is what a fix could quietly break. Four things legitimately
     * write into this editor through that same prop - the panel rewriting a
     * declaration when a parameter is added, an accepted suggestion, a revision
     * restored from the History panel, another function opened - and all four
     * are driven here, along with the case #175 was about: a load rewrites
     * nothing.
     */
  },
  {
    name: 'tool-signature-check',
    what: "a tool's signature is editable, follows into the code column, and sticks",
    needs: ['workspace'],
    // Builds and deletes a scratch tool of its own, so nothing else is edited.
  },
  {
    name: 'function-run-check',
    what: 'running a function from its editor, with parameters, and reading what came back',
    needs: ['workspace'],
    /*
     * Issue #266. Validate answered whether the parser accepts the text, which
     * is not the question anybody has; this is the one that runs it.
     *
     * What earns it a place is the two halves a "does it work" button gets
     * wrong. The function is granted one of the workspace's variables and the
     * value of it is asserted in what came back, because a run that resolved no
     * grant would still *succeed* and answer wrongly - #142 all over again, on a
     * path that did not exist when #142 was fixed. And the same function is then
     * edited to throw and run again: a panel that can only report success proves
     * nothing, and the reason it prints has to be the sentence a workflow's own
     * run history would have printed.
     *
     * It also reads the audit. A test run is the one execution that leaves no
     * run behind it, so the audit entry is the only thing that can ever say it
     * happened - and a fix that dropped it would be invisible everywhere else.
     *
     * Its own function, variable and catalog, made and deleted over GraphQL, and
     * swept at the start in case an earlier run was killed before it could.
     */
  },
  {
    name: 'rename-declaration-check',
    what: "renaming a function follows into the code, and only where it is the editor's own name to change",
    needs: ['workspace'],
    /*
     * Issue #267. The panel already rewrote the parameter list of the
     * declaration and left the name of the same declaration behind, so a
     * renamed function went on declaring the old name for ever.
     *
     * Three of its four functions exist to watch the *refusals*, which is where
     * a fix like this does damage: a declaration somebody named themselves is
     * never touched, a function that calls itself by name is left whole rather
     * than half-renamed, and opening one whose name and declaration already
     * disagree - the state the defect leaves behind on any installation that has
     * been running - rewrites nothing and opens with nothing to lose. That last
     * one is issue #175's failure in new clothes, so it is asked of the unsaved
     * dialog and of the browser's own beforeunload, exactly as #175's check asks
     * it.
     */
  },
  {
    name: 'import-await-check',
    what: 'the editor says an imported function hands back a promise, and minds a missing await',
    needs: ['nothing'],
    /*
     * A function is stored as `export default async function` and an imported
     * one is called directly, so `imports.f(1)` is a promise - and it was
     * annotated as the bare return type. `const x = imports.f(1)` compiled
     * clean and handed somebody a promise at run time, which is worse than
     * either an error or silence.
     *
     * It drives nothing, because there is nothing to drive: `importTypes` is
     * imports in and a declaration file out, and the thing worth asserting
     * about that file is what TypeScript makes of it. So it compiles a call
     * against the declaration twice, with `await` and without, using the
     * options `components/monaco.ts` gives the editor - the same compiler
     * reaching the same verdict a hover would have shown.
     */
  },
  {
    name: 'active-badge-check',
    what: 'pressing Active/Inactive keeps the draft on screen, on both editors that draw it',
    needs: ['workspace'],
    /*
     * Issue #155. The badge sent `setEnabled` and put the whole answer through
     * the same `apply()` the page loads with, so a draft in the code column was
     * replaced by the stored copy the moment somebody pressed it. #138's leave
     * guard is about navigating and does not fire here - correctly; a press is
     * not a navigation.
     *
     * Measures the tool editor and the skill editor, which drew the same badge
     * over the same shape of draft. It asks the tool editor whether it is still
     * dirty afterwards and does not ask the skill editor, because the skill
     * editor has no leave guard to ask - #138 never named it. Builds and deletes
     * a scratch tool and a scratch skill of its own, and sweeps the ones an
     * earlier run was killed before deleting.
     */
  },
  {
    name: 'preferences-check',
    what: 'User Preferences reaches its own end and leaves room under it',
    needs: ['session'],
  },
  {
    name: 'chat-cost-check',
    what: 'the switch that puts what an answer cost beside how long it took, off until it is turned on',
    needs: ['session'],
    /*
     * The other half of #227. The number is the server's and `ChatCostTest`
     * pins it - onto the answer, added up over an agent's rounds, costed at the
     * model's prices and left uncosted where it has none. What that cannot see
     * is the control.
     *
     * The assertion that earns it a place is the second visit, in a browser
     * context that has never seen the first: a setting kept in local storage and
     * a setting kept on `app_user` look identical after a reload, and only a
     * fresh cookie jar tells them apart. That distinction is the reason this is
     * a column at all, so it is the one worth a check. Beside it, that the
     * switch starts off - the issue asked for a setting to turn the cost on -
     * and that the explanation of which rounds are counted is behind the (?)
     * rather than printed under the label, measured by the label being drawn on
     * one line.
     *
     * Alice's switch is put back off at the end.
     */
  },
  {
    name: 'chat-total-check',
    what: "a chat's own total growing across two turns and still being there after a reload",
    needs: ['model'],
    ci: false,
    /*
     * The half of the running total that no test on the server can reach.
     * `ChatCostTest` pins the arithmetic - added up across turns, both takes of
     * a regenerate counted, a refused turn adding nothing, an agent's rounds in
     * - and every one of those assertions would pass just as well against a
     * total held in the tab, which is precisely what this replaced.
     *
     * So the assertion that earns it a place is the reload: the page is loaded
     * again from nothing and the same figure is read back off it, to the token.
     * Beside it, that a second turn adds to the number rather than replacing it,
     * which is the difference between a running total and what was there before
     * - `lastSpend` drew the newest answer's cost on the same line, so the
     * figure went up and down as the conversation went on while reading like a
     * bill. And that a chat nobody has spoken in draws no line at all: nought
     * means not recorded, and #227 got that right on the answer.
     *
     * `needs: ['model']` for the reason `chat-regenerate-check` gives - nothing
     * in the API writes a turn into Spring AI's store, so an answer needs a
     * model that answers, and CI has none. It makes its own two chats, deletes
     * them, and puts alice's switch back off.
     */
  },
  {
    name: 'loader-check',
    what: 'a slow load shows the mark, a finished one hides it, an empty list says so',
    needs: ['fixture'],
    /*
     * "executions list never settled" was the check's own fixture assumption,
     * not the screen's fault. It leaned on a sentence about one database -
     * *this workspace's runs are all older than a day, so the default range
     * loads to an empty list* - and waited for "No runs match those filters."
     * on a workspace whose runs are recent enough to be drawn. It settles on
     * either answer now, and makes its own empty list by answering the query
     * with nothing, so the half about a list that finished and has none in it
     * is measured rather than hoped for.
     *
     * What is left of the fixture is one run to open a detail screen on, which
     * the seed starts eight of. With none, it says so and fails on that rather
     * than throwing.
     */
  },
  {
    name: 'run-graph-check',
    what: "the run's graph stays on the canvas, including while the run is read again",
    needs: ['fixture'],
    /*
     * Issue #235, and the order it forces. The report is that the graph is
     * sometimes empty on load, which is a race - twice in twenty cold loads
     * here - so waiting for it would be a check that certifies nothing. What
     * this drives instead is the thing the race is between: reading the run
     * again replaced every node object, React Flow dropped every measurement it
     * had, and an unmeasured node is drawn `visibility: hidden`. That blanked
     * the whole graph for a frame every single time, and it is the frame after
     * it that is up to the machine.
     *
     * So it watches the canvas every animation frame across a Refresh rather
     * than reading it once when the dust has settled. Needs one run with steps
     * in it, which it finds rather than starts.
     */
  },
  {
    name: 'graph-lines-check',
    what: 'the lines between the boxes stay drawn, on the run page and in the editor',
    needs: ['fixture', 'workflow'],
    /*
     * Issue #259, and what #235 and #242 left behind. Those two were about a
     * node React Flow had no measurement for, which it draws invisible, and
     * both were fixed by saying how big a node is before anything measures one.
     * A line is not drawn from a node's size, though - it is drawn from where
     * the node's handles are, which React Flow carries across a rebuild only
     * for a node whose object says `measured`. So the boxes came back and the
     * lines did not: every step on the canvas and nothing joining any of them,
     * which is what was reported.
     *
     * The same race decides whether it recovers, so what is driven is the thing
     * the race is between - the frame in which the lines are not drawn, which
     * happened on every read of a run and every Discard in the editor before
     * the fix. Watched every animation frame, on both canvases, because one
     * page's fix has twice now not been the other's.
     *
     * How many lines to expect comes from the run rather than the canvas: a
     * canvas drawing none would otherwise agree with itself.
     */
  },
  {
    name: 'issue-types-check',
    what: 'a workspace adds a type, the list filters by it and by Untyped, and one in use will not delete',
    needs: ['workspace'],
    /*
     * Issue #241. A type is the one thing about an issue that a label could not
     * have been: a set cannot say "exactly one", and a label exists only while
     * an issue carries it, so there was nothing for a settings page to hold.
     *
     * The refusal is what this drives in a browser rather than leaving to the
     * server tests. The whole of it is that an administrator is told before and
     * after - the count sits on the row, and the sentence that comes back names
     * how many rather than being rephrased into "Could not delete" on the way
     * through the page. Both of those are the interface's to get wrong.
     *
     * Untyped is asked for as well, and deliberately: it is the state most of a
     * tracker is in on the day types arrive, and a filter that could only say
     * "this type" or "never mind" would have left it unaskable.
     */
  },
  {
    name: 'delete-issue-check',
    what: 'the trash asks before it deletes, and the issue is really gone after',
    needs: ['workspace'],
  },
  {
    name: 'remove-comment-check',
    what: 'a comment comes off a thread, without the question quoting it back or the history losing it',
    needs: ['workspace'],
    /*
     * Issue #276. Three of its assertions could not be made anywhere but in a
     * browser, and the server suite already covers everything else.
     *
     * The dialog must not repeat what the comment said. That is a product
     * decision invisible to any test of the mutation, and it is the one most
     * likely to be undone by somebody making the question "clearer": the reason
     * a comment is usually being removed is that those exact words should not be
     * in front of anybody.
     *
     * The history entry must read as a removal. `said()` falls through to
     * "commented" for a kind nobody wrote a sentence for, so an unhandled event
     * renders as the opposite of what happened, perfectly, with no error
     * anywhere. It is counted rather than matched - one comment is left, so one
     * "commented" line - because the fallthrough produces a second one.
     *
     * And the words are asked for again over GraphQL after the fact, as the
     * whole issue, so a tombstone the interface merely hides fails here while
     * passing everything about the thread.
     *
     * Files and deletes an issue of its own, and sweeps what an earlier killed
     * run left behind.
     */
  },
  {
    name: 'new-issue-blank-check',
    what: 'a new issue starts empty however it was reached, and a run of them still keeps its labels',
    needs: ['workspace'],
    /*
     * Issue #238: Quick actions opened the new-issue form filled in with the
     * issue that was being read. Everything here is driven through the palette
     * rather than through an address, because that is the only way to reproduce
     * it at all - the defect lives in one running page, and a reload mounts a
     * clean one.
     *
     * The three "File another" assertions look like they belong to another
     * check and do not: they are what stops this one being fixed by clearing
     * the form on mount, which would take the labels off the second issue of a
     * run somebody is filing. Both halves have to be held at once.
     *
     * Files and deletes issues of its own, and sweeps what an earlier killed
     * run left behind.
     */
  },
  {
    name: 'workflow-list-check',
    what: 'the workflow list shows X at a time and orders the whole list, not the page',
    needs: ['workspace'],
    /*
     * It tops the workspace up to twelve workflows of its own and removes them
     * again, so the only thing it wants from the fixture is runs: two workflows
     * that have run, so that "by last run" has something to put in order and a
     * never-run row to keep last. The seed runs two, so this is in.
     */
  },
  {
    name: 'workflow-header-check',
    what: 'the workflow list orders and acts on one header row, and its columns name workflows',
    needs: ['workspace'],
    /*
     * Issue #174, and the assertion at its centre is a measurement rather than
     * a photograph: the sort control and the four buttons beside it have to
     * share a row, which is their vertical centres inside two pixels of each
     * other. Wants only workflows the workspace already has - two of them, so
     * that reversing the order has something to reverse.
     */
  },
  {
    name: 'removed-workflow-check',
    what: 'a run of a removed workflow can be filtered to, and its workflow is named rather than linked',
    needs: ['workspace'],
    /*
     * Issue #168, both halves against the same run: the Workflow filter offers
     * the workflow the run names even though the workspace no longer lists it,
     * and the row and the run's page name that workflow without offering the
     * editor link that answered "No workflow assignment with id 373". A run of
     * an assigned workflow is measured beside it, because a page that linked
     * nowhere at all would satisfy the first half and be worse than the bug.
     *
     * Its fixture is one workflow it creates, runs once and unassigns - and
     * then finds again on every later run rather than making another. Nothing
     * deletes a run or a workflow definition, so a check that built a fresh one
     * each time would grow the database of every workspace it is pointed at,
     * which is the thing issue #168 was written beside.
     */
  },
  {
    name: 'pagination-footer-check',
    what: 'every paginated list names its own rows, in the footer and in the row of columns over it',
    needs: ['workspace'],
    /*
     * Wants nothing built for it. Every list it opens is one the workspace
     * already has, and the half that matters most - which noun each call site
     * hands the shared footer - is read out of `src/` and needs no database at
     * all. A list the workspace happens to have none of is allowed to draw no
     * footer, but only two of them, so an empty workspace cannot pass this.
     */
  },
  {
    name: 'catalogue-failure-check',
    what: 'a catalogue that failed to load says so, where an empty one says it is empty',
    needs: ['workspace'],
    /*
     * Issue 139. Needs nothing of the catalogues it is about: it answers their
     * queries itself, once with an empty list and once with an error, and reads
     * what each of three screens says about each. The whole fixture is a
     * workspace with an agent in it - the seed makes two - and an administrator
     * to open the admin half, so it runs in CI.
     */
  },

  {
    name: 'session-pages-check',
    what: 'the sessions list narrows, a transcript filters and reorders, and a session takes two presses to remove',
    needs: ['workspace'],
    /*
     * Issue #158. Both pages were built by #119 and neither was opened by
     * anything here; `screenshots.mjs` photographs them for the manual, which is
     * why they looked covered.
     *
     * It builds its own fixture the only way a session can be built - there is
     * no mutation that makes one, and there should not be: a session exists
     * because an agent node carrying a `sessionKey` ran. So it makes a scratch
     * workflow of a session node wired to whichever agent has a model, runs it
     * three times over two keys, and removes the sessions and the workflow
     * afterwards.
     *
     * 'workspace' rather than 'model', because it does not need a model that
     * answers: the question is written into the session before the model is
     * asked and an answer that never comes is recorded as a system note, so the
     * transcript holds two kinds either way. Which two is read back off the
     * server and every assertion is made against that, so the check says the
     * same thing here and in CI.
     *
     * The one thing it cannot sweep is the three executions the runs leave -
     * nothing removes an execution, and `removeWorkflow` leaves them behind.
     */
  },

  {
    name: 'chat-copy-check',
    what: "the copy control under the message it copies, on the bubble's edge and not the column's",
    needs: ['workspace'],
    /*
     * Reads the chat the seed builds, found by title rather than by id. It
     * asserts two things about one control because either alone passes for the
     * wrong reason: under the bubble, and sharing its right edge. The third is
     * that hovering reveals it, since a control that is always drawn would pass
     * the first two without anything having been fixed.
     */
  },
  {
    name: 'chat-copy-answer-check',
    what: 'the sent message and the answer hide and show their copy control by the same rule',
    needs: ['model'],
    ci: false,
    /*
     * The other half of issue #188, split off because it needs an answer to
     * measure and the check it came from does not.
     *
     * On 2026-08-22 this was one check, and the first CI run of the browser job
     * failed it: a seeded installation has no model it can reach, so its chats
     * are a question with nothing after it, and the wait for `Copy this answer`
     * timed out and reported the *sent* control as broken. Three assertions
     * that CI can prove were being lost to a fourth it never can.
     *
     * Naming the gap rather than hiding it: nothing unattended proves the
     * answer side. Closing it needs a fixture with a stored answer, which needs
     * either a model CI can reach or a way to write a turn without one.
     */
  },
  {
    name: 'chat-regenerate-check',
    what: 'asking the last answer again, and the answer it replaced still being there',
    needs: ['model'],
    ci: false,
    /*
     * Issue #245. The assertions are mostly about the *old* answer, because
     * that is the part a regenerate is easy to get wrong: take the answer off
     * the thread, put a new one there, and the answer somebody was about to
     * keep is gone with nothing to go back to. It steps back to it, and then
     * reloads and steps back to it again - which is what tells a take kept on
     * the server from one held in a tab.
     *
     * `needs: ['model']` for the reason `chat-copy-answer-check` gives: there
     * is no way to put an answer into a chat without one, since the thread is
     * Spring AI's store and nothing in the API writes a turn to it. What CI
     * does cover is the server half, in ChatRegenerateTest, on both engines.
     *
     * It was driven against a stub answering the OpenAI shape, whose every
     * answer is numbered - two answers to one question are otherwise
     * indistinguishable, and "the answer changed" is the assertion.
     */
  },
  {
    name: 'row-action-cursor-check',
    what: 'every icon control in a workflow row says it is clickable',
    needs: ['workspace'],
    /*
     * Reads every control in the Actions column rather than the one that was
     * reported. The fault was the shared class, not the button: two of the
     * three were wrong and the third only looked right because it is an
     * `<a href>`. Naming what it found means a fourth control added later is
     * covered without anybody editing the check.
     */
  },
  {
    name: 'prompt-padding-check',
    what: 'the system prompt box and the description box agree about their padding',
    needs: ['workspace'],
    /*
     * Agreement rather than a number, which is what issue #190 asked for: a
     * change to the shared class moves both and this still passes, while a
     * change that moves one of them is the bug it was written for. It measures
     * box edge to first line as well as the padding, because a box that centres
     * its contents pads correctly and still reads wrong - which is exactly what
     * was happening.
     */
  },

  // --- connections and transfer ---------------------------------------------
  {
    name: 'secret-reveal-check',
    what: 'one eye for every stored credential, and it hides again',
    needs: ['workspace'],
    /*
     * Issue #191. It asserts the three things that were wrong rather than that
     * a control exists: no text on it, an accessible name that changes with the
     * state, and a second press that puts the secret away - which the provider
     * and MCP forms could not do at all. It reads the variables page beside
     * them, since agreeing with that page is the whole request and a check that
     * only read what changed would pass while the two drifted apart again from
     * the other side.
     */
  },
  {
    name: 'provider-credential-check',
    what: "a provider's key is its own or a workspace secret it reads, and the two do not spill into each other",
    needs: ['workspace'],
    /*
     * Issue #232, and where the choice ended up. It was a pair of tabs above
     * the Authentication card, which reads as a mode of the card; it is a
     * property of the one field it decides, so the placement is measured here
     * too - the tabs inside the field block, on the label's own line, directly
     * above the single control that block draws, and named after that field. A
     * provider has one secret column and a Slack connection has two, and a
     * card-level mode has nothing to say about the second.
     *
     * The dangerous half is not the new field, it is the old one:
     * "a key is stored, leave it alone" is a null secret behind a row of dots,
     * and every way of offering a variable instead has a way of turning that
     * into "clear the key". So the credential is read back off the server after
     * every move - created, renamed, moved to a secret, moved back - and the
     * stored key is compared byte for byte with what was typed rather than
     * inferred from a boolean.
     *
     * One state is put in front of the page rather than made: a reference
     * pointing at nothing has no route through the API, and the check asserts
     * that as well, by trying both of the deletions that would produce one and
     * measuring the refusals. What it then reads is the real answer with the
     * flag the server sets on a reference it could not resolve.
     *
     * Its own catalog, variables and providers, all under a scratch name, swept
     * at both ends of the run.
     */
  },
  {
    name: 'connection-credential-check',
    what: "each of a connection's credentials choosing its own source, without either touching the other",
    needs: ['workspace'],
    /*
     * Issue #244. #232 gave the choice to a model provider, which has one
     * secret column - so a choice made once for the card and a choice made once
     * for the field were the same thing there, and it was impossible to tell
     * which had been built. A Slack connection holds two credentials, and no
     * single switch can say that the bot token is a workspace secret while the
     * app-level token is the connection's own. That sentence is what this
     * drives, in both directions, reading the result back off the server.
     *
     * The dangerous half is the field that was already there. "A token is
     * stored, leave it alone" is a null secret behind a row of dots, and every
     * arrangement that lets somebody point the *other* field at a variable has
     * a way of turning that into "clear the token" - so a save that touches
     * neither credential is asserted to leave both, and the stored one is
     * compared byte for byte with what was typed rather than inferred from a
     * boolean.
     *
     * Its own catalog, variables and connection, all under a scratch name,
     * swept at both ends of the run.
     */
  },
  {
    name: 'slack-connection-check',
    what: 'one Slack connection type, made through the dialog and finished on its page',
    needs: ['workspace'],
  },
  {
    name: 'slack-target-check',
    what: 'both places a Slack target is typed offering what the connection can see and saying what it makes of it, and neither refusing anything',
    needs: ['workspace'],
    /*
     * Issue #176's checking half. `slackTarget` answers three ways and the
     * whole risk is drawing them alike: `NOT_FOUND` is advice - a private
     * channel this bot was never invited to looks the same as a typo from where
     * the server is standing - and `UNCHECKED` is not about the typing at all.
     *
     * The assertions that earn it a place are the ones no screenshot shows. It
     * measures the colour `NOT_FOUND` is painted against an element painted
     * `--color-danger` on the same page, and it presses Save over one and reads
     * the saved action back: the server keeps a test pinning that the field is
     * free text, and an interface that greyed the button out would contradict
     * it silently. It holds an answer back and edits the field underneath it,
     * because a reply about text that has since changed is the same lie as a
     * reading a keystroke behind. And it measures the top of the Create Action
     * button across the shortest and longest answers there are.
     *
     * One leg runs against the real server with nothing intercepted - a Slack
     * connection with no bot token is answered in one sentence without anything
     * having to reach slack.com - and that is what keeps the query, its
     * variables and the schema honest. The three outcomes themselves are forced
     * in the browser, because being found needs a Slack workspace to be found
     * in. Its connections and its action are its own, and swept at the end.
     *
     * Every one of those claims is then made a second time against the workflow
     * editor's node panel, which is where the report came from: the form
     * defines a send, a node binds the target of one step of it, and the panel
     * said nothing at all. The box is one component now, so the second surface
     * is what keeps it one - a shared piece of code nothing reads twice proves
     * nothing. Two claims are only about the panel. A parameter on the
     * Reference tab is read out of the run, so there is nothing to check before
     * the run and no box is drawn; and `target` is only a Slack channel when
     * the action behind the node sends through a Slack connection, which it
     * proves against a send through a mail server that has the same parameter
     * under the same name. It makes its own workflow and takes it away again.
     *
     * The suggesting half is the rest of #176 and is checked in the same file,
     * because it is the same field: `slackSuggestions` offers what the
     * connection can see against what has been typed so far, on both surfaces,
     * by the same component. The claims that earn their place are the ones a
     * picker gets wrong. A truncated list is asked for and the server's line
     * about being truncated is read off the screen, verbatim and at the head of
     * the list, where it cannot be scrolled past - a list that quietly leaves
     * things out teaches somebody it is the whole of what exists. An
     * `UNCHECKED` draws the reason and no rows, an empty list being the one
     * thing an unchecked answer does not know. It types something in no list,
     * keeps it and saves it. It takes a row by keyboard and by pointer, and
     * proves the check goes quiet afterwards by counting the questions that
     * reach the wire, because two answers saying the same thing under one field
     * is what the first round of this was rejected for. And it measures the
     * Create Action button and the next parameter under the longest list there
     * is: a list that pushed the form down would move the button somebody is
     * reaching for.
     */
  },
  {
    name: 'connection-share-check',
    what: 'the connection page offers no Share card and no "Export as default"',
    needs: ['workspace'],
    /*
     * A negative, so it is worth saying what stops it passing for free. It
     * signs in as an administrator and asserts that it did - the card was
     * behind `session.admin`, so an ordinary member would find it missing
     * either way - waits for the form to draw, and checks the Danger Zone
     * below it is still there. It makes its own connection and removes it.
     */
  },
  {
    name: 'import-leave-out-check',
    what: 'Leave out is offered on what a file carries, and takes dependants with it',
    needs: ['workflow', 'fixture'],
    /*
     * In. It pressed `Leave out Send Slack Message`, which names a component of
     * one developer's workflow #118, and imported into workspace 24 on the
     * grounds that 24 was empty on that machine. It reads the action's name out
     * of the envelope it just downloaded, takes whichever workflow here
     * actually carries an action, and finds the empty workspace by the name
     * `fixture.mjs` gives it - so it needs that to have been run, which is what
     * 'fixture' says.
     *
     * Its last assertion moved with the same fix: "the left-out action was not
     * created" was written as `actionsAfter === actionsBefore`, which is only
     * true of a workflow carrying exactly one action. It names the one that was
     * left out and looks for that.
     */
  },
  {
    name: 'import-refresh-check',
    what: 'the workflow list agrees with its own footer after an import and after a switch',
    needs: ['fixture'],
    // Needs a second, bigger workspace to switch away from: ORKNUX_BIGGER_WORKSPACE
    // and ORKNUX_BARE_WORKSPACE.
  },

  // --- tasks -----------------------------------------------------------------
  {
    name: 'task-check',
    what: 'a task started from the page, its event log filling up, and it reaching an end that says why',
    needs: ['workspace'],
    /*
     * Issue #229. 'workspace' rather than 'model', and for the reason the
     * session check gives: it does not need a model that *answers*. The prompt
     * is written into the task's log before the model is asked and a model that
     * never answers is recorded as a note saying so, so the log holds lines
     * either way and the task still reaches a legible ending. Everything about
     * stopping for permission needs a real judgement and is next door.
     *
     * It makes its own model, pointed at `.invalid`, and removes it - a seeded
     * installation has none, and one that borrows whatever is there says a
     * different thing on every machine.
     */
  },
  {
    name: 'task-live-check',
    what: 'a task watched while it runs and thinks, lines arriving on a page nobody reloaded, and the same account afterwards',
    needs: ['workspace'],
    ci: false,
    /*
     * The live half of #229's page, and the thinking half that came after it.
     * `task-check` next door proves the machinery around a task; this one
     * proves the *while*, which is the thing a check that only reads a finished
     * log cannot say anything about.
     *
     * Four assertions carry it, and they are written to fail rather than to
     * quietly stop meaning anything. There is no refresh control on the page,
     * so growth cannot be a poll. A marker on `window` survives, so growth
     * cannot be a reload. The line count and what the page says it is doing are
     * read in one evaluate, so "a line was there while it said Working" is one
     * moment rather than two readings a tenth of a second apart. And the count
     * of how long the model has been thinking is read, waited on and read
     * again - the shape `chat-working-check` was rebuilt around, because "the
     * thinking is drawn" would pass just as well on a build that painted all of
     * it in one go at the end.
     *
     * **It used to say 'workspace' and mean it, and that was the bug.** The
     * fixture was a model pointed at `.invalid`, on the reasoning `task-check`
     * gives: the prompt is written into the log before the model is asked, so
     * the session gets lines either way. True, and not enough. Measured, such a
     * task is forty milliseconds end to end and writes three lines, so there is
     * no "while" to catch - the page usually draws after it is already over,
     * and where it does not, everything left arrives inside one frame. What
     * used to be here was a retry loop that started up to four tasks hoping to
     * catch one running; the first time this check was ever executed it lost
     * that lottery four times out of four.
     *
     * So the fixture is a model that takes its time, which is also the only
     * kind that has any thinking to draw. `scripts/suite/reasoning-stub.py`
     * emits `reasoning_content` over twelve seconds and then calls `task_done`.
     * It cannot be stubbed in the browser, for the reason `image-model-check`
     * gives about its own: the thinking is produced by the server calling a
     * provider, written into the task's session and followed over a stream, so
     * a stub in the page would be a check of the stub.
     *
     * That is what `ci: false` costs and buys. CI keeps `task-check`, which
     * proves a task's machinery and needs nothing; what it gives up is a check
     * that could only ever have passed by luck. Run this by hand:
     *
     *   python scripts/suite/reasoning-stub.py 8198
     *   node scripts/suite/run.mjs --only task-live-check
     *
     * Where the stub is, as the server reaches it, goes in
     * ORKNUX_REASONING_STUB.
     */
  },
  {
    name: 'task-message-check',
    what: 'a message typed at a task while it works, read on the next turn, and the work finishing in the shape it asked for',
    needs: ['workspace'],
    ci: false,
    /*
     * Issue #280. The third thing a person can do to a task, after answering
     * what it asked and stopping it: change what is wanted while the work is
     * going on, without stopping it and starting a new one with a better
     * prompt.
     *
     * `ci: false` for exactly the reason `task-live-check` next door is, and
     * measured the same way: a model pointed at `.invalid` fails a task in
     * forty milliseconds, so a check written against one would be typing into a
     * page that had finished before it loaded. There would be no *while*, which
     * is the whole of what this check is about.
     * `scripts/suite/message-stub.py` is a model that spends twenty-four
     * seconds on its first round and calls `task_done` on the round the message
     * reaches it. It cannot be stubbed in the browser: what is being checked is
     * that words typed into a page reach a model the *server* is talking to,
     * and a stub in the page would be a check of the stub.
     *
     * Six assertions, and the last two are the ones that would catch a build
     * that had recorded the message beautifully and never shown it to anybody.
     * The message has to reach the *model* - the stub only ever finishes on a
     * round that carries it, and says so in its summary - and the box has to be
     * absent once the task is over, because a box that takes words nothing will
     * ever read is worse than no box. In between, the page has to stop drawing
     * the message as unread without reloading, which is what says the live view
     * learnt about messages rather than only about statuses.
     *
     * Run it by hand:
     *
     *   python scripts/suite/message-stub.py 8199
     *   node scripts/suite/run.mjs --only task-message-check
     *
     * Where the stub is, as the server reaches it, goes in ORKNUX_MESSAGE_STUB.
     */
  },
  {
    name: 'issue-start-by-ai-check',
    what: 'Start by AI on an agent-assigned issue, and the link from it to the task',
    needs: ['workspace'],
    /*
     * Issue #230. 'workspace' and not 'model', for the reason `task-check`
     * gives: the prompt is written into the task's log before the model is
     * asked, so everything this asserts - the control appearing only where an
     * agent has the issue, the issue moving to In progress, the link standing
     * where the button was, and the prompt on the other end of it being the
     * issue - is true whether or not anything ever answers.
     *
     * It builds its own provider, model, agent and two issues and takes all of
     * them away again. The seeded fixture has no model at all, and one that
     * borrowed whichever agent happened to be there would say a different thing
     * on every installation.
     *
     * The second issue - the one assigned to nobody - is half the check rather
     * than a flourish. "Start by AI appears when an agent is assigned" is a
     * statement about where it does *not* appear as much as where it does, and a
     * check that only ever looked at the agent-assigned one would pass a control
     * drawn on every issue in the tracker.
     */
  },
  {
    name: 'task-permission-check',
    what: 'a task stopping for permission, saying so, ringing the bell, and carrying on once it is granted',
    needs: ['model'],
    ci: false,
    /*
     * The other half of #229, and it cannot be run unattended: what it asks a
     * model to prove is a *judgement* - given a job it has no means to do, stop
     * and ask rather than invent an answer - and only a model that answers makes
     * one. CI has none.
     *
     * Naming the gap rather than hiding it. Run it by hand against a server
     * whose model answers:
     *
     *   node scripts/suite/run.mjs --only task-permission-check
     *
     * The assertion that matters most is the last one: the grant lands on the
     * task and the agent's own `shellAccess` is still false. Approving something
     * for one afternoon's work must not arm the agent in every chat for ever,
     * and that is the one thing about this feature that would be a security
     * defect rather than a bug.
     */
  },
  {
    name: 'chat-working-check',
    what: 'a chat drawing what the model thought and what it looked up, and keeping neither inside the answer',
    needs: ['model'],
    ci: false,
    /*
     * Issues #271 and #272, and it needs a model for the same reason the three
     * above do: there is nothing to watch without one. Not a *good* model,
     * though - what it needs is one that emits reasoning and asks for a tool,
     * which is a property of the provider rather than of the answer. So the
     * assertions about text are deliberately weak, and the one that matters is
     * not about text at all: that the thinking is drawn *outside* the answer.
     *
     * That is the assertion worth having a check for. Everything downstream is
     * correct because the string it reads does not hold the thinking - the copy
     * control, the speech model and the next turn's prompt all read the
     * answer - so a change that quietly folded the two back together would look
     * perfectly fine in a screenshot and would be a reasoning model read aloud.
     *
     * Run it by hand against an installation whose provider answers the
     * OpenAI-compatible shape with `reasoning_content` and a tool call:
     *
     *   node scripts/suite/run.mjs --only chat-working-check
     */
  },

  // --- the two languages -----------------------------------------------------
  {
    name: 'catalogue-check',
    what: 'the Polish catalogue and the English it is keyed on, still agreeing',
    needs: ['nothing'],
    /*
     * The interface is translated by keying on the English sentence rather than
     * an invented name - `src/i18n/index.ts` says why, and chiefly that a
     * made-up key would have blinded `hint-prose-check` to every sentence in
     * the product at once.
     *
     * The one thing that costs is that rewording an English string orphans its
     * translation, silently: `t` falls back to what it was handed, so the
     * screen shows correct English and the Polish simply stops appearing. This
     * fails on the orphan. It reads the source and nothing else, so it runs
     * anywhere in about a second.
     */
  },
  {
    name: 'language-check',
    what: 'a language switch that reaches the server, redraws the page and moves <html lang>',
    needs: ['session'],
    /*
     * The only check that ever sets alice's language, and it sets it back in a
     * `finally`. Everything else in this suite finds its controls by their
     * English accessible names, which works because English is what somebody
     * who has chosen nothing reads and the fixture chooses nothing - so a run
     * that left her reading Polish would fail every check after it.
     *
     * It asserts the mechanism rather than a snapshot of the words. Which
     * Polish sentence a screen shows is `catalogue-check`'s business and one
     * improved wording away from being wrong; what this cannot be allowed to
     * lose is that the choice survives to the next machine, that the whole
     * application redraws rather than only the button pressed, and that a page
     * nobody touched is in the right language after a reload.
     */
  },

  // --- held back ------------------------------------------------------------
  {
    name: 'tool-wand-check',
    what: 'the wand on the tool editor, and a change accepted where the tool is',
    needs: ['model'],
    ci: false,
    /*
     * Half of this asks a model a question and reads the answer, and it waits
     * two minutes for one. A server that cannot call a model cannot answer
     * that half, and in CI there is no model at all. Run it by hand against a
     * server whose model answers:
     *
     *   node scripts/suite/run.mjs --only tool-wand-check
     *
     * Two things about it were the suite's own dishonesty rather than the
     * gesture's. It printed NOT VERIFIED when no model could be reached and
     * counted nothing, so a server with no model reported this as a pass over
     * an untested half; that is recorded and failed now, saying whose fault it
     * is. And its fourteen verdicts went to a private counter, so a green run
     * announced "ALL PASS (1 checks)" - they are recorded.
     *
     * It also asserted that the model's answer names the tool. A model that
     * replies "What would you like to change about this tool?" has plainly been
     * told what it is looking at, and the check failed on a correct product for
     * a wording nobody controls. What the issue was about is in the request the
     * panel sends, so that is what is asserted; the wording is a NOTE.
     */
  },
];

/** The ones the CI job runs. */
export const inCi = (test) => test.ci !== false;
