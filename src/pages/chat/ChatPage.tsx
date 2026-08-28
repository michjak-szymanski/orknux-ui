import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FormEvent, KeyboardEvent } from 'react';

import {
  CALL_ROLE,
  chooseChatAgent,
  deleteChat,
  fetchChatMessages,
  fetchChatSessions,
  fetchChatsMentioning,
  regenerateChatAnswer,
  renameChat,
  streamChatMessage,
  setChatPinned,
  startChat,
  costAmount,
  spendKnown,
  thinkingTime,
  tokenCount,
} from '../../api/chat';
import type { ChatCall, ChatMessage, ChatSession, ChatSpend, ChatStreamHandlers } from '../../api/chat';
import { givenUp } from '../../api/sse';
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
import { CallLine } from '../../components/CallLine';
import { Thinking } from '../../components/Thinking';
import { CHUNKING_DEFAULT, readAloud } from '../../components/readAloud';
import type { Reading, SpeechChunking } from '../../components/readAloud';
import { transcribe } from '../../api/transcription';
import { fetchWorkspace } from '../../api/workspaces';
import { fetchWorkspaceAgents } from '../../api/agents';
import type { Agent } from '../../api/agents';
import type { SessionUser } from '../../api/session';
import { fetchWorkspaces } from '../../api/workspaces';
import audioLinesIcon from '../../assets/audio-lines.svg';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import copyIcon from '../../assets/copy.svg';
import cpuIcon from '../../assets/cpu.svg';
import messageSquareIcon from '../../assets/message-square.svg';
import penIcon from '../../assets/pen.svg';
import plusIcon from '../../assets/plus.svg';
import micIcon from '../../assets/mic.svg';
import refreshCwIcon from '../../assets/refresh-cw.svg';
import searchIcon from '../../assets/search.svg';
// Grey, not red: it sits in the title bar beside search and rename as one
// action among several, and the confirm is where the warning belongs.
import trashIcon from '../../assets/trash-grey.svg';
import volume2Icon from '../../assets/volume-2.svg';
import xIcon from '../../assets/x.svg';
import { AppShell } from '../../components/AppShell';
import { CatalogueNote, useCatalogue } from '../../components/Catalogue';
import { VoiceMeter } from '../../components/VoiceMeter';
import { VoiceMode } from '../../components/VoiceMode';
import type { VoiceModeHandle, VoicePhase, VoiceTurnTaking } from '../../components/VoiceMode';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { setSidebarCollapsed, useSidebarCollapsed } from '../../session/sidebar';
import { useInstallation } from '../../session/installation';
import { shellUser } from '../../session/user';
import { useLastWorkspaceId } from '../../session/lastWorkspace';
import { FieldHint } from '../../components/FieldHint';
import { OpenDefinitionIcon } from '../../components/OpenDefinitionIcon';
import styles from './ChatPage.module.css';
import { t, tf } from '../../i18n';

export interface ChatPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** How many workspaces to look at when deciding which one to chat in. */
const WORKSPACE_LOOKUP = 100;

/**
 * What the answer being written now has thought and looked up.
 *
 * One of these belongs to one turn. See the `working` state for why none of it
 * is written down, and for the one part of it that is.
 */
interface Working {
  /** What the model thought, joined as the pieces arrive. */
  thinking: string;
  /** The lookups it made, in the order it made them. */
  calls: ChatCall[];
}

/** A turn that has done nothing yet, which is also what a new chat shows. */
const NOTHING_YET: Working = { thinking: '', calls: [] };

