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

## Keeping this file honest

`scripts/hint-settings-check.mjs`, `hint-forms-check.mjs`, `hint-hover-check.mjs`
and `hint-placement-check.mjs` drive the real pages and assert the prose is gone
and the `(?)` is there. A screen converted without a check is a screen that
un-converts itself the next time somebody adds a field.
