/**
 * Prose in the open, wherever it still is.
 *
 * The report that started this was one checkbox. The workspace settings page
 * had a (?) on the model field and a four-line paragraph under the switch
 * directly below it - the same screen, both conventions - and it was the third
 * such report in twenty minutes. The four checks already in this folder each
 * drive a screen somebody had already converted and assert that particular
 * screen stayed converted; none of them could say anything about the screen
 * nobody had looked at yet, which is where every one of those reports came
 * from. This one is written the other way round: it starts from the whole of
 * `src/` and asks what is left.
 *
 * ---------------------------------------------------------------------------
 * How a paragraph under a field is recognised
 *
 * Not by a list of class names. A list of names is defeated the first time
 * somebody writes `styles.blurb`, and this codebase already spells the same
 * idea eleven ways - fieldNote, fieldHint, settingNote, checkboxHint, paramHint,
 * parameterNote, choiceNote, hint, note, emptyNote, disclaimer.
 *
 * What they have in common is not the name, it is the paint. Every one of them
 * is a rule in a CSS module that sets `color: var(--color-text-muted)` (or
 * -secondary, or -tertiary) together with a font-size below the body's. That is
 * the house style for "small grey words underneath something", and a new class
 * of this kind will be written the same way, whatever it is called, because
 * that is what makes it look like the others.
 *
 * So the first half of the signature is read out of the stylesheets: every
 * class painted muted-and-small. The second half is read out of the JSX: the
 * element's *own* text - not a child's - containing an unbroken run of at least
 * five hard-coded words. That second half is what separates a paragraph from a
 * badge, a column heading or a label: those hold one or two words, or they hold
 * `{value}` and no hard-coded words at all. An explanation is always a sentence
 * somebody typed.
 *
 * And one particular affordance by name: the ⓘ. Five pages carried their
 * explanation in a footer with an info icon beside it - an icon plus prose,
 * which is the same job the (?) does and a second convention for doing it. The
 * icon is looked for directly, because "one affordance for one job" is the
 * whole point and a check that only counted paragraphs would pass a page that
 * moved its paragraph behind a different picture.
 *
 * ---------------------------------------------------------------------------
 * How something is allowed to stay
 *
 * Two tables, and the difference between them is the difference between a class
 * that never explains a field and a call site that happens not to.
 *
 * `NOT_A_FIELD_NOTE` is the first: a handful of classes whose job is to carry a
 * *page's* or a *card's* own sentence. A page subtitle sits under the heading
 * and names the page; a Danger Zone card's message is about the button beside
 * it. Neither is a field's explanation and neither ever will be, so they are
 * excused once by name rather than a hundred times by call site.
 *
 * `IN_THE_OPEN` is the second, and it is the one that matters: every remaining
 * block of prose in the interface, one line each, with a `because` from a fixed
 * vocabulary and a sentence saying why. The vocabulary is the rules file's list
 * of what still belongs in the open, and nothing else is a valid answer:
 *
 *   'status'   the state of the thing being looked at, or the result of
 *              something the reader just did
 *   'error'    an error or a warning
 *   'label'    a sentence that is part of the field's label - a unit, an
 *              option's own name
 *   'in-flight' another agent is converting this file right now; the entry
 *              names them and comes out when they land
 *
 * An entry that names none of those does not compile as an exemption, and an
 * entry whose sentence has left the interface fails as loudly as an unlisted
 * one - so the table cannot rot into a list of screens that no longer exist.
 *
 * This is deliberately not a check that can tell teaching from status by
 * itself. It cannot: "No sessions yet" and "A session is one running
 * conversation" are the same shape to a parser. What it can do - and what stops
 * the whack-a-mole - is refuse to let any of it be unaccounted for. A new
 * paragraph under a new field fails this check the moment it is written, and
 * the only ways to make it pass are to move it behind a (?) or to write down,
 * in this file, which of the four things it is.
 *
 * ---------------------------------------------------------------------------
 * The browser half
 *
 * The source half above is the valuable one: it runs in a second, it reads
 * every file, and a page that fails to render cannot hide anything from it. The
 * browser half is there for the thing source cannot see - what a real page
 * actually draws under a real control - and it walks the routes out of
 * `src/navigation.ts` rather than a list written here, because a list written
 * here is a list that stops covering the page somebody adds tomorrow.
 *
 * It is structural rather than class-based, because a production build hashes
 * the class names away: for every input, select and textarea on the page it
 * finds the field that control stands in and reads whatever text the field
 * prints *after* the control. Five words or more of that is a paragraph under a
 * field, and it has to be in the same table.
 *
 * ORKNUX_SOURCE_ONLY=1 runs the source half alone, which is what a pre-commit
 * hook or a machine with no server on 5173 wants.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// What is allowed to be in the open

/**
 * Classes that carry a page's or a card's own sentence, never a field's.
 *
 * Excused once by name because the shape is structural: each of these sits
 * under a heading or beside a button, and none of them has ever been an
 * explanation of a control. A `fieldNote` under an input is a different thing
 * and is not on this list.
 */
