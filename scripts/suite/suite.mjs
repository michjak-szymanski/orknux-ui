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
    ci: false,
    /*
     * This one is not a fixture problem: it fails against the developer's
     * database too, and for the same reason in both. Its first half still
     * passes - the ports a node was given survive an edit - and its second half
     * waits for a button called `Object` in the node panel, which the panel has
     * not had since the field editor was rebuilt. Half a check that cannot
     * finish is worse than none, so it is out until somebody points that half
     * at whatever replaced the button. The comment at the top of the file says
     * what the two bugs were, and both are still worth catching.
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
    ci: false,
    /*
     * "trigger incoming: the page drew nothing in twenty seconds". The three
     * trigger settings pages it walks did not render against a seeded
     * workspace. Worth chasing rather than assuming a fixture gap - a page that
     * draws nothing is the failure this suite exists to catch - but it needs
     * looking at with a browser open, and it is out until then.
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

  // --- pages that are pages -------------------------------------------------
  {
    name: 'condition-page-check',
    what: 'the condition editor as a page: create, find, change, reload, jump to its function',
    needs: ['workspace'],
    ci: false,
    /*
     * "the workspace has no function to point a condition at". A condition
     * names a function, the picker offers only the ones it can use, and the
     * four the seed builds are not among them. The check is right to refuse
     * rather than pass: it says what is missing. To let it in, the seed needs
     * a function a condition can point at.
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
    name: 'param-panel-check',
    what: "the function editor's details panel: the row, the notch colour, the link mark",
    needs: ['workspace'],
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
    name: 'preferences-check',
    what: 'User Preferences reaches its own end and leaves room under it',
    needs: ['session'],
  },
  {
    name: 'loader-check',
    what: 'a slow load shows the mark, a finished one hides it, an empty list says so',
    needs: ['fixture'],
    // Names issue 117 by number, and needs at least one execution to open.
    ci: false,
    /*
     * "executions list never settled". The seed starts eight runs and every one
     * of them fails, because a runner has no model to call - so the executions
     * screen this waits on is drawn from rows in a state it does not settle on
     * within twenty seconds. What it asserts is worth keeping: a load slow
     * enough to notice shows the mark, a finished one hides it, an empty list
     * says so instead of spinning. It needs a fixture whose runs finished.
     */
  },
  {
    name: 'delete-issue-check',
    what: 'the trash asks before it deletes, and the issue is really gone after',
    needs: ['workspace'],
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
    needs: ['workflow'],
    ci: false,
    /*
     * It presses `Leave out Send Slack Message`, naming a component of the
     * developer's workflow. The seed's workflow carries different ones, so the
     * button it wants is not there. The fix is to read a name out of the
     * envelope rather than write one in - the check already downloads the file
     * it imports, so the name is in its hands.
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
     * two minutes for one. On a server that cannot call a model it says so
     * rather than failing - it asks the doctor first - but that graceful path
     * relies on the doctor reporting unreadable secrets, which is a developer
     * machine's problem and not a fresh CI database's. In CI there is no model
     * at all and the check would fail honestly and uselessly. Run it by hand
     * against a server whose model answers:
     *
     *   node scripts/suite/run.mjs --only tool-wand-check
     */
  },
];

/** The ones the CI job runs. */
export const inCi = (test) => test.ci !== false;
