import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { FormEvent, KeyboardEvent } from 'react';

import {
  chooseChatAgent,
  chooseChatModel,
  deleteChat,
  fetchChatMessages,
  fetchChatSessions,
  fetchChatsMentioning,
  renameChat,
  streamChatMessage,
  setChatPinned,
  startChat,
  thinkingTime,
} from '../../api/chat';
import type { ChatMessage, ChatSession } from '../../api/chat';
import { fetchInstallationSettings } from '../../api/installation';
import {
  attachmentUrl,
  isShowable,
  fetchChatAttachments,
  formatSize,
  uploadAttachments,
} from '../../api/attachments';
import type { Attachment } from '../../api/attachments';
import { AttachmentViewer } from '../../components/AttachmentViewer';
import { answers, fetchModels } from '../../api/models';
import { speak } from '../../api/speech';
import { transcribe } from '../../api/transcription';
import { fetchWorkspace } from '../../api/workspaces';
import type { Model } from '../../api/models';
import { fetchWorkspaceAgents } from '../../api/agents';
import type { Agent } from '../../api/agents';
import type { SessionUser } from '../../api/session';
import { fetchWorkspaces } from '../../api/workspaces';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import copyIcon from '../../assets/copy.svg';
import cpuIcon from '../../assets/cpu.svg';
import messageSquareIcon from '../../assets/message-square.svg';
import penIcon from '../../assets/pen.svg';
import plusIcon from '../../assets/plus.svg';
import micIcon from '../../assets/mic.svg';
import searchIcon from '../../assets/search.svg';
// Grey, not red: it sits in the title bar beside search and rename as one
// action among several, and the confirm is where the warning belongs.
import trashIcon from '../../assets/trash-grey.svg';
import volume2Icon from '../../assets/volume-2.svg';
import { AppShell } from '../../components/AppShell';
import { VoiceMeter } from '../../components/VoiceMeter';
import { VoiceMode } from '../../components/VoiceMode';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { setSidebarCollapsed, useSidebarCollapsed } from '../../session/sidebar';
import { useInstallation } from '../../session/installation';
import { shellUser } from '../../session/user';
import { lastWorkspaceId } from '../../session/lastWorkspace';
import styles from './ChatPage.module.css';

export interface ChatPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** How many workspaces to look at when deciding which one to chat in. */
const WORKSPACE_LOOKUP = 100;

/** Which half of the model picker is showing. */
type PickerTab = 'models' | 'agents';

/**
 * Chat.
 *
 * A chat is one conversation, and the history behind it is Spring AI's, keyed
 * by a conversation id the server holds. That is the same shape a workflow run
 * will use, so what is typed here and what an agent says in a run end up in the
 * same kind of thread.
 */
/** How long typing has to stop before what was said is worth asking about. */
const SEARCH_PAUSE_MS = 300;