/**
 * How many sentences an excuse of the subtitle family may cover.
 *
 * The export dialog was reported with four lines of prose under its title. It
 * had not been missed - it was excused, by `dialogMessage` being on this list
 * as "the line under a dialog title". The class was right about what it is for
 * and said nothing about how much of it there may be, so a paragraph wearing it
 * inherited a subtitle's exemption.
 *
 * A line is excused because it names the thing, and naming takes a sentence or
 * two. Past that it is teaching, whatever it is wearing, and teaching goes
 * behind the (?) beside the heading it belongs to.
 */
const A_LINE = 2;

const NOT_A_FIELD_NOTE = [
  {
    class: 'subtitle',
    upTo: A_LINE,
    why: 'the line under a page heading. It names the page, is drawn above everything rather than under a control, and is not a second icon convention - there is no affordance to hide it behind',
  },
  { class: 'cardSubtitle', upTo: A_LINE, why: 'the same line, under a card heading rather than a page one' },
  { class: 'panelSubtitle', upTo: A_LINE, why: 'the same line, at the top of a side panel' },
  { class: 'dialogMessage', upTo: A_LINE, why: 'the line under a dialog title, saying what the dialog is for' },
  {
    class: 'dangerMessage',
    why: 'the body of a Danger Zone card, whose subject is the button beside it. There is no field here to put a (?) on, and the card exists to be read',
  },
  { class: 'dangerNote', why: 'the same card, where the sentence sits on the row rather than in a block' },
  {
    class: 'leaveOutLead',
    why: "the lead of one step of the import wizard, above the list that step is asking about - that step's own sentence, the way a dialog message is the dialog's",
  },
  { class: 'questionsLead', why: 'the same, for the step that asks about what a file could not carry' },
  { class: 'arrival', why: 'the same, for the step that says what an imported workflow arrives as' },
];

/**
 * Every remaining block of prose the interface prints in the open.
 *
 * `says` is the opening of the sentence, which is how the same table serves the
 * source half and the browser half: one reads it out of the JSX, the other off
 * the rendered page. `because` is from the vocabulary in the note at the top of
 * this file, and `why` says which of the reader's questions it answers.
 */
