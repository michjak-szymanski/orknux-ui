# UI design rules

The conventions this interface holds to. Written down because the expensive
mistakes are not the ones somebody argues about — they are the ones where two
screens quietly disagree and nobody notices for months.

Add to this file when a rule is settled, not when it is proposed. A rule here
should be one somebody can be held to in review.

## Explaining a field: the (?), never a paragraph

**An explanation goes behind a `(?)` beside the thing it explains. It does not
go in a paragraph under the field.**

Use `FieldHint` (`src/components/FieldHint.tsx`). Hovering opens the note;
pressing pins it, and a pinned note carries a close control and stays until it
is used.

**Why.** A panel that prints its explanations under the fields explains
everything to somebody who needed one of them once. The node editor had eleven
paragraphs of it, and the effect is that the thing being typed into is
outnumbered by prose about it. The words go behind a control that is small when
nobody is asking and complete when somebody is.

**The rule that matters more than the rule.** *Everything moves or nothing
does.* A screen where some explanations hide behind a control and others sit in
the open is worse than either convention applied consistently — because the
reader cannot tell whether a field with no paragraph has no explanation, or has
one they have not found. If you are converting a screen, convert all of it. If
you add a field with an explanation to a converted screen, it gets a `(?)`.

**What still belongs in the open:**

- A sentence that is part of the field's *label*, not an explanation of it — a
  unit, a radio option's own description.
- An error, a warning, or the result of something the reader just did.
- The state of the thing being looked at. "Nothing yet." is a status, and stays
  visible.

**What does not:** anything that begins "This is…", anything explaining what a
setting means, what it costs, or what it lets somebody do. In particular, a
consequence worth knowing before granting a permission belongs in the `(?)`
beside that permission — not in a paragraph the reader has already scrolled
past.

**A page footer is not an exception.** This file used to exempt "a footer that
describes the whole page rather than one field", and five pages carried their
explanation in one — an ⓘ with a paragraph beside it, under the table. That is
already a hint-shaped affordance: an icon you read prose next to, doing the job
the `(?)` does, in a second picture. Two conventions for one job on one product
is the disagreement this whole section exists to end, and the one that goes is
the one that cannot hover, pin or close. A footer that *explains* the page
becomes a `(?)` beside the page heading. A footer stating a fact about the
current state — a count, a warning about something happening now — stays.

**How short a status is.** A status says the state and does not teach. The test
that decides the arguable ones: *if the sentence would still be true and worth
saying when the thing is full, it is not a status.* "Nothing yet" stops being
true the moment there is a row; "the next save will keep what this says now" is
true either way, so it is the mechanism and belongs behind the `(?)` beside it.
Saying both is saying it twice, most visibly on a panel somebody just converted
properly. The corollary is the mistake this invites: **do not delete the
elaboration, move it.** If the `(?)` does not already say what the trimmed
sentence said, it must afterwards — something said only in a status line and
then trimmed away is a thing the product no longer says anywhere.

**An empty state usually splits.** One line saying what is true now, and the
teaching behind the `(?)` beside it. The sessions list read "No sessions yet."
and then a paragraph on what a session is and how one comes to exist: the first
is the state and stays, the second is an explanation and moved. Where there is
no field to put the `(?)` beside, it goes beside the status line. Do not drop
the explanation while splitting — for a list nobody can create a row in, it is
the only thing on the page that says how a row ever appears, and without it
somebody is left in front of an empty table with nowhere to go. An empty state
whose second half really is state — "No proxy rules yet. Every request goes out
the way this host does." — is one sentence's worth of status and stays as it is.

**Where to put it.** Beside the thing being granted or configured, not beside
the section heading, when those differ. A `(?)` on a heading explains the
group; a `(?)` on a row explains the row. The `(?)` is a `<button>`, so on a
checkbox it stands *beside* the `<label>` and never inside it — inside, pressing
it ticks the box on the way to opening the note.

