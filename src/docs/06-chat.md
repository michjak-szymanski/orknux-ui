# Chat

Chat is a conversation with one of the workspace's models, or with one of its
agents. Each conversation has its own address, so a chat can be linked to and
reloaded.

Whether an installation has a chat at all is an administrator's decision; see
Administration.

![A conversation: the chats held on the left, the model answering above, and the
composer beneath](/screens/chat.png)

## Choosing what answers

The dropdown above the composer picks what answers. Agents are the half it
opens on, because an agent brings the conversation its instructions, skills and
tools and supplies a model of its own; the Models tab beside it is the bare
models, and a chat already pointed at one opens there instead. A new chat starts
on the workspace's default so there is always something to talk to.

Beside the name is the arrow that leaves a box, the same one every field naming
a definition carries: it opens whatever is answering — the agent, or the model —
in a tab of its own, so a question about what the thing is set to does not cost
you the conversation.

Switching workspace from the corner leaves you in the chat rather than taking
you to the new workspace's workflows: the conversations listed on the left are
the ones held in whichever workspace the corner names.

## Asking again

Under the last answer is a circling arrow: it asks the same question again.
Whatever the dropdown says answers this chat is what answers, so a different
model or agent means picking one first — moving the dropdown and pressing this
is "answer that again, as somebody else".

Nothing is lost by pressing it. The answer it replaces is kept, and the row
underneath says which take you are reading — **1 of 2**, with a chevron either
side — so the one you had is one press away, and stays there.

Only the answer the conversation ends on can be asked again. Anything earlier
has been answered on top of, and a different answer there would rewrite what the
turns after it were replying to.

## Attachments

The **+** to the left of the composer attaches files — several at once. They
are stored on the server, in a directory of their own per workspace, and can be
opened from the message they were sent with. A chat's files are as private as
the chat: they are readable by whoever the conversation belongs to rather than
by everybody who can see the workspace, and one still sitting in a composer
belongs to whoever uploaded it until the message carrying it is sent. An issue's
files are different, and deliberately so - those belong to the people working
the issue, which is the whole workspace. Images are previewed in the chat
and are sent to the model as images, so a model that can see will describe what
is in the picture.

Attachments can be switched off for the whole installation. When they are off,
the button is not offered.

## Speaking instead of typing

The microphone to the left of Send records, and sends what it recorded to the
workspace's speech-to-text model. While it records, a meter shows what it is
hearing across five registers — a muted microphone and a working one look
identical otherwise.

Recording is converted to 16 kHz mono WAV in the browser before it is sent,
because that is what transcription servers actually decode.

The microphone appears only once the workspace has a transcription model.

## Talking to it

**Voice** — the filled circle with a waveform in it, beside the microphone at
the end of the message box — holds the conversation out loud: it listens, sends
what it heard, reads the answer back, and listens again — no key pressed
between turns.

The panel is one large circle, and the circle is the state:

| It looks like | It is |
| --- | --- |
| Moving with your voice | **Listening** — speak, and it answers when you stop |
| Breathing on its own | **Thinking** — the model has your turn |
| Ringing outward | **Speaking** — reading the answer back |

A turn ends when you stop talking: two and a half seconds of quiet, once it has
heard speech, is taken as your turn ending — nothing is sent while a room is
merely quiet. What counts as speech is measured against the room rather than
against a fixed loudness, so a quiet voice in a quiet room is still a voice. A
microphone nothing else has closed gives up after ten minutes, which is a fuse
for one left open in an empty room and not a limit on how much you may say.

A workspace can move all three, under **Workspace Settings → Voice**, because
none of them is a fact about audio that one answer settles — it is a room, a
microphone and a person, and those differ:

![Workspace settings: the models a chat may speak and listen with, and the three
boxes voice mode is governed by](/screens/workspace-settings.png)

| Setting | What it does |
| --- | --- |
| Pause before it answers | How long you can go quiet before it answers. Raise it if it cuts in while you are still talking; lower it if it sits there after you have finished |
| Voice above the room | How far above the room's own noise a sound has to stand to count as a voice. Turn it down if it stops while you are still talking, or if you speak quietly; up where a fan or a conversation behind you is heard as you and the turn never ends |
| Unattended microphone | How long an open microphone stays open where no pause ever comes |