const IN_THE_OPEN = [
  // ---- What the reader just did, or what is happening now -----------------
  {
    file: 'src/App.tsx',
    says: 'Trying again — this page will carry on by itself.',
    because: 'status',
    why: 'what the shell is doing about a connection it has lost',
  },
  {
    file: 'src/pages/docs/DocsPage.tsx',
    says: 'This page is not translated yet.',
    because: 'status',
    why: 'the state of the page being read - there is no Polish version of it, so the English one is shown. There is no control here to hang a (?) on, and a reader who is not told reads it as a bug',
  },
  {
    file: 'src/pages/workspace/FunctionSettingsPage.tsx',
    says: 'There are no objects in this workspace yet, so define one first or use map.',
    because: 'status',
    why: "the state of the workspace, on the field that would have offered one: there are no objects to point a return type at. It was invisible to this check until the interface was translated - it was written `{'…'}` rather than between the tags, and a bare expression broke the run. `t('…')` is unfolded now, so it is seen. The sentence itself is unchanged; it moved file when the return type left the editor's column for the function's own settings page",
  },
  {
    file: 'src/pages/chat/ChatPage.tsx',
    says: 'ms to draw it, and charged for one picture rather than for tokens',
    because: 'status',
    why: "how long this particular answer took, what it cost, and what was kept of it. The paragraph has three arms now and what is recorded here is whichever reads longest, so this quotation moves when one is added - it quoted the nothing-was-reported arm until #227 added the token one, and the token one until #240 added this. #240's is a drawn picture, which is billed per picture and reports no tokens, so \"charged for 0 tokens in and 0 out\" would be true of the counts and false about the money. The entry went briefly missing from this table once: after #227 the scanner could not see into a fragment at all, so it read as excusing something that no longer existed and was deleted. It existed the whole time; `fragmentsIn` is why it can be seen again",
  },
  {
    file: 'src/components/CodeSuggestion.tsx',
    says: 'Reading what is there now…',
    because: 'status',
    why: 'the suggestion is being fetched; it says so while it waits',
  },
  {
    file: 'src/components/ToolSuggestion.tsx',
    says: 'Reading what is there now…',
    because: 'status',
    why: 'the same wait, on the tool editor',
  },
  {
    file: 'src/components/QuickChat.tsx',
    says: 'The change is shown in the editor, against the code it would change.',
    because: 'status',
    why: 'where the answer just went - the result of the thing the reader asked for',
  },
  {
    file: 'src/pages/preferences/PreferencesPage.tsx',
    says: 'Press the combination you want. Escape leaves it as it is.',
    because: 'status',
    why: 'drawn only while the recorder is listening, which is the state the control is in. What each shortcut is for moved behind its own (?)',
  },
  {
    file: 'src/pages/workspace/WorkspaceIssuePage.tsx',
    says: '. The next one is ready.',
    because: 'status',
    why: 'the issue was filed and the form has been cleared for another',
  },
  {
    file: 'src/pages/chat/ChatPage.tsx',
    says: 'Everything above was carried over from the session',
    because: 'status',
    why: 'where the lines above this one came from, in this conversation',
  },
  {
    file: 'src/pages/chat/ChatPage.tsx',
    says: 'Continuing an LLM session',
    because: 'status',
    why: 'what this chat is attached to now, which changes what typing into it does',
  },
  {
    file: 'src/pages/workspace/ExecutionDetailPage.tsx',
    says: 'Carried over from the earlier run',
    because: 'status',
    why: "where this step's input came from, on the run being looked at",
  },
  {
    file: 'src/pages/workspace/ExecutionDetailPage.tsx',
    says: 'The run carried on down this node',
    because: 'status',
    why: 'what this run did at this node',
  },
  {
    file: 'src/pages/workspace/WorkspaceIssuePage.tsx',
    says: 'Changes have been recorded from here on. What happened before',
    because: 'status',
    why: "how far back this issue's history goes, which is a fact about this issue",
  },
  {
    file: 'src/components/TestRunDialog.tsx',
    says: 'This runs the saved function, not the column.',
    because: 'status',
    why: 'drawn only while the column and the saved function disagree, which is the state the page is in. What Run does at all is behind the (?) on the heading. It moved file with the rest of Test Run, out of the editor panel and into the window the mark in the corner opens',
  },
  {
    file: 'src/components/TestRunDialog.tsx',
    says: 'It was stopped rather than refused; running it again may answer.',
    because: 'status',
    why: 'what the run that just finished came to - a budget ran out rather than the code being wrong, so the next press may answer',
  },

  // ---- The state of a list, a panel or a field with nothing in it ---------
  {
    file: 'src/components/CommandPalette.tsx',
    says: 'Nothing goes by that name.',
    because: 'status',
    why: 'what the search just found',
  },
  {
    file: 'src/components/IssueRelationList.tsx',
    says: 'Nothing here by that number or name.',
    because: 'status',
    why: 'what the search just found',
  },
  {
    file: 'src/components/IssueRelationList.tsx',
    says: 'Nothing linked yet. What blocks this, what it duplicates, what is worth reading beside it.',
    because: 'status',
    why: 'empty, and three examples of what would go there - not a definition of a link',
  },
  {
    file: 'src/components/ObserverList.tsx',
    says: 'Nobody but the reporter and the assignee.',
    because: 'status',
    why: "who is observing this issue, which is the list's own contents",
  },
  {
    file: 'src/components/QuickChat.tsx',
    says: 'Ask about what is on screen, or about this workspace',
    because: 'status',
    why: 'an empty conversation, saying what to type into it',
  },
  {
    file: 'src/components/RevisionHistory.tsx',
    says: 'This version had nothing written in it.',
    because: 'status',
    why: 'what is in the version being looked at',
  },
  {
    file: 'src/pages/admin/AdminNetworkingPage.tsx',
    says: 'No proxy rules yet. Every request goes out the way this host does.',
    because: 'status',
    why: 'empty, and what that means for traffic right now - not a definition of a rule',
  },
  {
    file: 'src/pages/admin/AdminShellPage.tsx',
    says: 'No shells yet. Until there is one, an agent given the shells has nowhere to run.',
    because: 'status',
    why: 'empty, and what that means for an agent right now',
  },
  {
    file: 'src/pages/admin/AdminTemplatesPage.tsx',
    says: 'No templates yet. Export a function, an object, a condition, a tool or a skill from a work',
    because: 'status',
    why: 'empty, and the way out of it. What a template *is* is behind the (?) on the heading',
  },
  {
    file: 'src/pages/admin/AdminUserPage.tsx',
    says: 'No roles are defined yet.',
    because: 'status',
    why: 'what this picker has to offer, which is nothing',
  },
  {
    file: 'src/pages/chat/ChatPage.tsx',
    says: 'An administrator has switched chat off for this installation.',
    because: 'status',
    why: 'why this page is empty, and what happens to what was here',
  },
  {
    file: 'src/pages/chat/ChatPage.tsx',
    says: 'Nothing said yet. What is typed below starts the conversation.',
    because: 'status',
    why: 'an empty transcript',
  },
  {
    file: 'src/pages/workspace/ExecutionDetailPage.tsx',
    says: 'No step detail was recorded for this run.',
    because: 'status',
    why: 'what this run kept',
  },
  {
    file: 'src/pages/workspace/ExecutionsPage.tsx',
    says: 'No runs match those filters.',
    because: 'status',
    why: 'what the filters just found',
  },
  {
    file: 'src/pages/workspace/SessionDetailPage.tsx',
    says: 'Nothing was recorded on this line.',
    because: 'status',
    why: 'what is in the line being looked at',
  },
  {
    file: 'src/pages/workspace/WorkflowEditorPage.tsx',
    says: 'Select a node on the canvas to edit it.',
    because: 'status',
    why: 'the panel has nothing selected, and says what would fill it',
  },
  {
    file: 'src/pages/workspace/WorkspaceIssuePage.tsx',
    says: 'Nothing linked yet. The pull request, the dashboard, the page that will not load.',
    because: 'status',
    why: 'empty, and three examples of what would go there',
  },
  {
    file: 'src/pages/workspace/WorkspacePluginsPage.tsx',
    says: 'No plugins are loaded into this installation, so there is nothing to configure.',
    because: 'status',
    why: 'why this page is empty. Its sibling sentence - how a plugin comes to ask for anything at all - went behind the (?)',
  },
  {
    file: 'src/pages/workspace/WorkspacePluginsPage.tsx',
    says: 'A secret is only ever answered by pointing at a variable, and this workspace has none yet.',
    because: 'status',
    why: 'a dead end: the only way to answer this parameter is a list that is empty here',
  },
  {
    file: 'src/pages/workspace/WorkspacePluginsPage.tsx',
    says: 'when the plugin runs, so changing that variable changes what the plugin is handed.',
    because: 'status',
    why: 'a reading of what this parameter is set to now',
  },
  {
    file: 'src/pages/workspace/WorkspaceSettingsPage.tsx',
    says: 'No transcription model has been added yet.',
    because: 'status',
    why: 'what the picker has instead of options, where the missing options would have been',
  },
  {
    file: 'src/pages/workspace/WorkspaceSettingsPage.tsx',
    says: 'No speech model has been added yet.',
    because: 'status',
    why: 'the same, for the speech picker',
  },
  {
    file: 'src/pages/workspace/WorkspaceSettingsPage.tsx',
    says: 'No image model has been added yet.',
    because: 'status',
    why: 'the same, for the picker that chooses what draws',
  },
  {
    file: 'src/pages/admin/AdminSettingsPage.tsx',
    says: 'here, and the stored answer is the one in force.',
    because: 'status',
    why: 'which of the environment and the stored setting is winning right now, said only where they differ',
  },

  // ---- A reading of what a form is looking at ----------------------------
  {
    file: 'src/components/ActionDialog.tsx',
    says: 'Created with this action, taking nothing and returning a map.',
    because: 'status',
    why: 'what saving is about to create, once somebody has chosen to create it',
  },
  {
    file: 'src/components/ActionDialog.tsx',
    says: 'This function takes no arguments.',
    because: 'status',
    why: 'a reading of the function just chosen',
  },
  {
    file: 'src/components/ConditionForm.tsx',
    says: 'Created with this condition, saying no to everything.',
    because: 'status',
    why: 'what saving is about to create. Pinned as kept by scripts/hint-forms-check.mjs',
  },
  {
    file: 'src/components/TriggerForm.tsx',
    says: 'This one has no fields yet, so any JSON matches it.',
    because: 'status',
    why: 'a reading of the shape just chosen. Pinned as kept by scripts/hint-forms-check.mjs',
  },
  {
    file: 'src/components/TriggerForm.tsx',
    says: 'Created with this trigger, turning every caller away.',
    because: 'status',
    why: 'what saving is about to create',
  },
  {
    file: 'src/components/TriggerForm.tsx',
    says: 'No function here returns true or false yet;',
    because: 'status',
    why: 'what this picker has to offer, which is nothing usable',
  },
  {
    file: 'src/components/TriggerForm.tsx',
    says: 'None set up yet. Connections carry credentials,',
    because: 'status',
    why: 'the picker is empty, and where its contents come from',
  },
  {
    file: 'src/components/TriggerForm.tsx',
    says: 'Every message in every channel this bot is in',
    because: 'status',
    why:
      'what choosing Message is about to let in. A trigger on a channel\'s history hears everything ' +
      'anybody types there, which is a different order of traffic from being mentioned, and it is ' +
      'worth knowing before Save rather than after. What the three events *are* is behind the (?)',
  },
  {
    file: 'src/components/TriggerForm.tsx',
    says: 'No Slack connections yet. A reply is matched against',
    because: 'status',
    why: 'the list is empty, and where its contents come from',
  },
  {
    file: 'src/components/ModelDialog.tsx',
    says: 'Asking the provider what it offers…',
    because: 'status',
    why: 'a request in flight',
  },
  {
    file: 'src/components/ModelDialog.tsx',
    says: 'The provider listed no models.',
    because: 'status',
    why: 'what that request came back with',
  },

  // ---- Part of what the thing is called ----------------------------------
  {
    file: 'src/components/ActionDialog.tsx',
    says: 'How long to wait, in seconds',
    because: 'label',
    why: 'the unit. A number box says nothing about what its number counts, and behind a hover somebody types 30 meaning minutes. Pinned as staying by scripts/dialog-hint-check.mjs',
  },
  {
    file: 'src/components/ModelDialog.tsx',
    says: 'Input $ / million tokens',
    because: 'label',
    why: "it is the field's own <label>; the class is muted because a price is set in small type",
  },
  {
    file: 'src/components/ModelDialog.tsx',
    says: 'Output $ / million tokens',
    because: 'label',
    why: 'the same field, the other direction',
  },
  {
    file: 'src/components/MarkdownEditor.tsx',
    says: 'Markdown · @ to mention',
    because: 'label',
    why: 'a caption on the box saying what it accepts, in the shape of a label rather than a sentence',
  },
  {
    file: 'src/components/ComponentTransfer.tsx',
    says: 'The objects it is typed against, the functions it calls,',
    because: 'label',
    why: "one radio option's own description. The choice is between two of these and the description is how they are told apart - it is what the option is called, at length",
  },
  {
    file: 'src/components/ComponentTransfer.tsx',
    says: 'For a workspace that already has what it points at.',
    because: 'label',
    why: 'the other option in the same pair',
  },
  {
    file: 'src/components/ComponentTransfer.tsx',
    says: 'So it lands in a workspace that has none of this yet.',
    because: 'label',
    why: 'the same pair of options, on the export side',
  },
  {
    file: 'src/components/ComponentTransfer.tsx',
    says: 'For workspaces that already have what it points at;',
    because: 'label',
    why: 'the other option in that pair',
  },

  // ---- Somebody else is holding the file ---------------------------------
  {
    file: 'src/pages/workspace/ObjectEditorPage.tsx',
    says: 'No properties yet. Each one is a name, a type and a sentence saying what it means',
    because: 'in-flight',
    why: 'the four component editors are issue #175 and another agent has them open. This is an empty state wanting the split - the status stays, the definition goes behind the (?) - and it is theirs to make. Delete this entry when #175 lands',
  },
  {
    file: 'src/pages/workspace/ToolEditorPage.tsx',
    says: 'An agent calling this tool fills these in by name.',
    because: 'in-flight',
    why: 'the same four editors, issue #175. A plain explanation above a list of parameters, which belongs behind the (?) on that heading. Delete this entry when #175 lands',
  },
];

