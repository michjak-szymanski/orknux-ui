# Issues

Each workspace has a tracker of its own. An issue about a workflow belongs
beside the workflow, and the alternative - a link to another product - is a link
nobody follows while they are in the middle of fixing something.

It is small on purpose. There are no projects, no milestones, no boards and no
workflow of its own: a title, what is wrong, who is looking at it, and the
conversation underneath.

## The list

![The tracker: the states along the top, one search beside them, and the labels in use underneath](/screens/issues.png)

**Issues** in the workspace sidebar opens it.

Four states along the top: **Open**, **In progress**, **Closed** and **All**.
Open is what you get when the address says nothing, because that is what
somebody arriving is looking for. In progress means somebody has picked it up;
open means nobody has yet.

One search box covers the **title, the description and the labels** together.
Somebody typing "slack" means any of the three, and asking which of the three
they meant is a question with no useful answer. It does not look inside
comments.

The labels in use in the workspace are listed under the filters. A label is a
search somebody has already typed, so clicking one puts it in the box and
clicking it again takes it out. That is also why only one applies at a time:
there is one search, not a search and a label filter arguing about the same
list.

**Sort** names the field it sorts on - **Number**, **Title**, **Last change**,
**Last comment** - with a single arrow beside it for the direction. The arrow
says which way it is now rather than which way pressing it would go.

Number is the order things were filed in and not a date, which is why it is
called Number: a list ordered correctly by it reads as wrong against times that
run in no order at all. Last comment is deliberately not the same as Last
change, because closing, relabelling and assigning all move the change time, so
that ordering surfaces the housekeeping and this one surfaces the conversation.
An issue nobody has replied to sorts last either way round, there being no time
to put it in order by.

The row shows whichever time you sorted on, so an ordering can be checked
instead of taken on trust. The ordering is the server's, over the whole tracker
rather than over the rows on screen - sorting ten of a hundred looks like it
worked until the row somebody wanted turns out to be on page three.

The line at the bottom says how many there are and how many are shown, and the
page size sits in it: 10, 25, 50 or 100. It is remembered in your browser rather
than in the address, because it says how much of a screen you have and not what
you are looking at.

Everything else is in the address:

| Written | Means |
| --- | --- |
| `status` | `OPEN`, `IN_PROGRESS`, `CLOSED` or `all`; absent means open |
| `q` | what is in the search box |
| `order` | `NUMBER`, `TITLE`, `UPDATED` or `LAST_COMMENT` |
| `dir` | `asc`; anything else is descending |
| `page` | which page, counting from one |

So "the open p1 ones" is a link rather than a paragraph of instructions, and a
refresh comes back to the list you were reading instead of to the top of Open.

**New Issue** files one. If several are on your mind, tick **File another** and
the form empties and stays put, keeping the assignee and the labels you had just
set.

The command palette knows the open issues too, by their title and by their
number, so typing `12` there finds #12.

## One issue

![An issue: what is wrong, what it points at, and the conversation underneath](/screens/issue.png)

An issue is addressed by the number people say. `/issues/38` is #38 of that
workspace, and numbers are counted per workspace, so every workspace has its own
#1.

The title and the description are edited in place: double-click the description
to write, and **Edit/Preview** turns between writing it and reading it as
markdown. The same toggle is on the description while a new issue is being
filed, on the comment box, and on the box for correcting a comment - a report is
written once and read by everybody afterwards, so the moment somebody most wants
to see how their markdown lands is before they have handed it over. All of them
go through the same renderer as the page itself, so a preview cannot differ from
what gets saved.

Down the right are the four things somebody wants at a glance.

- **Status** is one button that cycles Open, In progress, Closed. There is also
  a **Close issue** button beside the comment box, where the decision usually
  gets made.
- **Assignee** is one box over three kinds of thing: a **person**, one of the
  workspace's **agents**, or one of its **models**. Work handed to an agent is
  still work somebody can see the state of, which is the whole reason the same
  box takes all three. Type to search it, and **No one** is both where it starts
  and a valid answer.
- **Labels** are typed in, with what the workspace already uses suggested
  underneath. They have no colours and no meaning of their own - `p1` is a
  convention this project keeps, not a field. A label exists because an issue
  carries it, so removing the last one that used it removes it from the list.
- **Reporter** is whoever filed it, and is not editable.

A `#12` written in a description or a comment becomes a link to #12. Only on an
issue's own page, where a number after a hash is an issue and nothing else, and
only where it reads as one: inside code it is left alone, and so is anything
longer than five digits, which is a colour.