export function ChatPage({ session, onSignOut }: ChatPageProps) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  /*
   * Which chat is open, kept in the address bar.
   *
   * The URL is the state rather than a copy of it: a chat is a thing people
   * link to and reload, and a page that always opened the most recent one made
   * both of those impossible.
   */
  const { chatId = null } = useParams();
  const navigate = useNavigate();
  const currentId = chatId;

  /** Opens one, and says so in the address bar. */
  const setCurrentId = useCallback(
    (next: string | null | ((present: string | null) => string | null)) => {
      const chosen = typeof next === 'function' ? next(chatId) : next;
      if (chosen === chatId) return;
      // Replaced rather than pushed: moving between chats is not a trail
      // anybody wants to walk back through one Back press at a time.
      navigate(chosen === null ? '/chat' : `/chat/${chosen}`, { replace: true });
    },
    [chatId, navigate],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [search, setSearch] = useState('');
  /** Off by default: most searches are for a chat by name, not through everything said. */
  const [searchInMessages, setSearchInMessages] = useState(false);
  /** The recorder while something is being said, and null the rest of the time. */
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  /** The open microphone, for the meter to draw from while it is open. */
  const [listening, setListening] = useState<MediaStream | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  /** What is attached to the message being written, and the menu that adds to it. */
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  /** What has already been sent with this chat, for opening again later. */
  const [chatFiles, setChatFiles] = useState<Attachment[]>([]);
  /** The picture the viewer is showing, by id, or null when it is closed. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  /**
   * Which answer is being read aloud, by its place in the log.
   *
   * One at a time: two voices over each other is nobody's idea of listening, so
   * starting one stops the other. `fetching` is separate from `playing` because
   * synthesising a long answer takes seconds, and a button that looks inert for
   * those seconds gets pressed again.
   */
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [fetchingSpeech, setFetchingSpeech] = useState<number | null>(null);
  /** The audio in flight, so a second press can stop the first. */
  const playing = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  /** Which reading is wanted; a stale one arriving late is dropped rather than played. */
  const speechTicket = useRef(0);
  const [addOpen, setAddOpen] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  /** Whether this installation allows files at all; the button is absent when not. */
  const [attachmentsAllowed, setAttachmentsAllowed] = useState(false);
  /** The chats whose messages match, as the server last answered. */
  const [mentioning, setMentioning] = useState<string[]>([]);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerTab, setPickerTab] = useState<PickerTab>('models');
  const [pickerSearch, setPickerSearch] = useState('');

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** How long the last answer took; the log shows it under the model's name. */
  const [lastMillis, setLastMillis] = useState<number | null>(null);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Set when the collapsed search icon was the thing that opened the column. */
  const wantsSearch = useRef(false);
  const collapsed = useSidebarCollapsed();

  /*
   * The search box does not exist while the column is collapsed, so the caret
   * cannot be put in it until after it opens and renders.
   */
  useEffect(() => {
    if (collapsed || !wantsSearch.current) return;
    wantsSearch.current = false;
    searchRef.current?.focus();
  }, [collapsed]);

  /*
   * The chat screen names no workspace of its own, so it uses the one last
   * looked at — but only after checking that one still exists. A remembered id
   * outlives the workspace it points at (anything that rebuilds the database
   * gives them new ids), and a screen that trusts it asks about a workspace
   * nobody can see and quietly does nothing.
   */
  useEffect(() => {
    let abandoned = false;
    fetchWorkspaces(0, WORKSPACE_LOOKUP)
      .then((page) => {
        if (abandoned) return;
        const remembered = lastWorkspaceId();
        const live = page.content.find((entry) => entry.id === remembered) ?? page.content[0];
        setWorkspaceId(live?.id ?? null);
        if (live === undefined) setError('There is no workspace to chat in yet.');
      })
      .catch((cause: unknown) => {
        if (abandoned) return;
        setWorkspaceId(null);
        setError(cause instanceof Error ? cause.message : 'Could not find a workspace to chat in.');
      });
    return () => {
      abandoned = true;
    };
  }, []);

  const loadSessions = useCallback(
    async (select?: string) => {
      if (workspaceId === null) return;
      const loaded = await fetchChatSessions(workspaceId);
      setSessions(loaded);
      // Nothing in the address bar means "open the most recent one", which is
      // what somebody arriving at /chat expects; a chat named there wins.
      setCurrentId((present) => select ?? present ?? loaded[0]?.id ?? null);
    },
    [workspaceId, setCurrentId],
  );

  useEffect(() => {
    if (workspaceId === null) return;
    void loadSessions().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not load the chats.'),
    );
    fetchModels(workspaceId).then(setModels).catch(() => setModels([]));
    fetchWorkspaceAgents(workspaceId, 0, 100)
      .then((page) => setAgents(page.content))
      .catch(() => setAgents([]));
  }, [workspaceId, loadSessions]);

  /*
   * What the open chat holds.
   *
   * Cleared before the fetch, not after: leaving the old conversation on screen
   * until the new one arrives showed somebody else's messages under the name
   * they had just clicked. An answer that lands after the chat has changed
   * again is dropped for the same reason.
   */
  useEffect(() => {
    setMessages([]);
    setChatFiles([]);
    setLastMillis(null);
    if (currentId === null) return;

    let live = true;
    fetchChatAttachments(currentId)
      .then((held) => {
        if (live) setChatFiles(held);
      })
      .catch(() => undefined);
    fetchChatMessages(currentId)
      .then((held) => {
        if (live) setMessages(held);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [currentId]);

  /*
   * Clicking away closes it, the way every other menu here behaves.
   *
   * Escape too: a list opened by mistake should not need somebody to find the
   * button again to put it back.
   */
  useEffect(() => {
    if (!pickerOpen) return;

    function onDown(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    }

    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setPickerOpen(false);
    }

    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  // A new message should be the thing you are looking at.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const current = sessions?.find((entry) => entry.id === currentId) ?? null;

  /*
   * Whether this workspace has anything to transcribe with.
   *
   * Asked once, and the microphone is simply absent when the answer is no: a
   * button that fails every time it is pressed is worse than one that is not
   * offered.
   */
  const [hears, setHears] = useState(false);
  /** Whether a speech model is set, which is what puts a speaker under an answer. */
  const [reads, setReads] = useState(false);
  /*
   * Whether this chat is being held out loud.
   *
   * Needs both halves — something to hear with and something to answer with —
   * so it is offered only where the workspace has set both models.
   */
  const [voice, setVoice] = useState(false);

  useEffect(() => {
    if (workspaceId === null) return;
    fetchWorkspace(workspaceId)
      .then((held) => {
        setHears(held?.transcriptionModelId != null);
        setReads(held?.speechModelId != null);
      })
      .catch(() => {
        setHears(false);
        setReads(false);
      });
  }, [workspaceId]);

  /*
   * Leaving a chat, or the page, stops it talking.
   *
   * An answer read aloud outliving the conversation it belongs to is a voice
   * coming from nothing on screen — and on the way out there is nobody left to
   * press stop.
   */
  useEffect(() => hush, [currentId]);

  useEffect(() => {
    fetchInstallationSettings()
      .then((held) => setAttachmentsAllowed(held.attachmentsEnabled))
      .catch(() => setAttachmentsAllowed(false));
  }, []);

  // Someone on an old link, or with the page still open when it was switched
  // off. Sent to the documentation rather than left on a composer that refuses.
  const installation = useInstallation();
  const chatOff = installation !== null && !installation.chatEnabled;

  // The menu closes the way every other menu here does.
  useEffect(() => {
    if (!addOpen) return;

    function onDown(event: MouseEvent) {
      if (!addRef.current?.contains(event.target as Node)) setAddOpen(false);
    }

    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [addOpen]);

  /*
   * What was said is the server's to answer, so it is asked — but only while
   * the box is ticked, and only after typing stops. Titles stay a filter over
   * what the sidebar already holds, which is why they never wait for anything.
   */
  useEffect(() => {
    const needle = search.trim();
    if (!searchInMessages || needle === '' || workspaceId === null) {
      setMentioning([]);
      return;
    }

    const timer = window.setTimeout(() => {
      fetchChatsMentioning(workspaceId, needle)
        .then(setMentioning)
        // A search that could not be run finds nothing more than the titles do.
        .catch(() => setMentioning([]));
    }, SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [search, searchInMessages, workspaceId]);

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = sessions ?? [];
    if (needle === '') return all;

    const said = new Set(mentioning);
    return all.filter((entry) => entry.title.toLowerCase().includes(needle) || said.has(entry.id));
  }, [sessions, search, mentioning]);

  const pinned = matching.filter((entry) => entry.pinned);
  const recent = matching.filter((entry) => !entry.pinned);

  const pickerEntries = useMemo(() => {
    const needle = pickerSearch.trim().toLowerCase();
    const entries =
      pickerTab === 'models'
        ? models
            // A chat talks to a chat model. The audio kinds hear and read
            // instead, and picking one here would be a chat that cannot answer.
            .filter(answers)
            .map((model) => ({ id: model.id, label: model.name, enabled: model.enabled }))
        : agents.map((agent) => ({ id: agent.id, label: agent.name, enabled: agent.enabled }));
    return needle === '' ? entries : entries.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [pickerTab, models, agents, pickerSearch]);

  async function guard(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    }
  }

  async function handleNew() {
    // Saying why beats a button that looks like it did nothing.
    if (workspaceId === null) {
      setError('There is no workspace to chat in yet.');
      return;
    }
    await guard(async () => {
      const created = await startChat(workspaceId, 'New chat');
      await loadSessions(created.id);
    });
  }

  /**
   * Starts recording, or stops and sends what was said to be transcribed.
   *
   * The transcript is put into the box rather than sent: speech is how the
   * message was typed, not a decision to send it, and anything misheard is
   * fixed before anybody else sees it.
   */
  async function handleMicrophone() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (workspaceId === null) return;

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const held = new MediaRecorder(stream);
      const pieces: Blob[] = [];

      held.ondataavailable = (event) => {
        if (event.data.size > 0) pieces.push(event.data);
      };
      held.onstop = () => {
        // The light on the machine goes out when the tracks do, not when the
        // recorder stops.
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        setRecording(false);
        setListening(null);

        const said = new Blob(pieces, { type: held.mimeType });
        if (said.size === 0) return;

        setTranscribing(true);
        transcribe(workspaceId, said)
          .then((text) => {
            if (text.trim() === '') return;
            // Appended, so speaking twice adds to what is there rather than
            // replacing it, and so does speaking after typing.
            setDraft((current) => (current.trim() === '' ? text : `${current.trim()} ${text}`));
          })
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : 'That could not be transcribed.'),
          )
          .finally(() => setTranscribing(false));
      };

      recorder.current = held;
      setRecording(true);
      setListening(stream);
      held.start();
    } catch {
      setError('The microphone could not be opened. The browser may have refused it.');
    }
  }

  /**
   * Uploads what was picked and keeps it beside the message being written.
   *
   * Uploaded now rather than on send, so a large file is on its way while the
   * sentence is still being typed — and so a failure is a chip that did not
   * appear rather than a message that would not go.
   */
  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0 || workspaceId === null) return;

    setAttaching(true);
    setError(null);
    try {
      const held = await uploadAttachments(workspaceId, Array.from(files));
      setAttached((current) => [...current, ...held]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Those files could not be uploaded.');
    } finally {
      setAttaching(false);
      // Cleared so the same file can be picked twice in a row.
      if (filesRef.current !== null) filesRef.current.value = '';
    }
  }

  /**
   * Stops whatever is being read, and lets go of it.
   *
   * The object URL is revoked rather than left: a blob held by one keeps its
   * bytes for as long as the page is open, and a chat somebody listens through
   * would accumulate every answer it ever read.
   *
   * Bumping the ticket is what makes this stop a reading that has not arrived
   * yet — the request cannot be recalled, but its answer can be ignored.
   */
  function hush() {
    speechTicket.current += 1;
    const held = playing.current;
    if (held !== null) {
      held.audio.pause();
      URL.revokeObjectURL(held.url);
      playing.current = null;
    }
    setSpeaking(null);
    setFetchingSpeech(null);
  }

  /** Reads one answer aloud, or stops it if it is the one already talking. */
  async function readAloud(index: number, text: string) {
    if (workspaceId === null) return;

    // A second press on the one that is talking — or being fetched — is "stop".
    const stopping = speaking === index || fetchingSpeech === index;
    hush();
    if (stopping) return;

    const ticket = (speechTicket.current += 1);
    setError(null);
    setFetchingSpeech(index);
    try {
      const spoken = await speak(workspaceId, text);
      // Stopped, or another answer asked for, while this was being made.
      if (speechTicket.current !== ticket) return;

      const url = URL.createObjectURL(spoken);
      const audio = new Audio(url);
      playing.current = { audio, url };
      audio.addEventListener('ended', hush, { once: true });
      await audio.play();

      if (speechTicket.current !== ticket) return;
      setFetchingSpeech(null);
      setSpeaking(index);
    } catch (cause) {
      if (speechTicket.current !== ticket) return;
      hush();
      setError(cause instanceof Error ? cause.message : 'That could not be read aloud.');
    }
  }

  /**
   * One spoken turn: what was heard goes to the model, and the answer comes
   * back as text for the panel to read aloud.
   *
   * The same stream as the composer's, so a conversation held by voice lands in
   * the transcript exactly as a typed one does — same chat, same history, and
   * the answer grows on screen while it is still being spoken.
   */
  async function handleVoiceTurn(text: string, onProgress: (soFar: string) => void): Promise<string> {
    if (currentId === null) return '';

    setMessages((present) => [...present, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setError(null);

    let answer = '';
    let failure: string | null = null;
    await streamChatMessage(currentId, text, {
      onChunk: (piece) => {
        answer += piece;
        setMessages((present) => {
          const grown = [...present];
          const last = grown.length - 1;
          grown[last] = { ...grown[last], content: grown[last].content + piece };
          return grown;
        });
        // The panel reads whole sentences out of this while the rest is still
        // being written, so it is handed the answer so far rather than the
        // piece: what it needs to know is how much of it it has already read.
        onProgress(answer);
      },
      onDone: (millis) => setLastMillis(millis),
      onError: (reason) => {
        failure = reason;
      },
    });
    if (failure !== null) throw new Error(failure);
    await loadSessions(currentId);
    return answer;
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (currentId === null || draft.trim() === '' || sending) return;

    /*
     * What was attached is named in the message.
     *
     * The model cannot open a file yet — that is the next piece of this — but a
     * conversation that mentions "the log I attached" and shows nothing is worse
     * than one that lists what came with it.
     */
    const going = attached;
    /*
     * What was attached goes with the message rather than into it.
     *
     * Pictures are handed to the model as part of the turn — it can look at
     * them — so naming them in the text would only be describing what it can
     * already see. Anything it cannot open is still named, since otherwise the
     * conversation refers to a file that was never mentioned.
     */
    const unopenable = going.filter((file) => !file.contentType.startsWith('image/'));
    const said =
      unopenable.length === 0
        ? draft.trim()
        : `${draft.trim()}

Attached: ${unopenable.map((file) => file.filename).join(', ')}`;

    setSending(true);
    setDraft('');
    setAttached([]);
    // Shown straight away: the server has it, and waiting for the model to
    // finish before drawing what was typed reads as a dropped message.
    setMessages((present) => [...present, { role: 'user', content: said }]);
    setError(null);
    // The answer grows in place as it arrives, so the empty assistant turn is
    // appended first and each piece lands on the end of it.
    setMessages((present) => [...present, { role: 'assistant', content: '' }]);
    try {
      let failure: string | null = null;
      await streamChatMessage(
        currentId,
        said,
        {
          onChunk: (piece) =>
            setMessages((present) => {
              const grown = [...present];
              const last = grown.length - 1;
              grown[last] = { ...grown[last], content: grown[last].content + piece };
              return grown;
            }),
          onDone: (millis) => setLastMillis(millis),
          onError: (reason) => {
            failure = reason;
          },
        },
        going.map((file) => file.id),
      );
      if (failure !== null) throw new Error(failure);
      // The send tied them to the chat, so this only reads back what is there.
      if (going.length > 0) {
        await fetchChatAttachments(currentId)
          .then(setChatFiles)
          .catch(() => undefined);
      }
      await loadSessions(currentId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The model did not answer.');
      // What the server kept is the truth about what was said.
      fetchChatMessages(currentId).then(setMessages).catch(() => undefined);
    } finally {
      setSending(false);
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, shift+enter is a new line: what a chat box is expected to do.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend(event as unknown as FormEvent);
    }
  }

  async function handleRename(entry: ChatSession) {
    const title = window.prompt('Rename chat', entry.title);
    if (title === null || title.trim() === '') return;
    await guard(async () => {
      await renameChat(entry.id, title.trim());
      await loadSessions();
    });
    setMenuFor(null);
  }

  async function handleDelete(entry: ChatSession) {
    await guard(async () => {
      await deleteChat(entry.id);
      setCurrentId((present) => (present === entry.id ? null : present));
      await loadSessions();
    });
    setMenuFor(null);
  }

  async function handlePin(entry: ChatSession) {
    await guard(async () => {
      await setChatPinned(entry.id, !entry.pinned);
      await loadSessions();
    });
    setMenuFor(null);
  }

  /**
   * Both tabs land here: what the picker offers is who answers next, and an
   * agent answers by supplying its own model, so the two are the same choice
   * made in two ways.
   */
  async function handleChoose(id: string) {
    if (currentId === null) return;
    await guard(async () => {
      if (pickerTab === 'agents') await chooseChatAgent(currentId, id);
      else await chooseChatModel(currentId, id);
      await loadSessions(currentId);
    });
    setPickerOpen(false);
    setPickerSearch('');
  }

  function copy(text: string, index: number) {
    void navigator.clipboard?.writeText(text);
    setCopied(index);
    window.setTimeout(() => setCopied((present) => (present === index ? null : present)), 1200);
  }

  /*
   * One banner, drawn in whichever half is showing. It cannot simply sit above
   * both: the chat pane cancels the shell's padding with a negative margin and
   * would ride up over it, so anything failing while no chat is open would be
   * reported invisibly — which is exactly how a dead workspace hid itself.
   */
  const errorBanner =
    error === null ? null : (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );

  /*
   * Collapsed, the chat menu is two things: start one, or find one. A list of
   * titles squeezed into 64px is unreadable, and a search box with nowhere to
   * type is worse than none — so searching opens the column first and puts the
   * caret where it belongs.
   */
  const sidebar = collapsed ? (
    <div className={styles.sidebarCollapsed}>
      <button
        type="button"
        className={styles.collapsedAction}
        onClick={() => void handleNew()}
        aria-label="New chat"
        title="New chat"
      >
        <img src={plusIcon} alt="" width={14} height={14} />
      </button>
      <button
        type="button"
        className={styles.collapsedAction}
        onClick={() => {
          wantsSearch.current = true;
          setSidebarCollapsed(false);
        }}
        aria-label="Search chats"
        title="Search chats"
      >
        <img src={searchIcon} alt="" width={14} height={14} />
      </button>
    </div>
  ) : (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarTitle}>User Chats</span>
        <button type="button" className={styles.newButton} onClick={() => void handleNew()}>
          + New
        </button>
      </div>

      <div className={styles.searchBox}>
        <img src={searchIcon} alt="" width={11} height={11} />
        <input
          ref={searchRef}
          className={styles.searchInput}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search chats..."
          aria-label="Search chats"
        />
      </div>

      <label className={styles.searchScope}>
        <input
          type="checkbox"
          checked={searchInMessages}
          onChange={(event) => setSearchInMessages(event.target.checked)}
        />
        Search content
      </label>

      {sessions === null && <p className={styles.sidebarNotice}><Loader /></p>}
      {sessions?.length === 0 && <p className={styles.sidebarNotice}>No chats yet.</p>}

      {pinned.length > 0 && (
        <>
          <button type="button" className={styles.sectionHeader} onClick={() => setPinnedOpen(!pinnedOpen)}>
            <img
              className={pinnedOpen ? styles.sectionChevronOpen : styles.sectionChevron}
              src={chevronDown12Icon}
              alt=""
              width={8}
              height={6}
            />
            Pinned
          </button>
          {pinnedOpen && (
            <div className={styles.sessionList}>
              {pinned.map((entry) => (
                <SessionRow
                  key={entry.id}
                  entry={entry}
                  current={entry.id === currentId}
                  pinnedRow
                  menuOpen={menuFor === entry.id}
                  onSelect={() => setCurrentId(entry.id)}
                  onMenu={() => setMenuFor(menuFor === entry.id ? null : entry.id)}
                  onPin={() => void handlePin(entry)}
                  onRename={() => void handleRename(entry)}
                  onDelete={() => void handleDelete(entry)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {recent.length > 0 && (
        <>
          <button type="button" className={styles.sectionHeader} onClick={() => setRecentOpen(!recentOpen)}>
            <img
              className={recentOpen ? styles.sectionChevronOpen : styles.sectionChevron}
              src={chevronDown12Icon}
              alt=""
              width={8}
              height={6}
            />
            Recent
          </button>
          {recentOpen && (
            <div className={styles.sessionList}>
              {recent.map((entry) => (
                <SessionRow
                  key={entry.id}
                  entry={entry}
                  current={entry.id === currentId}
                  menuOpen={menuFor === entry.id}
                  onSelect={() => setCurrentId(entry.id)}
                  onMenu={() => setMenuFor(menuFor === entry.id ? null : entry.id)}
                  onPin={() => void handlePin(entry)}
                  onRename={() => void handleRename(entry)}
                  onDelete={() => void handleDelete(entry)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (chatOff) {
    return (
      <AppShell
        user={shellUser(session)}
        section="chat"
        showAdmin={session.admin}
        onSignOut={onSignOut}
        sidebar={null}
        hideSidebar
      >
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Chat is turned off</p>
          <p className={styles.emptyNote}>
            An administrator has switched chat off for this installation. The conversations already had
            are kept, and come back if it is switched on again.
          </p>
        </div>
      </AppShell>
    );
  }

  /*
   * What the viewer can step through, which is only ever one of these two rows.
   *
   * The picture that is open decides which: the files already sent and the ones
   * still being written are separate groups on screen, and arrowing out of the
   * one that was clicked into the other would be a surprise. Ids are unique, so
   * the group is simply whichever row holds it.
   */
  const chatPictures = chatFiles.filter((file) => isShowable(file.contentType));
  const composerPictures = attached.filter((file) => isShowable(file.contentType));
  const previewPictures = composerPictures.some((file) => file.id === previewId)
    ? composerPictures
    : chatPictures;

  return (
    <AppShell
      user={shellUser(session)}
      section="chat"
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={sidebar}
    >
      {current === null ? (
        <div className={styles.empty}>
          {errorBanner}
          <p className={styles.emptyTitle}>No chat open</p>
          <p className={styles.emptyNote}>
            Start one with <strong>+ New</strong>. Each chat is a conversation of its own, kept the same
            way a workflow run keeps the thread its agents share.
          </p>
        </div>
      ) : (
        <div className={styles.chatRow}>
        <div className={styles.chat}>
          <header className={styles.titleBar}>
            <h1 className={styles.chatTitle}>{current.title}</h1>
            <div className={styles.titleActions}>
              {hears && reads && (
                <button
                  type="button"
                  className={voice ? `${styles.iconButton} ${styles.iconButtonOn}` : styles.iconButton}
                  onClick={() => setVoice((on) => !on)}
                  aria-pressed={voice}
                  title={voice ? 'Leave voice mode' : 'Talk instead of typing'}
                  aria-label={voice ? 'Leave voice mode' : 'Enter voice mode'}
                >
                  <img src={volume2Icon} alt="" width={14} height={14} />
                </button>
              )}
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => document.getElementById('chat-search')?.focus()}
                title="Search chats"
                aria-label="Search chats"
              >
                <img src={searchIcon} alt="" width={14} height={14} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => void handleRename(current)}
                title="Rename this chat"
                aria-label="Rename this chat"
              >
                <img src={penIcon} alt="" width={14} height={14} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => void handleDelete(current)}
                title="Delete this chat"
                aria-label="Delete this chat"
              >
                <img src={trashIcon} alt="" width={14} height={14} />
              </button>
            </div>
          </header>

          <div className={styles.modelBar} ref={pickerRef}>
            <button
              type="button"
              className={styles.modelButton}
              onClick={() => setPickerOpen(!pickerOpen)}
              aria-expanded={pickerOpen}
            >
              <span className={current.modelName === null ? styles.modelUnset : styles.modelName}>
                {current.agentName ?? current.modelName ?? 'Choose a model'}
              </span>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </button>

            {pickerOpen && (
              <div className={styles.picker}>
                <div className={styles.pickerSearch}>
                  <img src={searchIcon} alt="" width={14} height={14} />
                  <input
                    className={styles.searchInput}
                    value={pickerSearch}
                    onChange={(event) => setPickerSearch(event.target.value)}
                    placeholder="Search"
                    aria-label="Search models"
                    autoFocus
                  />
                </div>
                <div className={styles.pickerTabs} role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={pickerTab === 'models'}
                    className={pickerTab === 'models' ? styles.pickerTabActive : styles.pickerTab}
                    onClick={() => setPickerTab('models')}
                  >
                    Models
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={pickerTab === 'agents'}
                    className={pickerTab === 'agents' ? styles.pickerTabActive : styles.pickerTab}
                    onClick={() => setPickerTab('agents')}
                  >
                    Agents
                  </button>
                </div>
                <div className={styles.pickerList}>
                  {pickerEntries.length === 0 && (
                    <p className={styles.pickerEmpty}>
                      {pickerTab === 'models'
                        ? 'No models in this workspace yet.'
                        : 'No agents in this workspace yet.'}
                    </p>
                  )}
                  {pickerEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={
                        entry.id === (pickerTab === 'agents' ? current.agentId : current.modelId)
                          ? styles.pickerEntryCurrent
                          : styles.pickerEntry
                      }
                      // An agent with no model cannot answer; the server says so
                      // too, but there is no reason to offer it as a choice.
                      disabled={!entry.enabled}
                      title={entry.enabled ? undefined : 'Not active'}
                      onClick={() => void handleChoose(entry.id)}
                    >
                      {entry.label}
                      {!entry.enabled && <span className={styles.pickerNote}>inactive</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={styles.log} ref={logRef}>
            {messages.length === 0 && (
              <p className={styles.logEmpty}>Nothing said yet. What is typed below starts the conversation.</p>
            )}

            {messages.map((message, index) =>
              message.role === 'user' ? (
                <div key={index} className={styles.userRow}>
                  <button
                    type="button"
                    className={styles.rowAction}
                    onClick={() => copy(message.content, index)}
                    title="Copy"
                    aria-label="Copy this message"
                  >
                    <img src={copyIcon} alt="" width={14} height={14} />
                  </button>
                  <div className={styles.userBubble}>{message.content}</div>
                </div>
              ) : (
                <div key={index} className={styles.assistantRow}>
                  <span className={styles.assistantAvatar} aria-hidden="true">
                    <img src={cpuIcon} alt="" width={16} height={16} />
                  </span>
                  <div className={styles.assistantBody}>
                    <span className={styles.assistantName}>
                      {current.agentName ?? current.modelName ?? 'assistant'}
                    </span>
                    {/* Only the answer just given has a time behind it. */}
                    {lastMillis !== null && index === messages.length - 1 && (
                      <button
                        type="button"
                        className={styles.thought}
                        onClick={() => setThoughtOpen(!thoughtOpen)}
                        aria-expanded={thoughtOpen}
                      >
                        Thought for {thinkingTime(lastMillis)}
                        <img
                          className={thoughtOpen ? styles.thoughtChevronOpen : styles.thoughtChevron}
                          src={chevronDown12Icon}
                          alt=""
                          width={10}
                          height={10}
                        />
                      </button>
                    )}
                    {thoughtOpen && lastMillis !== null && index === messages.length - 1 && (
                      <p className={styles.thoughtDetail}>
                        The provider took {lastMillis} ms to answer. Nothing else is recorded: the history
                        keeps what was said, not how it was arrived at.
                      </p>
                    )}
                    {/* Models write markdown; showing the source shows the asterisks. */}
                    <Markdown>{message.content}</Markdown>
                    <div className={styles.assistantActions}>
                      <button
                        type="button"
                        className={styles.rowAction}
                        onClick={() => copy(message.content, index)}
                        title="Copy"
                        aria-label="Copy this answer"
                      >
                        <img src={copyIcon} alt="" width={14} height={14} />
                      </button>
                      {/*
                        Only where a speech model is set. A speaker that always
                        appeared and always failed would be worse than none.
                      */}
                      {reads && message.content.trim() !== '' && (
                        <button
                          type="button"
                          className={
                            speaking === index ? `${styles.rowAction} ${styles.rowActionOn}` : styles.rowAction
                          }
                          onClick={() => void readAloud(index, message.content)}
                          aria-pressed={speaking === index}
                          title={
                            fetchingSpeech === index
                              ? 'Reading it…'
                              : speaking === index
                                ? 'Stop'
                                : 'Read this answer aloud'
                          }
                          aria-label={speaking === index ? 'Stop reading' : 'Read this answer aloud'}
                        >
                          <img src={volume2Icon} alt="" width={14} height={14} />
                        </button>
                      )}
                      {fetchingSpeech === index && <span className={styles.copied}>Reading…</span>}
                      {copied === index && <span className={styles.copied}>Copied</span>}
                    </div>
                  </div>
                </div>
              ),
            )}

            {/*
              Only until the model actually starts. The answer streams into an
              assistant turn that begins empty, so an empty last message is the
              wait itself — once a token lands there is something to read, and
              saying "Waiting" over the top of it is just wrong.
            */}
            {sending && messages[messages.length - 1]?.content === '' && (
              <div className={styles.assistantRow}>
                <span className={styles.assistantAvatar} aria-hidden="true">
                  <img src={cpuIcon} alt="" width={16} height={16} />
                </span>
                <p className={styles.waiting}>Waiting for {current.agentName ?? current.modelName ?? 'the model'}…</p>
              </div>
            )}
          </div>

          {errorBanner}

          {/*
            What has been sent with this chat, openable again.
            
            Above the composer rather than inside a message, because nothing
            records which message a file came with — and "the document we were
            looking at" is what somebody comes back for anyway.
          */}
          {chatFiles.length > 0 && (
            <div className={styles.chatFiles}>
              <span className={styles.chatFilesLabel}>Files</span>
              {/*
                A picture opens in the viewer; anything else downloads.

                Not a choice about taste — the server sends everything that is
                not a picture as an octet-stream marked `attachment`, so there
                is nothing a viewer could show. The download is direct rather
                than through a new tab, which used to open, save and close.
              */}
              {chatFiles.map((file) =>
                isShowable(file.contentType) ? (
                  <button
                    key={file.id}
                    type="button"
                    className={styles.chatImage}
                    onClick={() => setPreviewId(file.id)}
                    title={`Open ${file.filename}`}
                  >
                    {/* A screenshot is worth more as itself than as its filename. */}
                    <img className={styles.thumb} src={attachmentUrl(file.id)} alt={file.filename} />
                  </button>
                ) : (
                  <a
                    key={file.id}
                    className={styles.chatFile}
                    href={attachmentUrl(file.id)}
                    download={file.filename}
                    title={`Download ${file.filename}`}
                  >
                    <span className={styles.attachmentName}>{file.filename}</span>
                    <span className={styles.attachmentSize}>{formatSize(file.sizeBytes)}</span>
                  </a>
                ),
              )}
            </div>
          )}

          <form className={styles.composer} onSubmit={handleSend}>
            {/* What is going with the message, above the box it is going from. */}
            {attached.length > 0 && (
              <div className={styles.attachments}>
                {attached.map((file) => (
                  <span key={file.id} className={styles.attachment}>
                    {isShowable(file.contentType) && (
                      <button
                        type="button"
                        className={styles.thumbButton}
                        onClick={() => setPreviewId(file.id)}
                        title={`Open ${file.filename}`}
                      >
                        <img className={styles.thumbSmall} src={attachmentUrl(file.id)} alt="" />
                      </button>
                    )}
                    {isShowable(file.contentType) ? (
                      <button
                        type="button"
                        className={styles.attachmentName}
                        onClick={() => setPreviewId(file.id)}
                        title={`Open ${file.filename}`}
                      >
                        {file.filename}
                      </button>
                    ) : (
                      <a
                        className={styles.attachmentName}
                        href={attachmentUrl(file.id)}
                        download={file.filename}
                        title={`Download ${file.filename}`}
                      >
                        {file.filename}
                      </a>
                    )}
                    <span className={styles.attachmentSize}>{formatSize(file.sizeBytes)}</span>
                    <button
                      type="button"
                      className={styles.attachmentRemove}
                      onClick={() => setAttached((current) => current.filter((held) => held.id !== file.id))}
                      aria-label={`Remove ${file.filename}`}
                      title="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className={styles.composerBox}>
              {/*
                One button, one menu, and for now one thing in it. A dropdown
                rather than a paperclip because what can be added to a message
                is going to grow, and a row of icons is how that goes wrong.
              */}
              {attachmentsAllowed && (
                <div className={styles.addWrapper} ref={addRef}>
                  <button
                    type="button"
                    className={styles.addButton}
                    onClick={() => setAddOpen((open) => !open)}
                    disabled={attaching}
                    aria-haspopup="menu"
                    aria-expanded={addOpen}
                    aria-label="Add to this message"
                    title={attaching ? 'Uploading…' : 'Add to this message'}
                  >
                    +
                  </button>
                  {addOpen && (
                    <div className={styles.addMenu} role="menu">
                      <button
                        type="button"
                        className={styles.addMenuItem}
                        role="menuitem"
                        onClick={() => {
                          setAddOpen(false);
                          filesRef.current?.click();
                        }}
                      >
                        Upload files
                      </button>
                    </div>
                  )}
                  <input
                    ref={filesRef}
                    className={styles.hiddenAnchor}
                    type="file"
                    multiple
                    onChange={(event) => void handleFiles(event.target.files)}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                </div>
              )}
              <textarea
                id="chat-composer"
                className={styles.composerInput}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKey}
                placeholder="Type a message..."
                rows={1}
                aria-label="Message"
              />
              {/*
                Speech goes into the box, not out to the model: what was heard
                is a draft like any other, and a mishearing is fixed before
                anybody else reads it.
              */}
              {/* What the microphone is hearing, while it hears it. */}
              {listening !== null && <VoiceMeter stream={listening} />}
              {hears && (
                <button
                  type="button"
                  className={recording ? `${styles.micButton} ${styles.micRecording}` : styles.micButton}
                  onClick={() => void handleMicrophone()}
                  disabled={transcribing}
                  aria-pressed={recording}
                  aria-label={recording ? 'Stop recording' : 'Record a message'}
                  title={
                    transcribing
                      ? 'Transcribing…'
                      : recording
                        ? 'Stop and transcribe'
                        : 'Record a message'
                  }
                >
                  <img src={micIcon} alt="" width={16} height={16} />
                </button>
              )}
              <button
                type="submit"
                className={styles.sendButton}
                disabled={sending || draft.trim() === ''}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
        {voice && workspaceId !== null && (
          <VoiceMode
            workspaceId={workspaceId}
            onSay={handleVoiceTurn}
            onClose={() => setVoice(false)}
          />
        )}
        </div>
      )}
      {/* The title bar's search focuses the sidebar's box, which is the one that filters. */}
      <input id="chat-search" className={styles.hiddenAnchor} tabIndex={-1} aria-hidden="true" readOnly />

      <AttachmentViewer
        images={previewPictures}
        openId={previewId}
        onClose={() => setPreviewId(null)}
        onOpen={setPreviewId}
      />
    </AppShell>
  );
}

function SessionRow({
  entry,
  current,
  pinnedRow,
  menuOpen,
  onSelect,
  onMenu,
  onPin,
  onRename,
  onDelete,
}: {
  entry: ChatSession;
  current: boolean;
  pinnedRow?: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onMenu: () => void;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`${styles.sessionRow} ${current ? styles.sessionRowCurrent : ''}`}>
      <button type="button" className={styles.sessionButton} onClick={onSelect}>
        {pinnedRow ? (
          <span className={styles.pinDot} aria-hidden="true" />
        ) : (
          <img src={messageSquareIcon} alt="" width={14} height={14} />
        )}
        <span className={styles.sessionTitle}>{entry.title}</span>
      </button>
      <button
        type="button"
        className={styles.sessionMenuButton}
        onClick={onMenu}
        aria-label={`Actions for ${entry.title}`}
        aria-expanded={menuOpen}
      >
        ⋮
      </button>

      {menuOpen && (
        <div className={styles.contextMenu} role="menu">
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onPin}>
            {entry.pinned ? 'Unpin chat' : 'Pin chat'}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onRename}>
            Rename chat
          </button>
          <button type="button" role="menuitem" className={styles.menuItemDanger} onClick={onDelete}>
            Delete chat
          </button>
        </div>
      )}
    </div>
  );
}