// ---------------------------------------------------------------------------
// The source half

const WORDS = 5;
const BECAUSE = new Set(['status', 'error', 'label', 'in-flight']);

function under(from, ext) {
  return readdirSync(from, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? under(join(from, entry.name), ext)
      : entry.name.endsWith(ext)
        ? [join(from, entry.name)]
        : [],
  );
}

const slashes = (path) => path.split(/[\\/]/).join('/');

/**
 * Every class in a CSS module painted the way a hint is painted.
 *
 * Muted colour and a font-size below the body's: that pairing is what makes
 * small grey words look like small grey words, and a new class of this kind
 * will carry it whatever it is named.
 */
function mutedClasses() {
  const found = new Set();
  for (const path of under('src', '.module.css')) {
    const css = readFileSync(path, 'utf8');
    const rule = /\.([A-Za-z0-9_]+)([^{]*)\{([^}]*)\}/g;
    let at;
    while ((at = rule.exec(css)) !== null) {
      const body = at[3];
      if (
        /color:\s*var\(--color-text-(muted|secondary|tertiary)\)/.test(body) &&
        /font-size:\s*var\(--text-(xs|sm|md)\)/.test(body)
      ) {
        found.add(at[1]);
      }
    }
  }
  return found;
}

/** Past a `{ ... }`, strings, comments and nesting included. */
function pastBraces(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i) + 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return i;
}