/** Whether there is anything of the working to draw. */
const anyWorking = (working: Working) => working.thinking.trim() !== '' || working.calls.length > 0;

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
  const [search, setSearch] = useState('');
  /** Off by default: most searches are for a chat by name, not through everything said. */
  const [searchInMessages, setSearchInMessages] = useState(false);
  /** The recorder while something is being said, and null the rest of the time. */
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  /** The open microphone, for the meter to draw from while it is open. */
  const [listening, setListening] = useState<MediaStream | null>(null);
  /**
   * The same microphone, in a ref.
   *
   * Closing it has to be possible from a cleanup that runs as this page leaves,
   * and state read in a cleanup is whatever it was when that cleanup was made.
   */
  const microphone = useRef<MediaStream | null>(null);
  /** True once this page is on its way out, so nothing lands in it afterwards. */
  const leaving = useRef(false);
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
  /**
   * The reading in flight, so a second press can stop the first.
   *
   * One object per reading rather than a ticket compared against a counter: the
   * reading is a sentence at a time now, so what a stop has to reach is a queue,
   * a request in the air and a clip playing, and holding all three together is
   * the only way none of them is forgotten.
   */
  const reading = useRef<Reading | null>(null);
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
  const [pickerSearch, setPickerSearch] = useState('');

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /**
   * The request answering the turn in flight, so it can be stopped.
   *
   * A ref rather than state because nothing on the screen is drawn from it —
   * `sending` is what the composer reads — and because the handler that aborts
   * it has to reach the one that is running now rather than the one that was
   * running when its closure was made.
   *
   * Every door into the model puts its controller here: a typed send, a spoken
   * turn, and asking for the answer again. One at a time, because a chat only
   * ever has one answer being written.
   */
  const asking = useRef<AbortController | null>(null);
  /**
   * What the last answer took and cost; the log shows it under the model's name.
   *
   * The last answer only, and held in state rather than on the message, because
   * none of it is written down: the history keeps what was said. An answer read
   * back off the server after a reload has no time behind it and no cost either,
   * which is the honest answer rather than a gap to be filled with noughts.
   */
  const [lastSpend, setLastSpend] = useState<ChatSpend | null>(null);
  /**
   * What the answer being written now is thinking, and what it has looked up.
   *
   * The working of one turn, held beside the log rather than in it, for the same
   * reason `lastSpend` is: none of it is in the chat history. The history is
   * Spring AI's store and keeps a role, some text and an order — what a model
   * thought is not something anybody said, and a lookup is not a turn.
   *
   * ## So it is not kept, and that is a decision
   *
   * Issue #227 reached this boundary with the cost of an answer and settled it
   * the same way: the number is shown on the answer it belongs to and is gone on
   * reload, because inventing a messages table to hold it is the one thing the
   * architecture rules out. Thinking is a much larger version of the same
   * question — kilobytes per answer rather than three integers — and the case
   * for keeping it is weaker, not stronger: it is the model talking to itself,
   * it is never sent back to the model, and nothing downstream reads it.
   *
   * The lookups are the exception that proves it. They *are* kept, because they
   * were already being kept for another reason: an agent chat records its round
   * into an LLM session, which is a transcript in its own right, and the log
   * puts them back off that when the page loads. So a reload keeps the calls and
   * loses the thinking, which is exactly what each of them is worth.
   *
   * ## Cleared at the start of a turn, not at the end of one
   *
   * It stays on screen once the answer lands: somebody reads the answer and then
   * asks why it says that. The next send is what clears it, since by then it is
   * working that belongs to a turn further up the log with no way to draw it
   * there.
   */
  const [working, setWorking] = useState<Working>(NOTHING_YET);
  /**
   * The thinking accumulated for the turn in flight, for `onDone` to read.
   *
   * A ref beside the state rather than instead of it: the state is what draws
   * the block as the pieces land, and this is what the end of the stream reads
   * to put the finished thinking on the message itself. Once it is there, live
   * and reloaded draw from the same place.
   */
  const thinkingSoFar = useRef('');
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  /**
   * Which take of an answer is being read, for the answers that have more than
   * one, by their place in the log.
   *
   * Absent means the one that stands, which is what every answer shows until
   * somebody steps back through it — and what an answer goes back to showing
   * the moment it is asked for again. Cleared with the chat, since the numbers
   * are places in a log that has been replaced.
   */
  const [takeAt, setTakeAt] = useState<Record<number, number>>({});

  const logRef = useRef<HTMLDivElement>(null);
  /*
   * The same element, as state.
   *
   * A ref alone cannot say *when* it was attached, and this one is attached on a
   * render that changes neither the turns nor which chat is open - so an effect
   * keyed on those two ran three times with nothing to scroll and never again
   * once there was. Holding it as state makes the attachment itself the thing
   * the effect waits for.
   */
  const [logBox, setLogBox] = useState<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Set when the collapsed search icon was the thing that opened the column. */
  const wantsSearch = useRef(false);
  /** The chat a delete is being asked about, or null when nothing is. */
  const [deleting, setDeleting] = useState<ChatSession | null>(null);
  /*
   * Finding something in the conversation that is open.
   *
   * A different act from the sidebar's box, which asks "which chat was that
   * in" and filters a list of titles. This one asks "where in this one did we
   * say that", and the answer is a position in the log. The magnifier in the
   * title bar used to do neither - it focused a hidden input - and then, for a
   * while, the first one, which is the wrong question for a control that sits
   * above the conversation rather than above the list.
   */
  const [finding, setFinding] = useState(false);
  const [find, setFind] = useState('');
  const [findAt, setFindAt] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  /*
   * Which turns carry what is being looked for.
   *
   * Whole messages rather than the run of characters inside one: an answer is
   * drawn as markdown, so highlighting a substring there means reaching into
   * rendered output rather than text. A conversation is read a turn at a time
   * anyway - what somebody wants is to be taken to the exchange, and the
   * exchange is the unit the eye is already using.
   */
  const findHits = useMemo(() => {
    const needle = find.trim().toLowerCase();
    if (needle === '') return [];
    return messages.reduce<number[]>((found, message, index) => {
      if (message.content.toLowerCase().includes(needle)) found.push(index);
      return found;
    }, []);
  }, [find, messages]);

  /* A new search starts at its first hit, not wherever the last one had got to. */
  useEffect(() => {
    setFindAt(0);
  }, [find]);

  /* Taking the reader to the hit is the whole point; nothing else moves. */
  useEffect(() => {
    if (findHits.length === 0) return;
    const at = logRef.current?.querySelector('[data-find="at"]');
    at?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [findAt, findHits]);

  const stepFind = (by: number) => {
    if (findHits.length === 0) return;
    setFindAt((was) => (was + by + findHits.length) % findHits.length);
  };

  const closeFind = () => {
    setFinding(false);
    setFind('');
    setFindAt(0);
  };

  /**
   * What to mark a turn with: the one being looked at, one of the others that
   * matched, or nothing.
   */
  const findMark = (index: number): string | undefined => {
    if (findHits.length === 0) return undefined;
    if (findHits[findAt] === index) return 'at';
    return findHits.includes(index) ? 'hit' : undefined;
  };
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
   *
   * Watched rather than read once. The selector in the corner leaves this page
   * where it is now, so it is the only thing that says the chat is about
   * another workspace — read at mount, switching looked like it had done
   * nothing at all (issue #250).
   */
  const remembered = useLastWorkspaceId();

  useEffect(() => {
    let abandoned = false;
    fetchWorkspaces(0, WORKSPACE_LOOKUP)
      .then((page) => {
        if (abandoned) return;
        const live = page.content.find((entry) => entry.id === remembered) ?? page.content[0];
        setWorkspaceId(live?.id ?? null);
        if (live === undefined) setError(t('There is no workspace to chat in yet.'));
      })
      .catch((cause: unknown) => {
        if (abandoned) return;
        setWorkspaceId(null);
        setError(cause instanceof Error ? cause.message : t('Could not find a workspace to chat in.'));
      });
    return () => {
      abandoned = true;
    };
  }, [remembered]);

  const loadSessions = useCallback(
    async (select?: string) => {
      if (workspaceId === null) return;
      const loaded = await fetchChatSessions(workspaceId);
      setSessions(loaded);
      // Nothing in the address bar means "open the most recent one", which is
      // what somebody arriving at /chat expects; a chat named there wins.
      //
      // A chat that is not in this list is not this workspace's — the corner
      // changed what the page is about, or the chat was deleted somewhere else
      // — and holding on to its id draws the empty state over a workspace full
      // of conversations.
      setCurrentId((present) => {
        if (select !== undefined) return select;
        if (present !== null && loaded.some((entry) => entry.id === present)) return present;
        return loaded[0]?.id ?? null;
      });
    },
    [workspaceId, setCurrentId],
  );

  useEffect(() => {
    if (workspaceId === null) return;
    void loadSessions().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : t('Could not load the chats.')),
    );
  }, [workspaceId, loadSessions]);

  /*
   * What the chat can be pointed at.
   *
   * The models were fetched beside this and are not any more: a chat is pointed
   * at an agent, and the agent brings its model (issue #295). The model's *name*
   * is still shown for a chat that was started on a bare model, but that comes
   * off the chat itself as `modelName` rather than out of a list.
   *
   * A catalogue rather than a plain fetch, and it matters here more than it did.
   * It used to end `.catch(() => setAgents([]))`, which meant a server that had
   * gone away left a picker saying this workspace has no agents - and that
   * sentence now carries "add one" behind it, so getting it wrong sends somebody
   * off to build an agent they already have.
   */
  /**
   * Whether the agents have actually been counted, as opposed to not asked for
   * yet.
   *
   * `loading` cannot answer this on its own. It starts false while the workspace
   * is still being worked out, and there is one render between the workspace
   * arriving and the effect setting it true - one frame in which an empty list
   * is indistinguishable from a counted one. That frame is enough to flash "No
   * agent to chat with" across the top of a workspace that has a dozen.
   */
  const [counted, setCounted] = useState(false);
  const agentCatalogue = useCatalogue<Agent>(
    'agents in this workspace',
    async () => (await fetchWorkspaceAgents(workspaceId ?? '', 0, 100)).content,
    [workspaceId],
    { skip: workspaceId === null, onLoaded: () => setCounted(true) },
  );
  const agents: Agent[] = agentCatalogue.items;

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
    setLastSpend(null);
    // Working belongs to the turn that produced it, and that turn is in the
    // chat being left. Carried across it would sit under somebody else's answer.
    setWorking(NOTHING_YET);
    thinkingSoFar.current = '';
    setTakeAt({});
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

  /*
   * The newest turn is the thing you are looking at, on arrival as well as after.
   *
   * This used to depend on `messages` alone, and opening a chat never scrolled:
   * the turns are fetched while the log is still behind its loading state, so
   * the effect ran with `logRef.current` null, and nothing changed afterwards to
   * run it again. A chat of six thousand pixels opened at the top of the first
   * thing anybody had said.
   *
   * So it also watches which chat is open, and asks for the frame after the one
   * it is on: a run of markdown is laid out by then, where at effect time the
   * box can still be shorter than what is in it. An image arriving later moves
   * the floor again, which is what the observer is for - it keeps the newest
   * turn in view until somebody scrolls away from it themselves.
   */
  useEffect(() => {
    const log = logBox;
    if (log === null) return;

    let following = true;
    const toBottom = () => {
      if (following) log.scrollTo({ top: log.scrollHeight });
    };

    const frame = requestAnimationFrame(toBottom);
    // Reading up is a decision; nothing below should undo it.
    const onScroll = () => {
      following = log.scrollHeight - log.clientHeight - log.scrollTop < 40;
    };
    log.addEventListener('scroll', onScroll, { passive: true });

    const grew = new ResizeObserver(toBottom);
    grew.observe(log);
    for (const child of Array.from(log.children)) grew.observe(child);

    return () => {
      cancelAnimationFrame(frame);
      log.removeEventListener('scroll', onScroll);
      grew.disconnect();
    };
  }, [messages, currentId, logBox]);

  /*
   * The box is as tall as what has been typed into it, up to the top of the
   * screen.
   *
   * It was one line and a `max-height` of 200px, which meant Shift+Enter put a
   * second line somewhere the writer could not see: the field kept its 20px and
   * scrolled, so a message being composed was read through a slot. A cap in
   * pixels is the same mistake written differently - it is a guess at how much
   * room there is, made in a stylesheet that cannot see the window.
   *
   * So the cap is measured instead. The column is header, conversation and
   * composer, and the conversation is the only part of it that yields: what the
   * box can still take is what the log is holding *inside its own padding*.
   * Padding does not shrink, so counting the log's whole height would let the
   * composer grow 64px further than there is room for, and a flex column with
   * nothing left to give overflows rather than resisting - the header goes off
   * the top of the window and the growth never stops. At the cap - the top of
   * the conversation area, which is what "up to the top" means - it scrolls
   * like any other overflowing box.
   *
   * The log is measured *before* the height is reset, because resetting it to
   * `auto` collapses the box to one line and hands the difference straight back
   * to the log: read after, the room would be counted twice and the box would
   * grow past the top on the first Shift+Enter.
   *
   * A layout effect rather than an effect: this runs between React writing the
   * DOM and the browser painting it, so a line is never drawn at the old height
   * first.
   */
  useLayoutEffect(() => {
    const box = composerRef.current;
    if (box === null) return;
    const log = logRef.current;
    const around = log === null ? null : window.getComputedStyle(log);
    const yields =
      log === null || around === null
        ? 0
        : Math.max(0, log.clientHeight - parseFloat(around.paddingTop) - parseFloat(around.paddingBottom));
    // Its own height counts: what the box already occupies is room it is
    // holding, not room it has to find. Which is also why this can never fall
    // below one line, whatever the log is doing.
    const room = box.clientHeight + yields;
    box.style.height = 'auto';
    const wanted = box.scrollHeight;
    const height = Math.min(wanted, room);
    box.style.height = `${height}px`;
    // Only when it has stopped growing, so the scrollbar is not drawn over a
    // box that had room for the line all along.
    box.style.overflowY = wanted > height ? 'auto' : 'hidden';
  }, [draft, attached, chatFiles, currentId]);

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
  /*
   * Which of the three things voice mode is doing, so the button can say so.
   *
   * Held here rather than read out of the panel, because the button lives in
   * the title bar and the panel is off to the side: a control that looks the
   * same whether it is listening, thinking or talking is a control that says
   * nothing.
   */
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('listening');
  const voiceControls = useRef<VoiceModeHandle>(null);
  /**
   * What was attached to a message typed while voice mode was open, and which
   * message it was.
   *
   * Handed over in a ref rather than through the panel, because the panel has
   * no business knowing what a file is: it sends a turn and reads the answer,
   * and what goes with that turn is the composer's own affair.
   *
   * The text is kept beside the ids because the turn that eventually carries
   * them may not be the one that was typed — a message held while the panel was
   * busy has whatever was said after it added to it. So the turn that contains
   * this text is the one these belong to, and a turn that does not is somebody
   * else's.
   */
  const voiceFiles = useRef<{ text: string; ids: string[] } | null>(null);
  /**
   * What this workspace has decided about how a turn ends, or nothing.
   *
   * Read here rather than in the panel because this is already the one place
   * that asks the server about the workspace — it is the same request that
   * decides whether voice mode is offered at all — and a panel that fetched
   * again would be asking twice for the same answer, once per time somebody
   * enters voice mode. Null in any of the three is the workspace having decided
   * nothing, and the panel is what knows what that then means.
   */
  const [turnTaking, setTurnTaking] = useState<VoiceTurnTaking | null>(null);
  /**
   * Where this workspace has said an answer may be cut for the speech model.
   *
   * Off the same request as the three above, and it applies to both readers on
   * this page: the speaker under an answer and the voice panel are one setting's
   * business, because they are the same answer being read to the same person.
   * The default until the workspace has answered - which is what it was before
   * this could be said, so nothing sounds different while the fetch is in the
   * air.
   */
  const [chunking, setChunking] = useState<SpeechChunking>(CHUNKING_DEFAULT);

  useEffect(() => {
    if (workspaceId === null) return;
    fetchWorkspace(workspaceId)
      .then((held) => {
        setHears(held?.transcriptionModelId != null);
        setReads(held?.speechModelId != null);
        setChunking(held?.voiceSpeechChunking ?? CHUNKING_DEFAULT);
        setTurnTaking(
          held === null
            ? null
            : {
                pauseEndsTurnMs: held.voicePauseEndsTurnMs,
                speechOverRoomPercent: held.voiceSpeechOverRoomPercent,
                unattendedMicrophoneMs: held.voiceUnattendedMicrophoneMs,
              },
        );
      })
      .catch(() => {
        setHears(false);
        setReads(false);
        // Nothing rather than a guess: null in all three is exactly "the
        // workspace has decided nothing", which is the panel's own numbers.
        setTurnTaking(null);
        setChunking(CHUNKING_DEFAULT);
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
    // An agent with no model chosen cannot answer, so it is offered switched
    // off rather than left out: somebody looking for it should find it and be
    // told why it will not do, not wonder where it went.
    const entries = agents.map((agent) => ({
      id: agent.id,
      label: agent.name,
      enabled: agent.enabled && agent.modelId !== null,
    }));
    return needle === '' ? entries : entries.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [agents, pickerSearch]);

  async function guard(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That did not work.'));
    }
  }

  async function handleNew() {
    // Saying why beats a button that looks like it did nothing.
    if (workspaceId === null) {
      setError(t('There is no workspace to chat in yet.'));
      return;
    }
    await guard(async () => {
      const created = await startChat(workspaceId, t('New chat'));
      await loadSessions(created.id);
    });
  }

  /**
   * Whether there is anything here to chat to.
   *
   * A workspace with no usable agent is a workspace where a chat cannot be
   * started, which is a state this page did not have before issue #295: a bare
   * model used to be there whatever else was, so a workspace with a model could
   * always hold a conversation. The server refuses it now, and the button is
   * stopped short of that refusal so nobody presses it to find out.
   *
   * True only where the list actually arrived and had nothing usable in it.
   * Every other way of holding no agents is a different thing: not asked for
   * yet, still being asked for, or asked for and refused. An empty list now
   * carries "add one" behind it, so reading a server that has gone away as an
   * empty workspace would send somebody off to build an agent they already have,
   * and would take the button away while they did.
   */
  const noAgents =
    counted &&
    agentCatalogue.failure === null &&
    !agents.some((one) => one.enabled && one.modelId !== null);

  /**
   * Closes the composer's microphone, wherever the closing came from.
   *
   * The one place it is given back — pressing stop, a recording that ended by
   * itself, or this page going away underneath it. The light on the machine
   * goes out when the tracks do, not when the recorder stops and not when the
   * last reference is dropped, so both happen here rather than in each caller.
   *
   * Safe to call twice, and safe to call when nothing is open.
   */
  const releaseMicrophone = useCallback(() => {
    const held = recorder.current;
    recorder.current = null;
    if (held !== null && held.state !== 'inactive') held.stop();
    microphone.current?.getTracks().forEach((track) => track.stop());
    microphone.current = null;
    setRecording(false);
    setListening(null);
  }, []);

  /*
   * Leaving the page closes the microphone.
   *
   * Stopping is a button somebody presses, and somebody who walks away
   * mid-sentence never presses it: without this the device stays open, with the
   * browser saying so, until the page is reloaded.
   */
  useEffect(() => {
    leaving.current = false;
    return () => {
      leaving.current = true;
      releaseMicrophone();
    };
  }, [releaseMicrophone]);

  /**
   * Starts recording, or stops and sends what was said to be transcribed.
   *
   * The transcript is put into the box rather than sent: speech is how the
   * message was typed, not a decision to send it, and anything misheard is
   * fixed before anybody else sees it.
   */
  async function handleMicrophone() {
    if (recording) {
      // The same closing as every other way out, so the transcript still
      // arrives — stopping the recorder is what produces it.
      releaseMicrophone();
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
        releaseMicrophone();
        // Stopped on the way out rather than by anybody pressing anything:
        // there is no box left to put a transcript in.
        if (leaving.current) return;

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
            setError(cause instanceof Error ? cause.message : t('That could not be transcribed.')),
          )
          .finally(() => setTranscribing(false));
      };

      recorder.current = held;
      microphone.current = stream;
      setRecording(true);
      setListening(stream);
      held.start();
    } catch {
      setError(t('The microphone could not be opened. The browser may have refused it.'));
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
      setError(cause instanceof Error ? cause.message : t('Those files could not be uploaded.'));
    } finally {
      setAttaching(false);
      // Cleared so the same file can be picked twice in a row.
      if (filesRef.current !== null) filesRef.current.value = '';
    }
  }

  /**
   * Stops whatever is being read, and lets go of it.
   *
   * Everything a reading is holding — the pieces not asked for yet, the request
   * in the air, the clip playing and the object URL under it — is the reading's
   * own, so stopping it is one call rather than a list somebody has to keep in
   * step.
   */
  function hush() {
    reading.current?.stop();
    reading.current = null;
    setSpeaking(null);
    setFetchingSpeech(null);
  }

  /**
   * Reads one answer aloud, or stops it if it is the one already talking.
   *
   * In pieces, and the first of them is asked for on its own: an answer of any
   * length used to be one request, so the wait before the first word was the
   * wait for the last one to be synthesised — seconds of a button that had
   * plainly been pressed and a page saying nothing. Where the pieces end is the
   * workspace's, and one of the three it can say is that old single request.
   *
   * What is read is what the answer renders to and not the markdown it is
   * written in, which is `readAloud`'s doing and every reader's alike.
   */
  function readAnswer(index: number, text: string) {
    if (workspaceId === null) return;

    // A second press on the one that is talking — or being fetched — is "stop".
    const stopping = speaking === index || fetchingSpeech === index;
    hush();
    if (stopping) return;

    setError(null);
    setFetchingSpeech(index);
    const say = readAloud(
      workspaceId,
      {
        // Speaking when there is sound, not when there is a request.
        onStart: () => {
          if (reading.current !== say) return;
          setFetchingSpeech(null);
          setSpeaking(index);
        },
        onEnd: () => {
          if (reading.current === say) hush();
        },
        onFailure: (reason) => {
          if (reading.current !== say) return;
          hush();
          setError(reason);
        },
      },
      chunking,
    );
    reading.current = say;
    say.push(text, true);
  }

  /**
   * One turn held in voice mode: what was said - or typed - goes to the model,
   * and the answer comes back as text for the panel to read aloud.
   *
   * The same stream as the composer's, so a conversation held by voice lands in
   * the transcript exactly as a typed one does — same chat, same history, and
   * the answer grows on screen while it is still being spoken.
   *
   * `sending` is set here for the same reason it is set on a typed send: it is
   * what draws *Waiting for Gemma…* under the turn. The panel had that state to
   * itself, off to the side, so a conversation held by voice showed the
   * question, then nothing at all, then a whole answer — and the one screen
   * saying the model was working was the one nobody was looking at.
   */
  async function handleVoiceTurn(
    text: string,
    onProgress: (soFar: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    if (currentId === null) return '';

    // What the composer had attached when this was typed, if it was typed and
    // if this is the turn that ended up carrying it.
    const held = voiceFiles.current;
    const carries = held !== null && text.includes(held.text);
    const going = carries ? held.ids : [];
    if (carries) voiceFiles.current = null;

    setMessages((present) => [
      ...present,
      { role: 'user', content: text, actor: null, takes: [], thinking: null, thinkingMillis: null },
      { role: 'assistant', content: '', actor: null, takes: [], thinking: null, thinkingMillis: null },
    ]);
    setError(null);
    setWorking(NOTHING_YET);
    thinkingSoFar.current = '';
    setSending(true);

    let answer = '';
    let failure: string | null = null;
    /*
     * The panel owns a spoken turn and therefore owns the stopping of it, so
     * the signal it hands down is the one that goes to the server rather than a
     * second one made here. What the composer's own Stop is for is the turn it
     * started itself; in voice mode the composer draws no Stop, because the
     * circle beside it is that control and two of them would be two ways to
     * cut in that disagreed about what a turn is.
     */
    try {
      await streamChatMessage(
        currentId,
        text,
        {
          onChunk: (piece) => {
            answer += piece;
            setMessages((present) => {
              const grown = [...present];
              const last = grown.length - 1;
              grown[last] = { ...grown[last], content: grown[last].content + piece };
              return grown;
            });
            // The panel reads whole sentences out of this while the rest is
            // still being written, so it is handed the answer so far rather
            // than the piece: what it needs to know is how much of it it has
            // already read.
            onProgress(answer);
          },
          ...watchWorking(),
          onDone: (spend) => keepThinkingOnAnswer(spend),
          onError: (reason) => {
            failure = reason;
          },
        },
        going,
        signal,
      );
      if (failure !== null) throw new Error(failure);
      if (going.length > 0) {
        await fetchChatAttachments(currentId)
          .then(setChatFiles)
          .catch(() => undefined);
      }
      await loadSessions(currentId);
    } finally {
      setSending(false);
    }
    return answer;
  }

  /**
   * The three handlers that follow a turn's working, written once.
   *
   * All three doors into the model — a typed send, a spoken one, and asking for
   * the answer again — want exactly this and want it identically. Three copies
   * would be three places for a call to stop being paired with its result, and
   * the symptom of that is a lookup that says it is running for ever.
   *
   * A call arrives before its tool has run and is drawn straight away with a
   * null result, which `CallLine` shows as running; the result lands on it by
   * `at`. Matched rather than appended blind, because a round may make several
   * calls and nothing promises the first one to answer is the first one made.
   */
  function watchWorking(): Pick<ChatStreamHandlers, 'onThinking' | 'onCall' | 'onCalled'> {
    return {
      onThinking: (piece) => {
        // Mirrored into a ref as well as into state, because `onDone` has to
        // read the whole of it to put it on the message and cannot see a state
        // update made in the same run of handlers.
        thinkingSoFar.current += piece;
        setWorking((held) => ({ ...held, thinking: held.thinking + piece }));
      },
      onCall: (call) =>
        setWorking((held) => ({ ...held, calls: [...held.calls, { ...call, result: null, failed: false }] })),
      onCalled: (answer) =>
        setWorking((held) => ({
          ...held,
          calls: held.calls.map((call) =>
            call.at === answer.at ? { ...call, result: answer.result, failed: answer.failed } : call,
          ),
        })),
    };
  }

  /**
   * The turn is over: what it cost goes on the screen, and what it thought goes
   * on the message.
   *
   * Written onto the message rather than left in `working` so that the answer
   * just given and an answer read back off the server are drawn from the same
   * field. Otherwise the block would sit there live and then vanish on the next
   * reload, which is the bug this whole change is about.
   */
  function keepThinkingOnAnswer(spend: ChatSpend) {
    setLastSpend(spend);
    const thought = thinkingSoFar.current;
    if (thought.trim() === '') return;
    setMessages((present) => {
      const grown = [...present];
      const last = grown.length - 1;
      if (last < 0) return present;
      grown[last] = {
        ...grown[last],
        thinking: thought,
        thinkingMillis: spend.thinkingMillis && spend.thinkingMillis > 0 ? spend.thinkingMillis : null,
      };
      return grown;
    });
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (currentId === null || draft.trim() === '') return;

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

    /*
     * In voice mode the panel owns the turn, whichever way the message was
     * written.
     *
     * Not a second sender beside it: the panel is listening, reading the answer
     * back and deciding when the next turn may start, and a send that went
     * round it would put two turns on one chat, leave the answer unread, and
     * have the microphone still waiting for a turn that had already been taken.
     * So this hands it over — including anything attached, which the turn
     * carries exactly as a typed send does — and what happens to it there is
     * the same as for anything said out loud: this turn if there is none in
     * flight, and the one waiting if there is.
     */
    if (voice && voiceControls.current !== null) {
      setDraft('');
      setAttached([]);
      setError(null);
      if (going.length > 0) voiceFiles.current = { text: said, ids: going.map((file) => file.id) };
      voiceControls.current.say(said);
      return;
    }

    if (sending) return;
    setSending(true);
    setDraft('');
    setAttached([]);
    // Shown straight away: the server has it, and waiting for the model to
    // finish before drawing what was typed reads as a dropped message.
    setMessages((present) => [...present, { role: 'user', content: said, actor: null, takes: [], thinking: null, thinkingMillis: null }]);
    setError(null);
    // The last answer's working, cleared as this one starts. It stayed on
    // screen after that answer landed on purpose; it belongs to that answer,
    // and one turn further up the log there is nowhere to draw it.
    setWorking(NOTHING_YET);
    thinkingSoFar.current = '';
    // The answer grows in place as it arrives, so the empty assistant turn is
    // appended first and each piece lands on the end of it.
    setMessages((present) => [...present, { role: 'assistant', content: '', actor: null, takes: [], thinking: null, thinkingMillis: null }]);
    const asked = new AbortController();
    asking.current = asked;
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
          ...watchWorking(),
          onDone: (spend) => keepThinkingOnAnswer(spend),
          onError: (reason) => {
            failure = reason;
          },
        },
        going.map((file) => file.id),
        asked.signal,
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
      // Stopped on purpose is not a failure and is not reported as one. What is
      // still read back is the history, because the server keeps nothing of an
      // answer it was told to abandon - so the half sentence on screen is not
      // what this chat says, and leaving it there would be the screen inventing
      // a turn.
      if (!givenUp(cause)) setError(cause instanceof Error ? cause.message : t('The model did not answer.'));
      // What the server kept is the truth about what was said.
      fetchChatMessages(currentId).then(setMessages).catch(() => undefined);
    } finally {
      if (asking.current === asked) asking.current = null;
      setSending(false);
    }
  }

  /**
   * Asks for the last answer again.
   *
   * The one it replaces is not lost: it is put where every earlier take of an
   * answer goes — into the row's own history, one press from being read again —
   * and it is put there here, before anything is asked, so the log never stops
   * holding it even while the new one is being written.
   *
   * Whatever the picker says answers this chat is what answers, which is the
   * model or agent that gave the answer in the first place unless somebody has
   * moved it since. That is why there is no second control for "again, but on
   * something else": the control for that is the one naming who is answering.
   */
  async function handleRegenerate() {
    if (currentId === null || sending) return;
    const at = messages.length - 1;
    if (messages[at]?.role !== 'assistant') return;

    setSending(true);
    setError(null);
    setLastSpend(null);
    // A second answer does its own thinking and its own lookups, and the first
    // one's would read as this one's.
    setWorking(NOTHING_YET);
    thinkingSoFar.current = '';
    setMessages((present) => {
      const grown = [...present];
      const last = grown.length - 1;
      grown[last] = { ...grown[last], content: '', takes: [...grown[last].takes, grown[last].content] };
      return grown;
    });
    // Back to the newest, because the newest is the one being written now.
    setTakeAt((held) => {
      const { [at]: _dropped, ...rest } = held;
      return rest;
    });

    const asked = new AbortController();
    asking.current = asked;
    try {
      let failure: string | null = null;
      await regenerateChatAnswer(currentId, {
        onChunk: (piece) =>
          setMessages((present) => {
            const grown = [...present];
            const last = grown.length - 1;
            grown[last] = { ...grown[last], content: grown[last].content + piece };
            return grown;
          }),
        ...watchWorking(),
        onDone: (spend) => keepThinkingOnAnswer(spend),
        onError: (reason) => {
          failure = reason;
        },
      }, asked.signal);
      if (failure !== null) throw new Error(failure);
      await loadSessions(currentId);
    } catch (cause) {
      if (!givenUp(cause)) setError(cause instanceof Error ? cause.message : t('The model did not answer.'));
      // The server puts the answer back when it could not give another, so what
      // it holds is the truth about what this chat says.
      fetchChatMessages(currentId).then(setMessages).catch(() => undefined);
    } finally {
      if (asking.current === asked) asking.current = null;
      setSending(false);
    }
  }

  /**
   * Stops the turn in flight, from the composer.
   *
   * The same interruption the circle in voice mode makes, and it has to be the
   * same one: the two would otherwise disagree about what stopping means, with
   * one of them ending the model call and the other only looking away. What it
   * reaches is the request, so the server sees the connection close and hangs
   * up on the provider — see `ReaderWatch`. Issue #299.
   *
   * The answer written so far is not kept. The server does not write an
   * abandoned answer to the history, and the log is re-read as this unwinds, so
   * what stays on screen is what the chat actually holds.
   */
  function handleStop() {
    asking.current?.abort();
    asking.current = null;
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, shift+enter is a new line: what a chat box is expected to do.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend(event as unknown as FormEvent);
    }
  }

  async function handleRename(entry: ChatSession) {
    const title = window.prompt(t('Rename chat'), entry.title);
    if (title === null || title.trim() === '') return;
    await guard(async () => {
      await renameChat(entry.id, title.trim());
      await loadSessions();
    });
    setMenuFor(null);
  }

  /*
   * Deleting a chat takes every message in it and there is no way back, so it
   * asks. It did not: the button deleted, from the header and from the row menu
   * both, on one press and with nothing said.
   */
  function handleDelete(entry: ChatSession) {
    setMenuFor(null);
    setDeleting(entry);
  }

  async function confirmDelete() {
    const entry = deleting;
    if (entry === null) return;
    await guard(async () => {
      await deleteChat(entry.id);
      setCurrentId((present) => (present === entry.id ? null : present));
      await loadSessions();
    });
    setDeleting(null);
  }

  async function handlePin(entry: ChatSession) {
    await guard(async () => {
      await setChatPinned(entry.id, !entry.pinned);
      await loadSessions();
    });
    setMenuFor(null);
  }

  /**
   * What the picker offers is who answers next, and an agent answers by
   * supplying its own model, so choosing one settles both.
   *
   * One call where there used to be two. `chooseChatModel` was the other, and
   * it took the agent off and left the model — a chat on a bare model made in
   * one press, which is the thing issue #295 removed.
   */
  async function handleChoose(id: string) {
    if (currentId === null) return;
    await guard(async () => {
      await chooseChatAgent(currentId, id);
      await loadSessions(currentId);
    });
    setPickerOpen(false);
    setPickerSearch('');
  }

  /**
   * Which take of an answer is being read: 0 for the first it ever gave,
   * `takes.length` for the one that stands.
   *
   * The one that stands is the default, and the only one an answer with no
   * earlier takes has.
   */
  const takeShowing = (index: number, message: ChatMessage): number =>
    Math.min(takeAt[index] ?? message.takes.length, message.takes.length);

  /** And what that take actually said. */
  const shownTake = (index: number, message: ChatMessage): string => {
    const at = takeShowing(index, message);
    return at === message.takes.length ? message.content : message.takes[at];
  };

  const stepTake = (index: number, message: ChatMessage, by: number) => {
    const next = Math.max(0, Math.min(message.takes.length, takeShowing(index, message) + by));
    setTakeAt((held) => ({ ...held, [index]: next }));
  };

  function copy(text: string, index: number) {
    void navigator.clipboard?.writeText(text);
    setCopied(index);
    window.setTimeout(() => setCopied((present) => (present === index ? null : present)), 1200);
  }

  /*
   * What the send button says while a turn is in flight.
   *
   * It said "Sending…" from the press until the answer was complete, which is
   * only true for the first few hundred bytes of it: the message is written to
   * the history before the stream opens, and everything after that is the model
   * thinking. Minutes of "Sending…" reads as a message that never left, and the
   * screen was already contradicting itself - the log says "Waiting for Gemma
   * 31B…" while the button says the message is still going out.
   *
   * So it is derived from exactly what that row is derived from, and the two
   * cannot disagree: an assistant turn that is still empty is the wait, and the
   * first token that lands in it is the model answering.
   */
  const answering = sending && (messages[messages.length - 1]?.content ?? '') !== '';
  /*
   * In voice mode it stays *Send* and stays live, because there it does
   * something different: the panel is the sender, and pressing this while a
   * turn is in flight puts what was typed in the queue rather than nowhere.
   * A button labelled with the turn's progress and refusing the press would be
   * the same message lost that voice mode was just taught to keep.
   */
  const sendLabel =
    voice || !sending ? 'Send' : answering ? t('Answering…') : t('Waiting…');

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
        disabled={noAgents}
        aria-label={t('New chat')}
        title={noAgents ? t('This workspace has no agent to chat with yet.') : t('New chat')}
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
        aria-label={t('Search chats')}
        title={t('Search chats')}
      >
        <img src={searchIcon} alt="" width={14} height={14} />
      </button>
    </div>
  ) : (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarTitle}>{t('User Chats')}</span>
        <button
          type="button"
          className={styles.newButton}
          onClick={() => void handleNew()}
          disabled={noAgents}
          title={noAgents ? t('This workspace has no agent to chat with yet.') : undefined}
        >{t('+ New')}</button>
      </div>

      <div className={styles.searchBox}>
        <img src={searchIcon} alt="" width={11} height={11} />
        <input
          ref={searchRef}
          className={styles.searchInput}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Search chats...')}
          aria-label={t('Search chats')}
        />
      </div>

      <label className={styles.searchScope}>
        <input
          type="checkbox"
          checked={searchInMessages}
          onChange={(event) => setSearchInMessages(event.target.checked)}
        />
        {t('Search content')}
      </label>

      {sessions === null && <p className={styles.sidebarNotice}><Loader /></p>}
      {sessions?.length === 0 && <p className={styles.sidebarNotice}>{t('No chats yet.')}</p>}

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
            {t('Pinned')}
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
                  onDelete={() => handleDelete(entry)}
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
            {t('Recent')}
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
                  onDelete={() => handleDelete(entry)}
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
          <p className={styles.emptyTitle}>{t('Chat is turned off')}</p>
          <p className={styles.emptyNote}>
            {t('An administrator has switched chat off for this installation. The conversations already had are kept, and come back if it is switched on again.')}
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

  /*
   * What to print beside the time, or null for nothing to print.
   *
   * Money where the model has prices and tokens where it has none - a bill is
   * one number, and a model nobody has priced can still say how much was read
   * and written. Null where the switch is off, where the provider reported no
   * counts, and for every answer that came back out of the history: three
   * different reasons to know nothing, and one honest way of showing it.
   */
  const spend =
    session.chatCostShown === true && lastSpend !== null && spendKnown(lastSpend)
      ? lastSpend.cost === null
        ? `${tokenCount(lastSpend.inputTokens + lastSpend.outputTokens)} tokens`
        : costAmount(lastSpend.cost)
      : null;

  /*
   * What this chat has spent altogether, under the corner of the composer.
   *
   * The whole conversation and not the last answer, which is the difference
   * that makes it worth drawing. It used to be `lastSpend`, which came off the
   * stream's last frame and was held here in the browser - so a chat said what
   * its newest answer cost and, the moment the page reloaded, nothing at all.
   * This comes off the chat row, is added to as each turn lands, and is still
   * there a week later.
   *
   * Nothing is added up here. The server keeps the total and the sidebar is
   * re-read at the end of every turn, so the number on screen is the number in
   * the database rather than a second tally kept beside it - which is the tally
   * that would start again from nought on a reload, in a second tab, or on
   * another machine.
   *
   * Silent on nought, and nought covers every case where the truth is "not
   * recorded": a chat nobody has spoken in, a provider that reported no counts,
   * and a chat older than the column. Same rule as the per-answer line, and for
   * the same reason - a conversation that says it cost nothing is worse than
   * one that says nothing.
   */
  const spentTokens = (current?.spentInputTokens ?? 0) + (current?.spentOutputTokens ?? 0);
  const spentPictures = current?.spentPictures ?? 0;
  /*
   * Pictures are said beside the tokens, never folded into them.
   *
   * An image model charges per picture and reports no counts at all. Counted
   * the ordinary way a drawing adds nought, which would leave a chat that spent
   * real money on pictures reading as a chat that spent nothing.
   */
  const spentPart = spentTokens > 0 ? `${tokenCount(spentTokens)} ${t('tokens')}` : null;
  const drawnPart =
    spentPictures === 0
      ? null
      : spentPictures === 1
        ? t('1 picture')
        : tf('{count} pictures', { count: tokenCount(spentPictures) });
  const spent =
    session.chatCostShown !== true
      ? null
      : spentPart !== null && drawnPart !== null
        ? tf('{tokens} and {pictures}', { tokens: spentPart, pictures: drawnPart })
        : (spentPart ?? drawnPart);

  return (
    <AppShell
      user={shellUser(session)}
      section="chat"
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={sidebar}
      fills
    >
      {current === null ? (
        <div className={styles.empty}>
          {errorBanner}
          <p className={styles.emptyTitle}>{noAgents ? t('No agent to chat with') : t('No chat open')}</p>
          {/*
            The way out stays in the open; what a chat *is* goes behind the (?).

            Two ways out, because there are now two reasons to be here. A
            workspace with no usable agent is a workspace where "+ New" does
            nothing, and that is a state issue #295 created — a bare model used
            to be there whatever else was. Telling somebody to press a button
            that is switched off is worse than telling them nothing, so the
            sentence names what is missing and links to where it is made.
          */}
          {noAgents ? (
            <p className={styles.emptyNote}>
              <span className={styles.labelWithHint}>
                <Link to={`/workspace/${workspaceId}/agents`}>{t('Add an agent')}</Link>
                <FieldHint label={t('No agent to chat with')}>
                  {t('A chat is held with an agent: it brings the model that answers, the instructions it works under, the skills and tools it has been granted, and what it is allowed to remember. There is nothing else to hold one with.')}
                </FieldHint>
              </span>
            </p>
          ) : (
            <p className={styles.emptyNote}>
              <span className={styles.labelWithHint}>
                Start one with <strong>{t('+ New')}</strong>.
                <FieldHint label={t('No chat open')}>
                  {t('Each chat is a conversation of its own, kept the same way a workflow run keeps the thread its agents share.')}
                </FieldHint>
              </span>
            </p>
          )}
        </div>
      ) : (
        <div className={styles.chatRow}>
        <div className={styles.chat}>
          {/*
            One row, not two.

            The title had a row and the model picker had another below it, and
            the second held a single word - so two thirds of a bar of chrome
            said what belongs beside the chat's name. Who answers next is now
            read in the same glance as what the chat is called, immediately
            left of the controls that act on it.
          */}
          <header className={styles.titleBar}>
            <h1 className={styles.chatTitle}>{current.title}</h1>
            <div className={styles.titleRight}>
            <div className={styles.modelBar} ref={pickerRef}>
              <button
                type="button"
                className={styles.modelButton}
                onClick={() => setPickerOpen(!pickerOpen)}
                aria-expanded={pickerOpen}
              >
                <span className={current.modelName === null ? styles.modelUnset : styles.modelName}>
                  {current.agentName ?? current.modelName ?? t('Choose a model')}
                </span>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </button>

              {/*
                One list, and it is agents.

                It used to be two tabs, Agents then Models, with agents first
                (issue #249) on the argument that what somebody chats to is
                nearly always an agent: it brings its instructions, its skills
                and its tools with it, and it supplies a model anyway, so
                offering the bare models put the raw material ahead of the thing
                made out of it.

                Issue #295 finished that argument by taking the second half
                away. A bare model is that same agent with the instructions, the
                skills, the grants and the memory taken off, and a tab beside
                them said it was the other half of a choice. A chat that is
                already on one keeps working, and the button above still shows
                its model's name — read off the chat as `modelName`, not out of
                a list — so what this offers is the agents it could be handed to.
              */}
              {pickerOpen && (
                <div className={styles.picker}>
                  <div className={styles.pickerSearch}>
                    <img src={searchIcon} alt="" width={14} height={14} />
                    <input
                      className={styles.searchInput}
                      value={pickerSearch}
                      onChange={(event) => setPickerSearch(event.target.value)}
                      placeholder={t('Search')}
                      aria-label={t('Search models')}
                      autoFocus
                    />
                  </div>
                  <div className={styles.pickerList}>
                    {/*
                      Three things the list can have nothing in it for, and they
                      are not the same thing: the workspace has none, the fetch
                      failed, or what was typed above matches none of them.
                    */}
                    <CatalogueNote
                      catalogue={agentCatalogue}
                      className={styles.pickerEmpty}
                      empty={t('No agents in this workspace yet.')}
                    />
                    {pickerEntries.length === 0 && agents.length > 0 && (
                      <p className={styles.pickerEmpty}>{t('Nothing by that name.')}</p>
                    )}
                    {pickerEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={
                          entry.id === current.agentId ? styles.pickerEntryCurrent : styles.pickerEntry
                        }
                        // An agent switched off, or with no model chosen, cannot
                        // answer; the server says so too, but there is no reason
                        // to offer it as a choice.
                        disabled={!entry.enabled}
                        title={entry.enabled ? undefined : t('Not active')}
                        onClick={() => void handleChoose(entry.id)}
                      >
                        {entry.label}
                        {!entry.enabled && <span className={styles.pickerNote}>{t('inactive')}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/*
                The way out to whatever is answering.

                The name in the picker is the only place this chat says which
                agent or model it is talking to, and it was a dead word: finding
                the agent whose prompt produced an answer meant leaving the chat,
                opening the workspace's agent list and reading down it for a name
                you were holding in your head. It is one press now, in a tab of
                its own - the same arrow-leaving-a-box every other field that
                names a definition uses, so it is read without being explained.

                An agent when there is one, the model when there is not: that is
                the same precedence the button beside it draws the name with, and
                a link that went somewhere other than the name it sits next to
                would be a worse answer than none.
              */}
              {workspaceId !== null && (current.agentId !== null || current.modelId !== null) && (
                <Link
                  className={styles.definitionJump}
                  to={
                    current.agentId !== null
                      ? `/workspace/${workspaceId}/agents/${current.agentId}/settings`
                      : `/workspace/${workspaceId}/models/${current.modelId}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  title={`Opens ${current.agentName ?? current.modelName} in a new tab`}
                  aria-label={
                    current.agentId !== null
                      ? `Open the agent ${current.agentName}`
                      : `Open the model ${current.modelName}`
                  }
                >
                  <OpenDefinitionIcon />
                </Link>
              )}
            </div>
            <div className={styles.titleActions}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  /*
                   * Opens a strip under the title, and the strip searches this
                   * conversation.
                   *
                   * It focused a hidden read-only input to begin with, so it
                   * did nothing at all. Then it focused the sidebar's box,
                   * which was wrong in a subtler way: that box asks "which chat
                   * was that in" and filters a list of titles, and this control
                   * sits above the conversation rather than above the list.
                   * What is wanted here is where in this one it was said.
                   */
                  if (finding) {
                    closeFind();
                    return;
                  }
                  setFinding(true);
                  window.setTimeout(() => findRef.current?.focus(), 0);
                }}
                title={t('Find in this chat')}
                aria-label={t('Find in this chat')}
                aria-expanded={finding}
              >
                <img src={searchIcon} alt="" width={14} height={14} />
              </button>
              {/*
                A chat opened from a session, said as a mark rather than a
                sentence across the page.

                It used to be a strip above the log reading "Continuing an LLM
                session — what is said here is written into it", with a link on
                the end. A line of prose the full width of the conversation, on
                every send, to say something that is true of the whole chat and
                changes never. The words are not lost: they are what the title
                and the label say, which is where the product puts an
                explanation of a control.

                `OpenDefinitionIcon` because that is already the mark for
                "opens the thing this names, elsewhere" - the five ways out of
                the node panel were converted to it, and a second mark invented
                here would be a second thing to learn for the same idea.
              */}
              {current.llmSessionId !== null && (
                <Link
                  className={styles.iconButton}
                  to={`/workspace/${current.workspaceId}/sessions/${current.llmSessionId}`}
                  target="_blank"
                  rel="noreferrer"
                  title={t('Continuing an LLM session — what is said here is written into it')}
                  aria-label={t('Open the transcript')}
                >
                  <OpenDefinitionIcon />
                </Link>
              )}
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => void handleRename(current)}
                title={t('Rename this chat')}
                aria-label={t('Rename this chat')}
              >
                <img src={penIcon} alt="" width={14} height={14} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => handleDelete(current)}
                title={t('Delete this chat')}
                aria-label={t('Delete this chat')}
              >
                <img src={trashIcon} alt="" width={14} height={14} />
              </button>
            </div>
            </div>
          </header>

          {/*
            Under the title rather than inside it: the title row was two rows
            until an hour ago and putting a field back into it would undo that,
            and a strip that appears and goes is easier to read as a mode you
            are in than a field that was always there.
          */}
          {finding && (
            <div className={styles.findBar}>
              <img src={searchIcon} alt="" width={14} height={14} />
              <input
                ref={findRef}
                className={styles.findInput}
                value={find}
                onChange={(event) => setFind(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeFind();
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    stepFind(event.shiftKey ? -1 : 1);
                  }
                }}
                placeholder={t('Find in this chat')}
                aria-label={t('Find in this chat')}
              />
              <span className={styles.findCount} role="status">
                {find.trim() === ''
                  ? ''
                  : findHits.length === 0
                    ? 'Nothing'
                    : `${findAt + 1} of ${findHits.length}`}
              </span>
              <span className={styles.findSteps}>
                <button
                  type="button"
                  className={styles.findStep}
                  onClick={() => stepFind(-1)}
                  disabled={findHits.length === 0}
                  aria-label={t('Previous match')}
                  title={t('Previous match')}
                >
                  <img src={chevronDown12Icon} alt="" width={12} height={12} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button
                  type="button"
                  className={styles.findStep}
                  onClick={() => stepFind(1)}
                  disabled={findHits.length === 0}
                  aria-label={t('Next match')}
                  title={t('Next match')}
                >
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </button>
              </span>
              <button type="button" className={styles.findStep} onClick={closeFind} aria-label={t('Close find')} title={t('Close find')}>
                <img src={xIcon} alt="" width={12} height={12} />
              </button>
            </div>
          )}

          <div
            className={styles.log}
            ref={(box) => {
              logRef.current = box;
              setLogBox(box);
            }}
          >
            {messages.length === 0 && (
              <p className={styles.logEmpty}>Nothing said yet. What is typed below starts the conversation.</p>
            )}

            {messages.map((message, index) => (
              <Fragment key={index}>
              {/*
                A call is not a turn and is not drawn as one: it was made
                between two of them, by the agent, and the page it was carried
                out of already says so this way.

                `CallLine` is the drawing, and it is also what a task's page
                uses. No `result` passed, and that is the chat's own shape rather
                than an omission: what it carries from the session it continues
                is the calls that were made, and the data they returned belongs
                in front of the model rather than in the thread.
              */}
              {message.role === CALL_ROLE ? (
                <div className={styles.call}>
                  {/*
                    Folded, the same as one arriving live.
                    
                    These come back from the session the chat continues, and a
                    call read out of history is no more the conversation than one
                    watched being made - so it is one line here too, and opens on
                    a press. The live site below passes the same thing; a call
                    that folded while it happened and sprawled after a reload
                    would be two different pages.
                  */}
                  <CallLine actor={message.actor} content={message.content} folded />
                </div>
              ) : message.role === 'user' ? (
                <div className={styles.userRow} data-find={findMark(index)}>
                  <div className={styles.userBody}>
                    {/*
                      A carried turn says who put it. It may not have been a
                      person at all - a node's prompt is recorded the same way -
                      and unnamed it reads as something the reader typed.
                    */}
                    {message.actor !== null && <span className={styles.saidBy}>{message.actor}</span>}
                    <div className={styles.userBubble}>{message.content}</div>
                    {/*
                      Under the bubble, inside the body, so it lines up with the
                      bubble's own edge rather than the column's. Outside the
                      body it was drawn in the gutter to the left of a
                      right-aligned message, which is the one place it could sit
                      and not look like it belonged to anything.
                    */}
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowAction}
                        onClick={() => copy(message.content, index)}
                        title={t('Copy')}
                        aria-label={t('Copy this message')}
                      >
                        <img src={copyIcon} alt="" width={14} height={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.assistantRow} data-find={findMark(index)}>
                  <span className={styles.assistantAvatar} aria-hidden="true">
                    <img src={cpuIcon} alt="" width={16} height={16} />
                  </span>
                  <div className={styles.assistantBody}>
                    {/*
                      Whoever actually said it. A turn carried in from the
                      session was said by an agent, and signing it with the
                      model this chat happens to be talking to is the most
                      misleading line on a page somebody opened to work out what
                      that agent did.
                    */}
                    <span className={styles.assistantName}>
                      {message.actor ?? current.agentName ?? current.modelName ?? 'assistant'}
                    </span>
                    {/* Only the answer just given has a time behind it. */}
                    {lastSpend !== null && index === messages.length - 1 && (
                      <button
                        type="button"
                        className={styles.thought}
                        onClick={() => setThoughtOpen(!thoughtOpen)}
                        aria-expanded={thoughtOpen}
                      >
                        Thought for {thinkingTime(lastSpend.millis)}
                        <img
                          className={thoughtOpen ? styles.thoughtChevronOpen : styles.thoughtChevron}
                          src={chevronDown12Icon}
                          alt=""
                          width={10}
                          height={10}
                        />
                      </button>
                    )}
                    {thoughtOpen && lastSpend !== null && index === messages.length - 1 && (
                      <p className={styles.thoughtDetail}>
                        {spend === null ? (
                          <>
                            The provider took {lastSpend.millis} ms to answer. Nothing else is
                            recorded: the history keeps what was said, not how it was arrived at.
                          </>
                        ) : (
                          <>
                            The provider took {lastSpend.millis} ms to answer, and charged for{' '}
                            {tokenCount(lastSpend.inputTokens)} tokens in and{' '}
                            {tokenCount(lastSpend.outputTokens)} out - every round of this turn, so
                            a lookup an agent made on the way is counted here too.{' '}
                            {lastSpend.cost === null
                              ? t('This model carries no prices, so there is nothing to cost that at.')
                              : `At the prices recorded for it that is ${costAmount(lastSpend.cost)}.`}{' '}
                            {/*
                              This used to say none of it was kept, which was
                              true of every one of these numbers until the chat
                              began keeping a total. The breakdown still is not
                              kept - it belongs to a turn, and a turn is over -
                              and the line under the box below is.
                            */}
                            Only the chat's total is kept, on the line below.
                          </>
                        )}
                      </p>
                    )}
                    {/*
                      What this answer thought and what it looked up, above the
                      answer and outside it.

                      Outside is the whole point. The copy control below copies
                      `shownTake`, the speech model is handed `shownTake`, and
                      the next turn sends the thread — none of which holds any
                      of this, so none of them has to remember to leave it out.
                      A reasoning model's thinking read aloud is the bug this
                      replaces, not a risk it introduces.

                      On the answer being written and the one just written, and
                      nowhere else: nothing is recorded, so an answer further up
                      the log has none and would draw an empty container
                      claiming otherwise. The calls are the exception and they
                      come back on their own, off the session, as `tool` lines
                      in the log above.
                    */}
                    {(() => {
                      /*
                        The thinking on this message, live or kept.

                        Live for the answer being written now - the pieces
                        arrive frame by frame and are drawn as they land, which
                        is most of the point of showing thinking at all. Kept
                        for every other message, read back off the server, so an
                        answer three turns up still carries the reasoning that
                        produced it. Reloading the page loses nothing, which is
                        what it used to do.
                      */
                      const live = index === messages.length - 1 && sending;
                      const thinking = live ? working.thinking : (message.thinking ?? '');
                      const calls = index === messages.length - 1 ? working.calls : [];
                      if (thinking.trim() === '' && calls.length === 0) return null;
                      return (
                        <div className={styles.working}>
                          <Thinking
                            text={thinking}
                            live={live}
                            millis={live ? null : message.thinkingMillis}
                          />
                          {calls.map((call) => (
                            <CallLine
                              key={call.at}
                              actor={call.tool}
                              content={call.arguments}
                              result={call.result}
                              failed={call.failed}
                              /*
                                One line until asked, which is the chat's
                                answer and not the component's. A lookup in the
                                middle of a conversation is an aside; a task's
                                page, where watching the calls is the feature,
                                passes nothing and gets them open.
                              */
                              folded
                            />
                          ))}
                        </div>
                      );
                    })()}
                    {/* Models write markdown; showing the source shows the asterisks. */}
                    <Markdown>{shownTake(index, message)}</Markdown>
                    {/*
                      Which take of this answer is being read, and the way back
                      to the others.

                      Outside the row of actions below on purpose: those appear
                      under the pointer, which is right for a copy button and
                      wrong for this. That an answer was given twice is a fact
                      about the conversation, and one nobody would find by
                      hovering over a paragraph they had no reason to suspect.
                    */}
                    {message.takes.length > 0 && (
                      <span className={styles.takes}>
                        <button
                          type="button"
                          className={styles.rowAction}
                          onClick={() => stepTake(index, message, -1)}
                          disabled={takeShowing(index, message) === 0}
                          title={t('The answer before this one')}
                          aria-label={t('The answer before this one')}
                        >
                          <img
                            src={chevronDown12Icon}
                            alt=""
                            width={12}
                            height={12}
                            style={{ transform: 'rotate(90deg)' }}
                          />
                        </button>
                        {/*
                          No `role="status"`: this is drawn for as long as the
                          answer has more than one take, and the loading mark
                          the checks wait on is exactly that role. A label that
                          never goes away would read as a page that never
                          finishes loading.
                        */}
                        <span className={styles.takeCount}>
                          {takeShowing(index, message) + 1} of {message.takes.length + 1}
                        </span>
                        <button
                          type="button"
                          className={styles.rowAction}
                          onClick={() => stepTake(index, message, 1)}
                          disabled={takeShowing(index, message) === message.takes.length}
                          title={t('The answer after this one')}
                          aria-label={t('The answer after this one')}
                        >
                          <img
                            src={chevronDown12Icon}
                            alt=""
                            width={12}
                            height={12}
                            style={{ transform: 'rotate(-90deg)' }}
                          />
                        </button>
                      </span>
                    )}
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowAction}
                        onClick={() => copy(shownTake(index, message), index)}
                        title={t('Copy')}
                        aria-label={t('Copy this answer')}
                      >
                        <img src={copyIcon} alt="" width={14} height={14} />
                      </button>
                      {/*
                        Asking for it again, on the answer the chat ends on.

                        Only there: anything earlier has been answered on top
                        of, and a different answer under a question three turns
                        back would rewrite what those turns were replying to.
                        Not on a turn carried in from a session either — those
                        are somebody else's words, copied in, and this chat has
                        no business answering them again.
                      */}
                      {index === messages.length - 1 &&
                        message.actor === null &&
                        !sending &&
                        message.content.trim() !== '' && (
                          <button
                            type="button"
                            className={styles.rowAction}
                            onClick={() => void handleRegenerate()}
                            title={t('Answer again — this one is kept')}
                            aria-label={t('Answer again')}
                          >
                            <img src={refreshCwIcon} alt="" width={14} height={14} />
                          </button>
                        )}
                      {/*
                        Only where a speech model is set. A speaker that always
                        appeared and always failed would be worse than none.
                      */}
                      {reads && shownTake(index, message).trim() !== '' && (
                        <button
                          type="button"
                          className={
                            speaking === index ? `${styles.rowAction} ${styles.rowActionOn}` : styles.rowAction
                          }
                          onClick={() => readAnswer(index, shownTake(index, message))}
                          aria-pressed={speaking === index}
                          title={
                            fetchingSpeech === index
                              ? t('Reading it…')
                              : speaking === index
                                ? 'Stop'
                                : t('Read this answer aloud')
                          }
                          aria-label={speaking === index ? t('Stop reading') : t('Read this answer aloud')}
                        >
                          <img src={volume2Icon} alt="" width={14} height={14} />
                        </button>
                      )}
                      {fetchingSpeech === index && <span className={styles.copied}>Reading…</span>}
                      {copied === index && <span className={styles.copied}>Copied</span>}
                    </div>
                  </div>
                </div>
              )}
              {/*
                Where the session's record stops and this conversation starts.

                The names above it already say the turns came from somewhere
                else, but a reader working out what went wrong is asking a
                different question - which of this was already there, and which
                of it is theirs - and one line answers it at a glance.
              */}

              </Fragment>
            ))}

            {/*
              Only until the model actually starts. The answer streams into an
              assistant turn that begins empty, so an empty last message is the
              wait itself — once a token lands there is something to read, and
              saying "Waiting" over the top of it is just wrong. The same is now
              true of an agent, which produces no token until the very end but
              does produce lookups on the way: once one of those is drawn, the
              wait has visibly stopped being a wait.
            */}
            {sending && messages[messages.length - 1]?.content === '' && !anyWorking(working) && (
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

          {spent !== null && (
            <p className={styles.spent} title={t('What this chat has read and written, all of it')}>
              {spent}
            </p>
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
                      title={t('Remove')}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/*
              The whole box is the text field, as far as a pointer is
              concerned.
              
              It looks like one control and is several: a 20px textarea beside
              taller buttons, inside 16px of padding. Everything that is not the
              one line of text - the padding, and the gap left beside the
              buttons - was dead, so clicking what plainly reads as the input
              did nothing.
              
              `mousedown` rather than `click`, and only when the press landed on
              the box itself: a press on a child is that child's, and focus has
              to be taken before the default action moves it somewhere else.
            */}
            <div
              className={styles.composerBox}
              onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                document.getElementById('chat-composer')?.focus();
              }}
            >
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
                    aria-label={t('Add to this message')}
                    title={attaching ? t('Uploading…') : t('Add to this message')}
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
                        {t('Upload files')}
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
                ref={composerRef}
                className={styles.composerInput}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKey}
                placeholder={t('Type a message...')}
                rows={1}
                aria-label={t('Message')}
              />
              {/*
                Speech goes into the box, not out to the model: what was heard
                is a draft like any other, and a mishearing is fixed before
                anybody else reads it.
              */}
              {/*
                There was a picture button here, and asking for a picture is now
                something said in the conversation. #294 gave a chat agent
                `chat_draw_picture`, so "draw me the architecture we just
                discussed" is a sentence rather than a mode the composer is
                switched into and the description retyped in. The workspace's
                image model still decides whether it can be done at all; it now
                decides whether the *agent* is offered the tool.
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
                  aria-label={recording ? t('Stop recording') : t('Record a message')}
                  title={
                    transcribing
                      ? t('Transcribing…')
                      : recording
                        ? t('Stop and transcribe')
                        : t('Record a message')
                  }
                >
                  <img src={micIcon} alt="" width={16} height={16} />
                </button>
              )}
              {hears && reads && (
                <>
                  {/*
                    Voice mode, next to the microphone it is easily confused
                    with: the microphone dictates into the box, this one hands
                    the conversation over to speech entirely. The waveform in a
                    filled circle is how that control is drawn everywhere else,
                    and it used to be a loudspeaker off in the title bar, which
                    said "read this aloud" from a place nobody looked.

                    One control, three states, and it does something different
                    in each: entering when it is off, cutting the answer short
                    while it is talking, and ending a turn early while it is
                    listening. Leaving is the X beside it - having the same
                    button both interrupt and leave meant one of those happening
                    when the other was meant.
                  */}
                  <button
                    type="button"
                    className={
                      voice
                        ? `${styles.voiceButton} ${styles.voiceButtonOn} ${styles[`voice${voicePhase}`]}`
                        : styles.voiceButton
                    }
                    onClick={() => (voice ? voiceControls.current?.interrupt() : setVoice(true))}
                    aria-pressed={voice}
                    title={
                      !voice
                        ? t('Talk instead of typing')
                        : voicePhase === 'speaking'
                          ? t('Speaking - press to cut in')
                          : voicePhase === 'thinking'
                            ? 'Thinking'
                            : t('Listening - press when you have finished')
                    }
                    aria-label={
                      !voice
                        ? t('Enter voice mode')
                        : voicePhase === 'speaking'
                          ? t('Stop speaking and listen')
                          : voicePhase === 'thinking'
                            ? 'Thinking'
                            : t('Finish speaking')
                    }
                  >
                    {voice && voicePhase === 'thinking' ? (
                      // Three dots rather than an icon: there is nothing to
                      // hear and nothing to say, and a still icon reads as
                      // stuck rather than working.
                      <span className={styles.voiceDots} aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
                      /*
                        The button draws these white, because the circle under
                        them is brand green in either theme. That is why they
                        opt out of the rule darkening icons for the light theme:
                        a glyph darkened for a white page vanishes into green.
                      */
                      <img
                        src={voice && voicePhase === 'speaking' ? volume2Icon : audioLinesIcon}
                        alt=""
                        width={16}
                        height={16}
                        data-keeps-colour
                      />
                    )}
                  </button>
                  {voice && (
                    <button
                      type="button"
                      /*
                        The same control the microphone is, not a bare glyph:
                        it sits in a row with two drawn buttons, and an
                        undrawn one between them reads as something that fell
                        in rather than something you press.
                      */
                      className={styles.micButton}
                      onClick={() => setVoice(false)}
                      title={t('Leave voice mode')}
                      aria-label={t('Leave voice mode')}
                    >
                      <img src={xIcon} alt="" width={16} height={16} />
                    </button>
                  )}
                </>
              )}
              {/*
                Offered only while there is a turn to stop, and only where this
                composer is the thing that started it: in voice mode the circle
                beside this is the control that cuts in, and a second one here
                would be two buttons with one job disagreeing about what a turn
                is.
              */}
              {sending && !voice && (
                <button
                  type="button"
                  className={styles.stopButton}
                  onClick={handleStop}
                  title={t('Stop this answer')}
                >
                  {t('Stop')}
                </button>
              )}
              <button
                type="submit"
                className={styles.sendButton}
                disabled={draft.trim() === '' || (sending && !voice)}
              >
                {sendLabel}
              </button>
            </div>
          </form>
        </div>
        {voice && workspaceId !== null && (
          <VoiceMode
            ref={voiceControls}
            workspaceId={workspaceId}
            turnTaking={turnTaking}
            chunking={chunking}
            onSay={handleVoiceTurn}
            onPhase={setVoicePhase}
            onClose={() => setVoice(false)}
          />
        )}
        </div>
      )}
      {/* The title bar's search focuses the sidebar's box, which is the one that filters. */}

      <ConfirmDialog
        subject={deleting?.title ?? null}
        kind="deleteChat"
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />

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
            {entry.pinned ? t('Unpin chat') : t('Pin chat')}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onRename}>
            {t('Rename chat')}
          </button>
          <button type="button" role="menuitem" className={styles.menuItemDanger} onClick={onDelete}>
            {t('Delete chat')}
          </button>
        </div>
      )}
    </div>
  );
}