## Links

Half of what a report points at is somewhere else: the pull request that caused
it, the dashboard that showed it, the page that will not load. Pasted into the
description those get buried in prose, so under **Links** each address gets a
row of its own, listed oldest first and taken off one at a time.

**Add a link** asks for the address and, optionally, what to call it. It is
offered while the issue is still being written as well as afterwards, because
the pull request and the failing page are what somebody has open at the moment
they decide to report something, and being told to file first and come back is
being told to lose the tab they were looking at. One typed then says "Added when
the issue is filed" rather than naming who added it, and is hung on the issue
the moment it exists.

A GitHub address is shown the way people say it: `owner/repo`,
`owner/repo#123` for an issue or a pull request, `owner/repo@abc1234` for a
commit. Both paths read as `#123` because GitHub numbers issues and pull
requests from one counter, so the address does not reliably say which it is.

That reading is worked out from the shape of the address alone and never asks
GitHub anything, which is worth being plain about: `owner/repo#123` means
"shaped like pull request 123", not "pull request 123 exists". A number nobody
ever opened reads exactly the same, and so does a repository you cannot see.
It is a label, and nothing here acts on it. Anything else - another host, a link
into a file - is shown as the address it is.

Only `http` and `https` addresses are kept. A link is rendered as an anchor
other people click, and `javascript:` in one is a script somebody else runs by
clicking what looks like a reference.

A link is taken off by whoever added it and by nobody else, administrators
included. The same rule as a comment and a file, for the same reason: what
somebody else put on an issue is part of the record.

## Comments

Comments are markdown, rendered rather than printed: tables, fenced code with
the usual languages highlighted, and a single newline meaning the line break it
looks like. Raw HTML is not rendered.

Typing **@** offers the same list the assignee box does, and choosing somebody
inserts their name as text. Mentions are text rather than references on purpose:
a name still reads correctly when it is quoted somewhere else, and nothing
breaks when a display name changes. Only people are notified by one - an agent
can be named in a sentence, but naming it does not summon it.

A comment is its author's to change. Editing is offered on your own and refused
on everybody else's, administrators included, and an edited comment says so. A
comment cannot be deleted; deleting the issue takes them with it.

## Files

Files can be put on the issue itself or on a single comment, and the quickest
way is to **paste a screenshot into the box you are typing in**. A picture
pasted into the description or a comment is attached where you pasted it, named
for the moment it arrived. Nothing else about pasting changes.

Pictures show a thumbnail and open over the page when clicked, with the arrow
keys stepping between the pictures on it. Anything else downloads, which is what
the server sends it as.

A file can be taken off by whoever put it there, and by nobody else - again
including administrators, for whom the way to remove somebody else's file is to
delete the issue. Removing it deletes the stored bytes as well as the row.

Attachments use the installation's own storage and its size limit, and can be
switched off for the whole installation; see Administration. Switched off, the
buttons are not offered, and what has already been attached stays readable.

## Notifications

![The bell, open beside the account menu](/screens/notifications.png)

The bell sits beside your name in the top bar, and carries a count of what is
waiting.

| It says | It happened because |
| --- | --- |
| assigned to you | somebody put an issue in your hands |
| changed state | an issue you filed or hold was opened, closed or picked up |
| new comment | somebody said something on an issue you filed or hold |
| mentioned you | somebody wrote your name in a comment |

You are never told about your own doing, and the feed crosses workspaces: it is
everything on the issues that concern you, in every workspace your roles let you
see, newest first. Each row opens the issue it is about.

Opening the panel is what marks them seen. The count is asked for on a timer of
about a minute and again whenever you come back to the window, rather than
pushed down a socket held open all day for a number that changes a few times.

## From an assistant

The tracker is offered over **MCP** as well as through this page. An assistant
can list issues, read one with its comments, open a new one, comment on it,
label it and close it, and wait on a feed of what has happened since it last
looked. It is the same workspace and the same permissions, and an issue is
addressed by the number people say, so #4 to an assistant is #4 here. See
Models and agents.

## Who can do what

Anyone who can see the workspace can read its issues, file one, comment, assign,
label, attach, link and delete. There is no second set of permissions here and
no per-issue access: an issue is part of the workspace, like everything else in
it.

The exceptions all protect authorship rather than the workspace: a comment is
edited only by whoever wrote it, and a file or a link is removed only by
whoever put it there.

Filing, closing, reopening, attaching, linking and deleting are written to the
workspace's audit log.