/** The end of the opening tag beginning at `i`, and whether it closed itself. */
function pastOpeningTag(src, i) {
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      i = pastBraces(src, i);
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += 1;
      i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '>') return [i + 2, true];
    if (c === '>') return [i + 1, false];
    i += 1;
  }
  return [i, true];
}

/** Past a whole element beginning at `i`. */
function pastElement(src, i) {
  const name = /^<([A-Za-z0-9._]*)/.exec(src.slice(i))?.[1] ?? '';
  const [after, selfClosing] = pastOpeningTag(src, i);
  if (selfClosing || name === '') return after;
  let j = after;
  let depth = 1;
  while (j < src.length) {
    if (src[j] === '{') {
      j = pastBraces(src, j);
      continue;
    }
    if (src[j] === '<') {
      if (src.startsWith(`</${name}`, j)) {
        depth -= 1;
        j = src.indexOf('>', j) + 1;
        if (depth === 0) return j;
        continue;
      }
      if (src.startsWith(`<${name}`, j) && /[\s>/]/.test(src[j + 1 + name.length] ?? '')) {
        const [end, self] = pastOpeningTag(src, j);
        if (!self) depth += 1;
        j = end;
        continue;
      }
      j = pastElement(src, j);
      continue;
    }
    j += 1;
  }
  return j;
}