## How wide a page is: the column, and nothing narrower

**A page fills the column `AppShell` gives it. It does not cap that column.**

There is one content container and it is already shared: the `<main>` that
`AppShell` draws — beside the sidebar, with the page padding and the clearance
at the bottom. A page's own top-level blocks are `width: 100%` inside it. Do not
add a `max-width` to any of them, and do not wrap the page in something that
does: that would be a second place deciding the width, which is how two screens
come to disagree.

**Narrower than the column is said on the thing that wants it**, not on the
panel around it:

- A paragraph is capped where it is written — `max-width: 70ch` on a subtitle,
  because a line of prose 1600px long is unreadable.
- A field that is genuinely short says so itself. `.fieldNarrow` on the shell
  editor is `flex: 0 0 120px`, because a port is five characters wide.
- Fields that belong side by side are put side by side, in a row, rather than
  stacked in a column half the screen wide.

**Why not "forms are narrow".** It is a reasonable rule and it is not this
product's. The shell editor, the template editor, a workspace's settings and the
installation's settings are all forms and all fill. The user editor carried
`max-width: 640px` and was the only capped page in the admin section — at 1920
it used a third of the screen while every page beside it used all of it, which
is what was reported. One page holding a private opinion about width is worse
than either answer applied everywhere.

## Keeping this file honest

`scripts/hint-settings-check.mjs`, `hint-forms-check.mjs`, `hint-hover-check.mjs`
and `hint-placement-check.mjs` drive the real pages and assert the prose is gone
and the `(?)` is there. A screen converted without a check is a screen that
un-converts itself the next time somebody adds a field.

Those four each watch a screen somebody has already converted, which is why they
could not stop the same report arriving three times in twenty minutes about
screens nobody had looked at. `scripts/hint-prose-check.mjs` goes the other way:
it reads every `.tsx` in `src/`, finds every block of prose the interface prints
in the open — by the paint rather than by the class name, so renaming the class
does not hide it — and fails on any that is neither behind a `(?)` nor written
down in that file with which of the exceptions above it is and why. It looks for
the ⓘ by name as well. Its browser half walks every fixed address in
`navigation.ts` and reads what a real field actually prints under a real
control. A new paragraph under a new field is a failing check the day it is
written.

`scripts/admin-width-check.mjs` holds the width rule, and does it from the
source rather than from a browser: it walks the admin paths in `navigation.ts`,
follows each through `routes.tsx` to the file that draws it, and fails on a
`max-width` anywhere in the top level of a page. A new admin page is covered the
moment it is registered, whether or not there is anything in the database to
draw on it.

## A control that appears on many pages lives in one stylesheet

**If the same control is drawn on more than about three screens, its rule
belongs in one file the others compose from — not copied into each page's own
module.**

**Why.** `.rowAction`, the small square at the end of a row, existed sixteen
times in sixteen stylesheets. The base rule was byte-identical in twelve of
them; the `:hover` had drifted into five different answers, three of which were
no hover at all. On one row that drew as two buttons ignoring the pointer beside
a third turning green.

Copies do not drift because somebody decides they should. They drift because the
next person edits the file in front of them, and no file in front of them is the
button. Put one there.

**A missing token is the same fault one level down.** There was no
`--color-surface-hover`, so sixteen authors each invented what hovering looks
like. If two screens need the same colour for the same reason, it is a token.

## A change nobody can see is not a change

**Assert how far, not whether.** A check that reads a computed value and asserts
it differs will pass on a difference no eye can find.

The first fix for the row squares lifted the border from `#27272a` to `#71717a`
and nothing else. Every assertion passed — the value had moved — and it was
reported as still not working, because 1px of slightly lighter grey on a 32px
square is invisible. The check now asks for a minimum distance per channel, and
measures the fill as well as the edge.

**And look at it.** The thing that settled it was a screenshot of the two states
side by side, not a number. Measuring is how a change is kept; looking is how it
is judged.
