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

- A sentence that is part of the field's *label*, not an explanation of it.
- An error, a warning, or the result of something the reader just did.
- The state of the thing being looked at — "Nothing yet. The next save will
  keep what this says now" is a status, not an explanation, and stays visible.
- A footer that describes the whole page rather than one field.

**What does not:** anything that begins "This is…", anything explaining what a
setting means, what it costs, or what it lets somebody do. In particular, a
consequence worth knowing before granting a permission belongs in the `(?)`
beside that permission — not in a paragraph the reader has already scrolled
past.

**Where to put it.** Beside the thing being granted or configured, not beside
the section heading, when those differ. A `(?)` on a heading explains the
group; a `(?)` on a row explains the row.

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

`scripts/admin-width-check.mjs` holds the width rule, and does it from the
source rather than from a browser: it walks the admin paths in `navigation.ts`,
follows each through `routes.tsx` to the file that draws it, and fails on a
`max-width` anywhere in the top level of a page. A new admin page is covered the
moment it is registered, whether or not there is anything in the database to
draw on it.
