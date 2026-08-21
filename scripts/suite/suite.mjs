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
    what: "a line's bend handle moving the line exactly as far as it was dragged",
    needs: ['workflow'],
    ci: false,
    /*
     * Held back on the fixture, not on the behaviour. It selects a line and
     * drags the bend handle that appears on it; the workflow the seed builds
     * has lines, but not one this finds a handle on, so it waits thirty seconds
     * for `Bend this line` and gives up. It passes against a workflow that has
     * one. To let it in: give the seed a workflow with a line the check can
     * select, or teach the check to make its own.
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
    name: 'revision-retention-check',
    what: 'how long component history is kept: typed, saved, reloaded, and zero refused',
    needs: ['session'],
  },

  // --- pages that are pages -------------------------------------------------
  {
    name: 'condition-page-check',
    what: 'the condition editor as a page: create, find, change, reload, jump to its function',
    needs: ['workspace'],
    /*
     * In, and for two reasons that were both about the check.
     *
     * It waited for a link reading "Open definition", and 2df9a15 made every
     * one of those a link mark - the words moved into the title and the
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
    name: 'param-panel-check',
    what: "the function editor's details panel: the row, the notch colour, the link mark",
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
    name: 'split-check',
    what: "the function editor's split drags, survives a reload, and remeasures Monaco",
    needs: ['workspace'],
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

  // --- connections and transfer ---------------------------------------------
  {
    name: 'slack-connection-check',
    what: 'one Slack connection type, made through the dialog and finished on its page',
    needs: ['workspace'],
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