Each box is empty until somebody sets it, and empty is voice mode's own value —
what the empty box says. Emptying one again puts it back rather than leaving it
on whatever was set last. A value outside what is allowed is refused when it is
saved, in a sentence naming what is allowed.

Tapping the circle interrupts: while it is thinking or speaking, it drops that
turn and listens; while it is listening, it takes what you have said so far as
the whole turn.

**The microphone does not close between turns.** Anything said while the model
is thinking or the answer is being read is held rather than lost, and is sent
when the turn comes round — the panel shows it under the circle, marked
**Waiting**, so you can see it was caught. A second thing said while one is
already waiting is added to it, since both were said to the same turn. Cutting
in with the circle throws the waiting message away: it means "listen to me now",
and answering what you had already moved on from is not that.

You can type as well as speak. The message box stays live while the panel is
open, and what is sent from it is a turn like any other — held by the same rules
and read back aloud in the same way.

The transcript stays beside the panel, and a spoken conversation lands in it
exactly as a typed one does — same chat, same history, and the same *Waiting for…*
under the turn while the model works — so the conversation can be read back
afterwards rather than only remembered. What it made of your last turn is shown
under the circle, where a mishearing is obvious.

Voice is offered only where the workspace has both a transcription model and a
speech model. A turn that fails — nothing transcribed, a provider that will not
answer — says so and goes back to listening rather than ending the conversation.

## Listening instead of reading

The speaker under an answer reads it aloud, using the workspace's text-to-speech
model. Pressing it again stops; so does leaving the chat, since an answer read
aloud over a conversation nobody is looking at is a voice from nowhere.

Reading starts on the first sentences rather than on the whole answer, so a long
one begins about as quickly as a short one; the rest is made while what you are
hearing plays. The button says it is working until sound actually starts,
because a control that looks inert gets pressed twice. Only one answer is read
at a time.

What is read is what the answer *renders to*, not the markdown it is written in:
no asterisks, no backticks, no hashes in front of a heading, and a link is read
as its text rather than as its address. A fenced code block is announced rather
than read out — a block of code said character by character is minutes nobody
can follow, and saying nothing at all leaves the answer referring to something
you were never told was there.

The audio is played and not kept: nothing is written to the server, and the
speaker appears only once the workspace has a speech model.

## Attachments, previewed

Clicking a picture in a chat opens it over the conversation rather than in a new
tab, with the arrow keys stepping between the pictures in the same group.
Anything that is not a picture downloads instead — the server sends those as
attachments, so there is nothing a viewer could show.

## The AI button

![The quick chat, open over a page and answering about what is on it](/screens/quick-chat.png)

The **quick chat** — the button says AI, workspace settings calls it the Quick
Chat Model, and it is the same thing. It is not the chat this chapter is
otherwise about: an installation with chat switched off still has it, and what
takes it away is choosing None for its model.

Bottom right of every page except this one, a small panel that answers about
**what you are looking at**. Not here, because a second conversation floating
over the one you already have open is two boxes to type a question into. It is told which page you have open, so "why did this fail" on a
run page means that run, and it can look up the workspace's workflows, runs and
agents to answer.

It reads and nothing else, unless the workspace says otherwise — **Let it make
changes** under Settings. Off, it says plainly that it cannot. On, it can act on
the workspace when asked: start a run, repeat a past one on the same input, and
turn a workflow or an agent on or off. Those are real — a run that messaged
somebody messages them again, and a workflow switched off stops answering its
trigger.

Nothing deletes, either way. There is no tool here that removes a workflow, a
run or a credential, whatever the switch says.

Off is the default, including for a workspace that has already chosen a model:
the panel opens over whatever somebody happens to be reading, and a model that
decides "run it" from a question is a worse mistake there than on a page with a
button on it.

Nothing it is told is written down: the conversation lives in the browser until
the panel is closed.

Which model answers is also set per workspace, and the button appears only once
one has been chosen.

## Finding a conversation

**Search content** looks inside the messages rather than only at chat names. It
is off by default: most searches are for a chat by its name, and reading
everything ever said is a different question.
