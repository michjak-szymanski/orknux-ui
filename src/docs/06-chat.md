# Chat

Chat is a conversation with one of the workspace's models, or with one of its
agents. Each conversation has its own address, so a chat can be linked to and
reloaded.

Whether an installation has a chat at all is an administrator's decision; see
Administration.

![A conversation: the chats held on the left, the model answering above, and the
composer beneath](/screens/chat.png)

## Choosing what answers

The dropdown above the composer picks the model. Picking an agent instead gives
the conversation that agent's instructions, skills and tools. A new chat starts
on the workspace's default so there is always something to talk to.

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

A turn ends when you stop talking: about a second of quiet, once it has heard
speech, is taken as your turn ending — nothing is sent while a room is merely
quiet. A turn that runs past thirty seconds is sent anyway.

Tapping the circle interrupts: while it is speaking, it stops and listens;
while it is listening, it takes what you have said so far as the whole turn.

The transcript stays beside the panel, and a spoken conversation lands in it
exactly as a typed one does — same chat, same history — so the conversation can
be read back afterwards rather than only remembered. What it made of your last
turn is shown under the circle, where a mishearing is obvious.

Voice is offered only where the workspace has both a transcription model and a
speech model. A turn that fails — nothing transcribed, a provider that will not
answer — says so and goes back to listening rather than ending the conversation.

## Listening instead of reading

The speaker under an answer reads it aloud, using the workspace's text-to-speech
model. Pressing it again stops; so does leaving the chat, since an answer read
aloud over a conversation nobody is looking at is a voice from nowhere.

A long answer takes a moment to synthesise — the button says so while it does,
because a control that looks inert for ten seconds gets pressed twice. Only one
answer is read at a time.

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
Chat Model, and it is the same thing.

Bottom right of every page except this one, a small panel that answers about
**what you are looking at**. Not here, because a second conversation floating
over the one you already have open is two boxes to type a question into. It is told which page you have open, so "why did this fail" on a
run page means that run, and it can look up the workspace's workflows, runs and
agents to answer.

![Workspace settings, where the quick chat's model and whether it may make changes are chosen](/screens/workspace-settings.png)

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