/**
 * `{t('…')}`, unfolded to the sentence inside it.
 *
 * Since the interface was translated, prose is written `{t('English here')}`
 * rather than bare between the tags. That is still hard-coded text - the
 * English is in the source, in the diff, and on the screen for anybody reading
 * English - and a check that treated it as an expression would have gone blind
 * to every sentence in the product on the same day this one arrived.
 *
 * A single string literal and nothing else. `t(x)` or `t('a' + b)` is not a
 * sentence somebody typed, and is left to break the run the way any other
 * expression does.
 */
const TRANSLATED = /^\{\s*t\(\s*(['"])((?:[^'"\\]|\\.)*)\1\s*(?:,\s*(['"])(?:[^'"\\]|\\.)*\3\s*)?\)\s*\}/;

function translated(src, i) {
  const found = TRANSLATED.exec(src.slice(i));
  if (found === null) return null;
  return { says: found[2].replace(/\\(['"\\])/g, '$1'), end: i + found[0].length };
}

/** Past a quoted string, from its opening quote. */
function pastString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** From just inside a `<>`, the index of the `</>` that closes it. */
function pastFragment(src, from, to) {
  let depth = 0;
  let i = from;
  while (i < to) {
    if (src[i] === '<' && src[i + 1] === '>') {
      depth += 1;
      i += 2;
      continue;
    }
    if (src.startsWith('</>', i)) {
      if (depth === 0) return i;
      depth -= 1;
      i += 3;
      continue;
    }
    if (src[i] === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) {
      i = pastElement(src, i);
      continue;
    }
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      i = pastString(src, i);
      continue;
    }
    i += 1;
  }
  return to;
}

/**
 * The fragments a JSX expression hands back, as spans of what is inside them.
 *
 * This is here because of issue #227's chat cost. A paragraph that read
 *
 *     <p className={styles.thoughtDetail}>
 *       The provider took {ms} ms to answer. Nothing else is recorded: …
 *
 * became
 *
 *     <p className={styles.thoughtDetail}>
 *       {spend === null ? (<>The provider took {ms} ms to answer. …</>) : (<>…</>)}
 *
 * and this check stopped being able to see a word of it: the whole expression
 * was skipped, the paragraph read as having no text of its own, and the entry
 * excusing it began failing as one that "no longer exists". It had not gone
 * anywhere. A `<>` renders no DOM node, so every one of those words is still
 * the paragraph's own prose on screen - the scanner had gone blind, and the
 * honest reading of a guard that stops seeing something is not that the thing
 * stopped existing.
 *
 * So a fragment inside an expression is descended into and its words counted as
 * the enclosing element's. A *named* element inside the expression is not: it
 * draws a node of its own and its words are its own, which is the same rule the
 * top of `ownText` already applies.
 *
 * The arms of a ternary stay separate runs rather than being joined. They are
 * alternatives - only one is ever on screen - and running them together would
 * manufacture a sentence the interface never prints.
 */
function fragmentsIn(src, from, to) {
  const spans = [];
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i = pastString(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? to : end + 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? to : end + 1;
      continue;
    }
    if (c === '<' && src[i + 1] === '>') {
      const inner = i + 2;
      const close = pastFragment(src, inner, to);
      spans.push([inner, close]);
      i = close + 3;
      continue;
    }
    if (c === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) {
      i = pastElement(src, i);
      continue;
    }
    i += 1;
  }
  return spans;
}

/**
 * The runs of hard-coded text an element writes itself.
 *
 * A child's text is not this element's: a `<div>` wrapping a paragraph would
 * otherwise be reported alongside the paragraph, and the same sentence would
 * need two entries in the table. An expression breaks a run, because
 * `{name} is here` is two words of prose and a value, not a sentence.
 */
function ownText(src, from, to) {
  const runs = [];
  let held = '';
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === '{') {
      const said = translated(src, i);
      if (said !== null) {
        held += said.says;
        i = said.end;
        continue;
      }
      const past = pastBraces(src, i);
      runs.push(held);
      held = '';
      /*
       * An expression breaks the run, but what it hands back may still be this
       * element's own words: a `<>` renders nothing, so its text lands here.
       * Each fragment is read as runs of its own - see `fragmentsIn`.
       */
      for (const [at, end] of fragmentsIn(src, i + 1, past - 1)) {
        runs.push(...ownText(src, at, end));
      }
      i = past;
      continue;
    }
    if (c === '<' && src[i + 1] === '>') {
      // A fragment written straight into the element. Transparent: descend.
      const close = pastFragment(src, i + 2, to);
      runs.push(held);
      held = '';
      runs.push(...ownText(src, i + 2, close));
      i = close + 3;
      continue;
    }
    if (c === '<') {
      runs.push(held);
      held = '';
      i = pastElement(src, i);
      continue;
    }
    held += c;
    i += 1;
  }
  runs.push(held);
  return runs
    .map((run) =>
      run
        .replace(/&rsquo;|&apos;/g, "'")
        .replace(/&mdash;/g, '—')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&hellip;/g, '…')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/** Every block of prose the interface prints in the open, out of the source. */
export function proseInSource() {
  const muted = mutedClasses();
  const excused = new Map(NOT_A_FIELD_NOTE.map((one) => [one.class, one.upTo ?? Infinity]));
  /* Sentence ends, not full stops: "3.5s" and "e.g." are not two sentences. */
  const sentences = (words) => (words.match(/[.!?](\s|$)/g) ?? []).length || 1;
  const found = [];
  for (const path of under('src', '.tsx')) {
    const src = readFileSync(path, 'utf8');
    let i = 0;
    while (i < src.length) {
      const at = src.indexOf('<', i);
      if (at === -1) break;
      const name = /^<([A-Za-z0-9._]+)/.exec(src.slice(at))?.[1];
      if (name === undefined) {
        i = at + 1;
        continue;
      }
      const [after, selfClosing] = pastOpeningTag(src, at);
      /*
       * Any stylesheet's name, not `styles` alone.
       *
       * It read `styles\.` until a page imported two modules and had to call
       * one of them something else - and every paragraph wearing a class from
       * the second one went invisible, silently, which is the failure this file
       * was written to stop. There are already several: `table` on the
       * variables page, `transferStyles` beside the import buttons, `rows` on
       * the function settings page. Widening it found nothing new to complain
       * about, which is the answer that says it is safe as well as right.
       */
      const cls = /className=\{[^{}]*[A-Za-z_$][A-Za-z0-9_$]*\.([A-Za-z0-9_]+)/.exec(src.slice(at, after))?.[1] ?? null;
      if (cls === null || selfClosing || !muted.has(cls)) {
        i = at + 1;
        continue;
      }
      const end = pastElement(src, at);
      const closeAt = src.lastIndexOf(`</${name}`, end);
      const runs = ownText(src, after, closeAt === -1 ? end : closeAt);
      const longest = runs.reduce((a, b) => (b.split(' ').length > a.split(' ').length ? b : a), '');
      /*
       * The excuse is asked after the words are read, not before. A class on
       * this list is excused for being a line; one carrying a paragraph is not
       * the thing the excuse was written about.
       */
      if (excused.has(cls) && sentences(longest) <= excused.get(cls)) {
        i = at + 1;
        continue;
      }
      if (longest !== '' && longest.split(' ').length >= WORDS) {
        found.push({
          file: slashes(path),
          line: src.slice(0, at).split('\n').length,
          class: cls,
          says: longest,
        });
      }
      i = at + 1;
    }
  }
  return found;
}

/** Which table entry covers this sentence, if any. */
const covers = (entry, said) => said.startsWith(entry.says) || said.includes(entry.says);

// ---------------------------------------------------------------------------

const results = [];
function record(ok, what) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`);
  return ok;
}

// The table has to be a table before anything is measured against it.
for (const entry of IN_THE_OPEN) {
  if (!BECAUSE.has(entry.because)) {
    record(false, `${entry.file}: "${entry.says.slice(0, 40)}" is excused as "${entry.because}", which is not one of ${[...BECAUSE].join(', ')}`);
  }
  if ((entry.why ?? '').trim() === '') {
    record(false, `${entry.file}: "${entry.says.slice(0, 40)}" is excused with no reason written down`);
  }
}

const found = proseInSource();
record(found.length > 0, `there is prose in the interface to look at (${found.length} blocks in the open)`);

const unlisted = found.filter((one) => !IN_THE_OPEN.some((entry) => entry.file === one.file && covers(entry, one.says)));
record(
  unlisted.length === 0,
  unlisted.length === 0
    ? `every block of prose in the open is one this check knows the reason for (${found.length})`
    : `prose under a field that is neither behind a (?) nor written down here:\n` +
      unlisted
        .map((one) => `        ${one.file}:${one.line} (${one.class}) ${JSON.stringify(one.says.slice(0, 90))}`)
        .join('\n'),
);

/*
 * And the other way round. An entry whose sentence has left the interface is an
 * exemption for nothing, and a table full of those is a table that has quietly
 * stopped covering anything.
 */
const gone = IN_THE_OPEN.filter((entry) => !found.some((one) => one.file === entry.file && covers(entry, one.says)));
record(
  gone.length === 0,
  gone.length === 0
    ? 'and every reason written down here is about something the interface still prints'
    : `these are excused but no longer exist - delete the entries:\n` +
      gone.map((entry) => `        ${entry.file} ${JSON.stringify(entry.says.slice(0, 70))}`).join('\n'),
);

/*
 * The other affordance, by name.
 *
 * Five pages explained themselves in a footer with an ⓘ beside it. An icon and
 * a paragraph is the job the (?) already does, and two pictures for one job on
 * one product is exactly the inconsistency being objected to - so the icon is
 * looked for directly rather than left to the paragraph rule, which a footer
 * moved behind a *different* picture would walk straight past.
 */
const withInfoIcon = under('src', '.tsx').filter((path) => /assets\/info\.svg/.test(readFileSync(path, 'utf8')));
record(
  withInfoIcon.length === 0,
  withInfoIcon.length === 0
    ? 'nothing carries an explanation behind an ⓘ; the (?) is the only affordance for one'
    : `the ⓘ is back, and it is a second convention for the (?)'s job: ${withInfoIcon.map(slashes).join(', ')}`,
);

// The in-flight entries are debts, and a run should say how many are owed.
const inFlight = IN_THE_OPEN.filter((entry) => entry.because === 'in-flight');
if (inFlight.length > 0) {
  console.log(
    `NOTE: ${inFlight.length} exemptions are only until somebody else's change lands:\n` +
      inFlight.map((entry) => `        ${entry.file} - ${entry.why}`).join('\n'),
  );
}

// ---------------------------------------------------------------------------
// The browser half

if (process.env.ORKNUX_SOURCE_ONLY !== '1') {
  const { BASE, WORKSPACE, open, drawn, finish } = await import('./suite/harness.mjs');

  /**
   * Every page the router draws, read out of the registry rather than listed
   * here - so a page added tomorrow is walked tomorrow.
   *
   * Only the ones whose address this check can build: a route with an id in it
   * needs a row out of the database to stand for it, and the four checks beside
   * this one already open those. What is left is every settings and admin
   * screen with a fixed address, which is where the reports came from.
   */
  const routes = [...readFileSync('src/navigation.ts', 'utf8').matchAll(/path: '([^']+)'/g)]
    .map((one) => one[1])
    .filter((path) => !/:(?!workspaceId)/.test(path))
    .map((path) => path.replace(':workspaceId', WORKSPACE));

  const { browser, page } = await open({ viewport: { width: 1440, height: 1000 } });
  let walked = 0;
  let failed = false;
  try {
    for (const route of routes) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      // Thirty seconds: the editors ask for four catalogues before they can lay
      // a field out, and a budget a healthy page misses under load reports load
      // as breakage.
      if (!(await drawn(page, route, { within: 30_000 }))) continue;
      await page.waitForTimeout(400);
      walked += 1;

      /*
       * What a field prints after its control.
       *
       * Structural rather than by class name, because a production build hashes
       * the class names away and this has to say the same thing about the image
       * CI runs. The field is the nearest ancestor of the control that also
       * holds its label; anything that ancestor prints *after* the control is
       * what a reader sees underneath it.
       */
      const printed = await page.evaluate((least) => {
        const said = [];
        for (const control of document.querySelectorAll('main input, main select, main textarea')) {
          /*
           * The field this control stands in: the nearest ancestor that holds a
           * label, climbed to only while this is still the only control inside.
           *
           * That second condition is what stops the climb at the field instead
           * of running on to the card, the table or the page - every one of
           * which holds a label somewhere and would hand back the whole screen
           * as "printed under this control". A search box in a toolbar has no
           * label above it at all, and reaches the top with nothing to report,
           * which is right: it is not a field with an explanation under it.
           */
          let field = control.parentElement;
          while (field !== null) {
            if (field.querySelectorAll('input, select, textarea').length > 1) {
              field = null;
              break;
            }
            if (field.querySelector('label') !== null) break;
            field = field.parentElement;
          }
          if (field === null) continue;

          const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
          let seen = false;
          let after = '';
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (!seen) {
              if (control.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) seen = true;
              else continue;
            }
            const held = node.parentElement;
            /*
             * A note already behind the (?) is the answer and not the problem;
             * a label, a button, an option and the value inside a control are
             * not prose under it.
             */
            if (
              held !== null &&
              held.closest('[role="note"], label, button, option, input, textarea, select, a') !== null
            ) {
              continue;
            }
            after += ` ${node.textContent ?? ''}`;
          }
          const words = after.replace(/\s+/g, ' ').trim();
          if (words.split(' ').filter(Boolean).length >= least) said.push(words);
        }
        return [...new Set(said)];
      }, WORDS);

      for (const words of printed) {
        const excused = IN_THE_OPEN.some((entry) => words.includes(entry.says));
        record(excused, `${route}: a field prints ${JSON.stringify(words.slice(0, 90))} under its control`);
      }
      if (printed.length === 0) record(true, `${route}: no field prints a paragraph under its control`);
    }

    /*
     * The guard on this half. Every assertion above is inside a loop, so a
     * server that answers nothing walks through it and reports the same pass as
     * a run that read forty pages.
     */
    record(walked >= routes.length - 4, `enough pages drew to be worth reading (${walked} of ${routes.length})`);
  } catch (cause) {
    failed = true;
    console.error(`FAIL: the browser half threw: ${cause instanceof Error ? cause.stack : String(cause)}`);
  }
  await finish(browser, !failed && results.every(Boolean));
} else {
  const passed = results.every(Boolean);
  console.log(
    passed
      ? `ALL PASS (${results.length} assertions, source only)`
      : `FAILED (${results.filter((one) => !one).length} of ${results.length}, source only)`,
  );
  process.exit(passed ? 0 : 1);
}
