/**
 * Which checks there are, and what each one needs before it can be believed.
 *
 * The list is here rather than a glob over the folder so that adding a file is
 * a decision: a script somebody wrote to measure something once should not
 * become a test in CI because it happened to be saved in this directory.
 *
 * `needs` is the honest part. Every one of these drives the real interface
 * against a real server, and they differ in what has to be in that server's
 * database first:
 *
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
    what: 'the whole chat composer takes a click, and has not grown its padding back',
    needs: [],
    /*
     * Reported as "the click only activates the input on a narrow area". The
     * box is 54px and the text in it 24, so most of what reads as the field was
     * dead. It asserts the three places somebody actually aims and the box's
     * height, because the padding was cut in the same breath and a check that
     * only proved the clicks would let it grow back.
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

  // --- pages that are pages -------------------------------------------------
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
    name: 'delete-issue-check',
    what: 'the trash asks before it deletes, and the issue is really gone after',
    needs: ['workspace'],
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
     * wrong reason: under the bubble, and sharing its right edge. The third and
     * fourth are the other half of issue #188 - a sent message and an answer
     * were revealed by two different mechanisms, and only one of them was
     * reachable from a keyboard.
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
    name: 'slack-connection-check',
    what: 'one Slack connection type, made through the dialog and finished on its page',
    needs: ['workspace'],
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
