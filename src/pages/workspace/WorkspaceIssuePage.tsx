import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { formatSize, isShowable } from '../../api/attachments';
import {
  ISSUE_STATUS_LABEL,
  addIssueLink,
  attachToIssue,
  commentOnIssue,
  createIssue,
  editIssueComment,
  removeIssueComment,
  fetchIssue,
  fetchIssueHistory,
  fetchIssueLabels,
  fetchIssueTypes,
  issueAttachmentUrl,
  readRelation,
  removeIssueAttachment,
  removeIssueLink,
  updateIssue,
  uploadIssueAttachments,
} from '../../api/issues';
import type {
  Assignee,
  Issue,
  IssueAttachment,
  IssueEvent,
  IssueHistory,
  IssueStatus,
  IssueType,
} from '../../api/issues';
import type { SessionUser } from '../../api/session';
import { TASK_STATUS_LABEL, fetchIssueTasks, startIssueTask, stillGoing } from '../../api/tasks';
import type { Task } from '../../api/tasks';
import { timeAgo } from '../../api/tools';
import { initialsOf } from '../../api/users';
import { AppShell } from '../../components/AppShell';
import { AssigneePicker } from '../../components/AssigneePicker';
import { AttachmentViewer } from '../../components/AttachmentViewer';
import { BackLink } from '../../components/BackLink';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DeleteIssueDialog } from '../../components/DeleteIssueDialog';
import { FieldHint } from '../../components/FieldHint';
import { IssueRelationList } from '../../components/IssueRelationList';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { MoveIssueDialog } from '../../components/MoveIssueDialog';
import { ObserverList } from '../../components/ObserverList';
import { TrashIcon } from '../../components/TrashIcon';
import { UnsavedWorkDialog } from '../../components/UnsavedWorkDialog';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { useLeaveGuard } from '../../components/leaveGuard';
import { useInstallation } from '../../session/installation';
import { shellUser } from '../../session/user';
import styles from './WorkspaceIssuePage.module.css';
import { t } from '../../i18n';

/**
 * How many existing labels are offered at once.
 *
 * Six is a glance; a workspace with forty labels would otherwise put a wall
 * of them under a one-line box, and anybody with forty labels is typing the
 * one they want anyway.
 */
const SUGGESTIONS = 6;

export interface WorkspaceIssuePageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * An address typed against an issue that has not been filed yet.
 *
 * It carries a key of its own because an id is the server's to give and the
 * server has not been told about this yet - the key exists only so the list on
 * the screen can tell two rows apart and take the right one off again.
 */
interface PendingLink {
  key: string;
  url: string;
  title: string;
}

/**
 * Which issue the page below is about, as one string.
 *
 * Two addresses reach the same component - `/issues/4` and `/issues/new` - and
 * three more differ only in the number. React reconciles by position and by
 * type, and both of those are unchanged when the address moves between them, so
 * the instance is kept and every one of its thirty pieces of state with it.
 * That is what issue #238 was: Quick actions goes to `/issues/new` from an issue
 * being read, `creating` turns true, the load effect below returns early because
 * there is nothing to load - and the title and description of the issue that was
 * on screen are still sitting in the form, ready to be filed a second time.
 *
 * The identity is the workspace and the number, so the comment half-typed on
 * one issue does not follow the reader to the next one either.
 */
function subjectOf(workspaceId: string, number: string): string {
  return `${workspaceId}/${number === '' ? 'new' : number}`;
}

/**
 * One issue, in the shape everybody already knows.
 *
 * Title across the top with what can be done to it; the description on the
 * left, its details on the right; the conversation underneath. The same page
 * writes a new one - no id in the path means it does not exist yet - so the
 * form somebody files an issue in is the page they will read it on, rather
 * than a thinner thing they have to leave to finish.
 *
 * The wrapper is the whole of the fix for #238, and it is deliberately not a
 * reset: nothing on this page is cleared on mount, because two things here are
 * meant to survive a render. "File another" keeps the labels and the assignee
 * for the next report on purpose, and the address the form was refused is
 * carried through a `replace` onto this same address. Both of those keep the
 * address they were made on, so both live through a key that only changes when
 * the issue does.
 */
export function WorkspaceIssuePage(props: WorkspaceIssuePageProps) {
  const { workspaceId = '', number = '' } = useParams();
  return <Issue key={subjectOf(workspaceId, number)} {...props} />;
}

function Issue({ session, onSignOut }: WorkspaceIssuePageProps) {
  /*
   * The address carries the number, not the row id.
   *
   * "#4" is what this page shows and what somebody types in a message, so
   * `/issues/4` has to be that issue. Mutations still take the id, which is
   * why the loaded issue is what they are given.
   */
  const { workspaceId = '', number = '' } = useParams();
  const navigate = useNavigate();
  const { pathname, state: arrivedWith } = useLocation();
  const creating = number === '';

  const [issue, setIssue] = useState<Issue | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  /*
   * The labels this workspace already uses, offered as you type.
   *
   * A tracker's labels are only useful when everybody spells them the same
   * way: "p1" and "P1" filter separately, and nobody notices until a search
   * comes back short. Suggesting what exists is what keeps that from
   * happening, without forbidding a new one.
   */
  const [known, setKnown] = useState<string[]>([]);
  /*
   * Whether filing one issue leads to filing the next.
   *
   * Somebody arriving with a list in their head files four things in a row,
   * and being taken to each one as it is filed means four journeys back. Off
   * by default, because the common case is one issue and then reading it.
   */
  const [fileAnother, setFileAnother] = useState(false);
  /** The number of the one just filed, so an emptied form still says it worked. */
  const [filed, setFiled] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [assignee, setAssignee] = useState<Assignee | null>(null);
  /*
   * What kind of thing this is, as the id the form posts back - `''` for
   * untyped, which is a state somebody chooses and not a field they left out.
   * Untyped is what a new issue starts as: guessing would file everything
   * nobody thought about as a bug.
   */
  const [typeId, setTypeId] = useState<string>('');
  const [types, setTypes] = useState<IssueType[]>([]);
  const [status, setStatus] = useState<IssueStatus>('OPEN');
  const [comment, setComment] = useState('');
  /** Whether the description is being written rather than read. */
  const [writing, setWriting] = useState(false);
  /** The comment being changed, and what it is being changed to. */
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  /**
   * The comment being asked about before it is taken off.
   *
   * The author rather than the whole comment, because that is what the question
   * names: quoting the words back at somebody who is removing them for being the
   * wrong words is the one thing this dialog must not do.
   */
  const [removing, setRemoving] = useState<{ id: string; author: string } | null>(null);
  /*
   * Whether the comment being written is being read back instead.
   *
   * The two comment boxes keep their own answer rather than sharing one,
   * because previewing a reply is no reason to stop looking at the wording of
   * the comment being corrected further up the page.
   */
  const [readingComment, setReadingComment] = useState(false);
  const [readingEdit, setReadingEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  /*
   * The issue being moved, which is this one or nothing: the dialog is opened
   * by handing it an issue and closed by handing it null, the way the delete
   * dialogs elsewhere work.
   */
  const [moving, setMoving] = useState<Issue | null>(null);
  /* The issue being deleted, opened and closed the same way as the move. */
  const [deleting, setDeleting] = useState<Issue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * What has been started on this issue, newest first.
   *
   * Read separately from the issue rather than hung on it, because a list of
   * twenty issues would otherwise read this for every row in order to draw one
   * control on the page showing one. What it decides is whether "Start by AI"
   * is a button or a link to the task that already exists.
   */
  const [issueTasks, setIssueTasks] = useState<Task[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /*
   * Which half of the issue is being read: what it says, or how it got here.
   *
   * The history is not part of the issue the page loads. Everybody who follows
   * a link to a report loads that; the history is read by whoever wants to know
   * why it is closed, so it is fetched when this turns and not before.
   */
  const [tab, setTab] = useState<'issue' | 'history'>('issue');
  const [history, setHistory] = useState<IssueHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  /*
   * Whether this installation carries files at all.
   *
   * The same switch the chat reads, because it is the same disk: an operator
   * who has said no has said it once. Off means no control rather than a
   * control that fails - though files already on an issue stay readable, since
   * turning uploads off is not the same as taking somebody's evidence away.
   */
  const installation = useInstallation();
  const attachmentsAllowed = installation?.attachmentsEnabled === true;
  /*
   * Files uploaded against the workspace that have nowhere to be yet.
   *
   * A new issue has no id until it is filed, so what is picked before then is
   * held here and tied to the issue the moment it exists. Uploaded as it is
   * picked rather than on save, so a screenshot travels while the report is
   * still being written.
   */
  const [pending, setPending] = useState<IssueAttachment[]>([]);
  /** The same, for the comment being written: tied when the comment is posted. */
  const [commentFiles, setCommentFiles] = useState<IssueAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Which picture is open over the page, or null when none is. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  /*
   * The address being added, and whether the boxes for it are showing.
   *
   * Behind a word rather than always on the page: most issues never get a
   * link, and two empty text boxes under every one of them would be two boxes
   * nobody fills in sitting where the conversation should start.
   */
  const [addingLink, setAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  /*
   * Addresses typed while the issue is still being written.
   *
   * The same problem the attachments have, with a lighter answer: a link is
   * hung on an issue by its id and a new issue has no id, so what is typed
   * waits here and is hung on the issue the moment filing gives it one. There
   * is nothing to send ahead the way a file is sent ahead, because an address
   * is text, which also means the server has not seen it yet and a refusal
   * cannot arrive until the issue exists.
   */
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  /** Counts the rows above so each gets a key of its own; the server gives ids. */
  const linkKeys = useRef(0);
  const issueFilesRef = useRef<HTMLInputElement>(null);
  const commentFilesRef = useRef<HTMLInputElement>(null);

  // A new issue is written from the first keystroke, not read.
  useEffect(() => {
    if (creating) setWriting(true);
  }, [creating]);

  /*
   * Something the form could not finish, said on the page it concerns.
   *
   * A link refused after the issue has been created leaves the issue standing
   * and the address unsaid, and the only place to type that address again is
   * this issue's own Links section - so the refusal travels here with the
   * navigation rather than dying with the form. Taken off the history entry
   * once it has been shown, because a refusal describes the moment of filing
   * and a page reloaded an hour later should not still be reporting it.
   */
  const trouble = (arrivedWith as { linkTrouble?: string } | null)?.linkTrouble ?? null;
  useEffect(() => {
    if (trouble === null) return;
    setError(trouble);
    navigate(pathname, { replace: true, state: null });
  }, [trouble, pathname, navigate]);

  useEffect(() => {
    if (creating) return;
    let current = true;
    fetchIssue(workspaceId, Number(number))
      .then((found) => {
        if (!current) return;
        if (found === null) {
          setLoadError(t('That issue does not exist, or you do not have access to it.'));
          return;
        }
        setIssue(found);
        // An issue that says nothing opens ready to be written in; one that
        // says something opens as what it says.
        setWriting((found.description ?? '') === '');
        setTitle(found.title);
        setDescription(found.description ?? '');
        setLabels(found.labels);
        setTypeId(found.type?.id ?? '');
        setAssignee(found.assignee);
        setStatus(found.status);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : t('Could not load the issue.'));
      });
    return () => {
      current = false;
    };
  }, [creating, workspaceId, number]);

  /*
   * The history, once somebody asks for it and again whenever the issue moves.
   *
   * Depending on the issue rather than on its number is what keeps the tab
   * honest while it is open: closing an issue or saying something replaces the
   * issue this page holds, and the line that just happened should be in the
   * list a moment later without anybody reloading the page.
   */
  useEffect(() => {
    if (creating || tab !== 'history' || issue === null) return;
    let current = true;
    setHistoryError(null);
    fetchIssueHistory(workspaceId, issue.number)
      .then((found) => {
        // Null is an issue that has gone or was never visible, which the page
        // above has already said; an empty list says so once rather than
        // leaving a spinner turning over nothing.
        if (current) setHistory(found ?? { entries: [], earlier: 0 });
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setHistoryError(cause instanceof Error ? cause.message : t('Could not load the history.'));
      });
    return () => {
      current = false;
    };
  }, [creating, tab, workspaceId, issue]);

  /*
   * What this issue has started, whenever the issue itself is replaced.
   *
   * On the issue and not on its number, the way the history above is: pressing
   * the button replaces the issue this page holds, so the link to the task
   * appears in the same breath rather than after a reload.
   */
  useEffect(() => {
    if (creating || issue === null) return;
    let current = true;
    fetchIssueTasks(issue.id)
      .then((found) => {
        if (current) setIssueTasks(found);
      })
      .catch(() => {
        if (current) setIssueTasks([]);
      });
    return () => {
      current = false;
    };
  }, [creating, issue]);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchIssueLabels(workspaceId)
      .then(setKnown)
      .catch(() => setKnown([]));
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchIssueTypes(workspaceId)
      .then(setTypes)
      .catch(() => setTypes([]));
  }, [workspaceId]);

  /**
   * Stores what the form holds.
   *
   * [thenGo] is true for the button at the top of the page, which is what it
   * has always done: filing an issue lands on the issue, or empties the form
   * for the next one. The leave guard passes false - it is about to take the
   * page somewhere of its own, and a navigation from in here underneath that
   * would be two answers to one press.
   *
   * @returns whether the server took it, which is what the guard's dialog needs
   * in order not to leave on a save that was refused.
   */
  async function save(thenGo = true): Promise<boolean> {
    if (saving) return false;
    if (title.trim() === '') {
      // Unreachable from the button, which is disabled without one. Reachable
      // from Save & Leave, and that dialog promises the reason is on the page.
      setError(t('An issue needs a title before it can be filed.'));
      return false;
    }
    setSaving(true);
    setError(null);
    // Forgotten as soon as another save begins, so that "filed #12" below can
    // only ever mean the save that just happened.
    setFiled(null);
    try {
      const details = {
        title: title.trim(),
        description,
        labels,
        status,
        // Empty is untyped, for the reason an empty assigneeId is nobody: the
        // page posts what its boxes show, and an absent field means untouched.
        typeId,
        assigneeKind: assignee?.kind ?? null,
        /*
         * "No one" is an empty id, not an absent one.
         *
         * Absent is how a caller says it did not touch the assignee - which is
         * what the status buttons below send - so the form cannot use it to
         * mean the opposite. The page posts what its boxes show, and an empty
         * box shows nobody.
         */
        assigneeId: assignee?.id ?? '',
      };
      if (creating) {
        const made = await createIssue({ workspaceId, ...details });
        // The files went up before there was an issue to put them on; this is
        // the moment there is one.
        if (pending.length > 0) {
          await attachToIssue(made.id, pending.map((file) => file.id));
          setPending([]);
        }
        // And the addresses, which had nothing to hang on either. Emptied
        // whatever the server made of them, because they belong to the issue
        // that was just filed and not to whatever is filed next.
        const refused = await hangLinks(made.id);
        setPendingLinks([]);
        const trouble = refusalOf(made.number, refused);
        /*
         * Filed, and staying put. The form is emptied so the page stops
         * claiming to hold work nobody has stored - it has been stored - and
         * the guard takes it from here.
         */
        if (!thenGo) {
          setTitle('');
          setDescription('');
          return true;
        }
        if (fileAnother) {
          /*
           * Cleared back to an empty form rather than reloaded: the point is
           * to keep somebody where they are. The assignee and the labels stay,
           * because four issues filed in a row are usually four issues about
           * the same thing, going to the same person.
           */
          setTitle('');
          setDescription('');
          setFiled(made.number);
          // Said beside the number rather than instead of it: somebody filing
          // a run of issues asked to stay here, and a refused address is not a
          // reason to take them somewhere else.
          if (trouble !== null) setError(trouble);
        } else {
          /*
           * The refusal goes wherever the person was going anyway. The issue
           * exists either way, so it is still the page to land on - it is just
           * a page that has to open saying which address it did not get.
           */
          navigate(`/workspace/${workspaceId}/issues/${made.number}`, {
            replace: true,
            state: trouble === null ? null : { linkTrouble: trouble },
          });
        }
      } else if (issue !== null) {
        setIssue(await updateIssue(issue.id, details));
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not save the issue.'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  /*
   * Work on this screen the server has not been told about.
   *
   * A value comparison against what was loaded, the way the four editors that
   * already use this hook compute theirs: somebody who types a character and
   * takes it out again has changed nothing. A new issue has nothing loaded to
   * compare against, so its baseline is the empty form it opened as.
   *
   * Labels alone do not count while an issue is being written. A label with no
   * title is not a report, and "File another" leaves labels standing in an
   * otherwise empty form on purpose - guarding those would ask a question after
   * every issue in a run, which is how a guard becomes something people click
   * through. Files do count: they are already uploaded, and walking away leaves
   * them on the workspace attached to nothing.
   *
   * A half-typed comment is deliberately not in here either. This save stores
   * the issue and not the conversation, so a dialog offering to save one before
   * leaving would be offering something it does not do.
   */
  const unsaved = useMemo(() => {
    if (creating) {
      return title.trim() !== '' || description.trim() !== '' || pendingLinks.length > 0 || pending.length > 0;
    }
    if (issue === null) return false;
    return (
      title.trim() !== issue.title.trim() ||
      description !== (issue.description ?? '') ||
      labels.length !== issue.labels.length ||
      labels.some((one, at) => one !== issue.labels[at]) ||
      (assignee?.kind ?? null) !== (issue.assignee?.kind ?? null) ||
      (assignee?.id ?? null) !== (issue.assignee?.id ?? null)
    );
  }, [creating, title, description, labels, pendingLinks, pending, issue, assignee]);

  /*
   * The ways out, and the one question before any of them.
   *
   * The same hook the function, tool, object and skill editors use. This page
   * is an editor in every way that matters - it holds a report somebody is
   * writing, and there is no copy of it anywhere until Save is pressed - and it
   * was simply never given one, which is what issue #234 found by way of the
   * workspace picker. The picker is the exit no click listener can see, so it
   * asks the guard itself; see `askBeforeLeaving`.
   */
  const guard = useLeaveGuard({
    unsaved,
    backTo: `/workspace/${workspaceId}/issues`,
    save: () => save(false),
  });

  /**
   * Moving an issue along, in one click from wherever it is.
   *
   * Open leads to in progress and in progress to closed, because that is the
   * order work actually happens in; closed leads back to open, which is what
   * reopening means. The button says where it is now and its title says where
   * pressing it goes, so nothing has to be guessed from an arrow.
   */
  function nextStatus(from: IssueStatus): IssueStatus {
    if (from === 'OPEN') return 'IN_PROGRESS';
    return from === 'IN_PROGRESS' ? 'CLOSED' : 'OPEN';
  }

  async function setIssueStatus(wanted: IssueStatus) {
    if (creating || saving) return;
    if (issue === null) return;
    setSaving(true);
    try {
      const held = await updateIssue(issue.id, { status: wanted });
      setIssue(held);
      setStatus(held.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not change the status.'));
    } finally {
      setSaving(false);
    }
  }

  /** The one-click move, for the places that offer it. */
  async function toggleStatus() {
    await setIssueStatus(nextStatus(status));
  }

  /**
   * Hands the issue to the agent it is assigned to.
   *
   * The page does not go to the task. Pressing this is not leaving the issue -
   * most people press it and carry on reading - and a navigation from here would
   * also have to argue with the leave guard over a description somebody is
   * halfway through. What it does instead is turn itself into the link, which is
   * the same journey one press later and the one that is still there tomorrow.
   */
  async function startByAI() {
    if (issue === null || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const started = await startIssueTask(issue.id);
      setIssueTasks([started, ...issueTasks]);
      // The server moved the issue to In progress, so the page has to say so.
      setStatus('IN_PROGRESS');
      setIssue({ ...issue, status: 'IN_PROGRESS' });
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : t('Could not start it.'));
    } finally {
      setStarting(false);
    }
  }

  /** Saving a change to a comment; only the author is offered this. */
  async function saveComment() {
    if (editing === null || saving) return;
    setSaving(true);
    try {
      setIssue(await editIssueComment(editing.id, editing.content));
      setEditing(null);
      setReadingEdit(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not change the comment.'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Taking a comment off, once the dialog has been answered.
   *
   * The answer is the issue without it, so the thread redraws from the server
   * rather than from a copy this page pruned itself - the history tab, the
   * attachments and the last-comment mark all move with it.
   */
  async function removeComment(id: string) {
    setIssue(await removeIssueComment(id));
    // A comment being corrected that has just been removed is a form with
    // nothing behind it.
    if (editing?.id === id) setEditing(null);
    setRemoving(null);
  }

  async function comment_() {
    const said = comment.trim();
    if (said === '' || creating || saving || issue === null) return;
    setSaving(true);
    try {
      setIssue(await commentOnIssue(issue.id, said, commentFiles.map((file) => file.id)));
      setComment('');
      setCommentFiles([]);
      // The next comment starts as a box to type in, not as a preview of nothing.
      setReadingComment(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not add the comment.'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Uploads what was picked, and puts it where it belongs.
   *
   * An issue that exists takes its files immediately - there is no "save" step
   * to lose them in, and a file that is on the screen but not on the issue is
   * the kind of thing somebody discovers a week later. One that does not exist
   * yet keeps them beside the form until it is filed.
   */
  async function upload(files: FileList | null, going: 'issue' | 'comment') {
    if (files === null || files.length === 0) return;
    await attach(Array.from(files), going);
    // Cleared so the same file can be picked twice in a row.
    const picker = going === 'comment' ? commentFilesRef.current : issueFilesRef.current;
    if (picker !== null) picker.value = '';
  }

  /** Where both ways of choosing a file end up: the picker, and a paste. */
  async function attach(files: File[], going: 'issue' | 'comment') {
    if (files.length === 0 || workspaceId === '') return;

    setUploading(true);
    setError(null);
    try {
      const held = await uploadIssueAttachments(workspaceId, files);
      if (going === 'comment') {
        setCommentFiles((current) => [...current, ...held]);
      } else if (!creating && issue !== null) {
        setIssue(await attachToIssue(issue.id, held.map((file) => file.id)));
      } else {
        setPending((current) => [...current, ...held]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Those files could not be uploaded.'));
    } finally {
      setUploading(false);
    }
  }

  /**
   * A screenshot pasted straight in, rather than saved to disk first.
   *
   * Taking a screenshot puts it on the clipboard; attaching it meant saving it
   * to a folder, finding it in a file picker and deleting it afterwards, which
   * is three steps to say "look at this". A pasted image has no name of its
   * own, so it is given one from the clock - the alternative is a page of files
   * all called image.png.
   *
   * Only images. A clipboard can hold anything, and text pasted into a comment
   * is text somebody meant to paste: intercepting that would make an ordinary
   * paste attach a file nobody asked for.
   */
  async function pasted(event: ReactClipboardEvent<HTMLTextAreaElement>, going: 'issue' | 'comment') {
    const carried: DataTransferItem[] = Array.from(event.clipboardData?.items ?? []);
    const images = carried.filter((item) => item.type.startsWith('image/'));
    if (images.length === 0) return;

    // Kept out of the box it was aimed at: an image pasted into a textarea
    // would otherwise leave its file name behind as text.
    event.preventDefault();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const files = images
      .map((item, at) => {
        const file = item.getAsFile();
        if (file === null) return null;
        const kind = file.type.split('/')[1] ?? 'png';
        return new File([file], `Pasted ${stamp}${images.length > 1 ? ` (${at + 1})` : ''}.${kind}`, {
          type: file.type,
        });
      })
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;

    await attach(files, going);
  }

  /**
   * Takes a file off again, wherever it is showing.
   *
   * The server refuses this for anybody but whoever attached it, so the button
   * is only offered to them - but the issue is read again afterwards rather
   * than edited in place, because a file may have been on a comment and
   * unpicking that here would be this page keeping its own account of what the
   * issue holds.
   */
  async function detach(id: string) {
    setError(null);
    try {
      await removeIssueAttachment(id);
      setPending((current) => current.filter((file) => file.id !== id));
      setCommentFiles((current) => current.filter((file) => file.id !== id));
      if (previewId === id) setPreviewId(null);
      if (!creating) {
        const again = await fetchIssue(workspaceId, Number(number));
        if (again !== null) setIssue(again);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not remove the attachment.'));
    }
  }

  /**
   * Hangs an address on the issue.
   *
   * What may be kept is the server's decision, not this page's - only http and
   * https, because a link is rendered as an anchor other people click - so
   * nothing is checked here beyond there being something to send, and the
   * refusal is shown in the words the server used.
   */
  async function addLink() {
    const address = linkUrl.trim();
    if (address === '' || saving) return;
    if (creating) {
      /*
       * Nothing to send: there is no issue to send it to, so the address waits
       * on the page the way a picked file waits. Whether it may be kept is
       * still the server's decision and not this page's - it is simply asked
       * later, which is the whole of what makes this different from the case
       * below.
       */
      const key = `pending-${linkKeys.current++}`;
      setPendingLinks((current) => [...current, { key, url: address, title: linkTitle }]);
      setLinkUrl('');
      setLinkTitle('');
      setAddingLink(false);
      return;
    }
    if (issue === null) return;
    setSaving(true);
    setError(null);
    try {
      setIssue(await addIssueLink(issue.id, address, linkTitle));
      setLinkUrl('');
      setLinkTitle('');
      setAddingLink(false);
    } catch (cause) {
      // The boxes are left as they were: a refused address is usually one
      // keystroke from an accepted one.
      setError(cause instanceof Error ? cause.message : t('That link could not be added.'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Hangs the waiting addresses on the issue that has just been filed.
   *
   * One at a time, and a refusal is kept rather than thrown, because one bad
   * address is no reason to drop the good ones typed after it. What comes back
   * is the addresses the server would not take, each with the words it used.
   *
   * The box counts too. Somebody who types an address and then presses File
   * Issue has plainly asked for that address to be on the issue, and losing it
   * because they did not press Add first would be the page being pedantic
   * about its own buttons.
   */
  async function hangLinks(id: string): Promise<string[]> {
    const typed = linkUrl.trim();
    const wanted =
      typed === '' ? pendingLinks : [...pendingLinks, { key: 'typed', url: typed, title: linkTitle }];
    setLinkUrl('');
    setLinkTitle('');
    setAddingLink(false);

    const refused: string[] = [];
    for (const link of wanted) {
      try {
        await addIssueLink(id, link.url, link.title);
      } catch (cause) {
        refused.push(`${link.url} - ${cause instanceof Error ? cause.message : 'refused'}`);
      }
    }
    return refused;
  }

  /**
   * What to say when the issue was filed and an address on it was not.
   *
   * The number goes first because that is the part somebody has to know: the
   * issue is real, whatever else went wrong, and a message that only said "the
   * link was refused" would read like nothing at all had happened.
   */
  function refusalOf(made: number, refused: string[]): string | null {
    if (refused.length === 0) return null;
    const what = refused.length === 1 ? 'this address was not added' : 'these addresses were not added';
    return `Filed as #${made}, but ${what}: ${refused.join('; ')}.`;
  }

  /** Takes a waiting one off again, before there is an issue to take it off. */
  function dropPendingLink(key: string) {
    setPendingLinks((current) => current.filter((link) => link.key !== key));
  }

  /** Takes one off again; only whoever added it is offered the button. */
  async function removeLink(id: string) {
    if (issue === null) return;
    setError(null);
    try {
      await removeIssueLink(id);
      const again = await fetchIssue(workspaceId, Number(number));
      if (again !== null) setIssue(again);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not remove the link.'));
    }
  }

  function addLabel() {
    const wanted = labelDraft.trim();
    if (wanted === '' || labels.includes(wanted)) {
      setLabelDraft('');
      return;
    }
    setLabels([...labels, wanted]);
    setLabelDraft('');
  }

  /*
   * What is on the issue itself: its own files once it exists, and what is
   * waiting for it while it does not.
   */
  const issueFiles = creating ? pending : (issue?.attachments ?? []);
  /*
   * The same again for the addresses: what the issue holds once it exists, and
   * what is waiting to be hung on it while it does not. A waiting one has no
   * reading of GitHub's shape because the server works that out when it is
   * given the address, so it shows as what was typed until the issue is filed.
   */
  const issueLinks: DrawnLink[] = creating
    ? pendingLinks.map((link) => ({
        id: link.key,
        url: link.url,
        title: link.title.trim() === '' ? null : link.title,
        github: null,
        addedBy: null,
        addedAt: null,
        mine: true,
      }))
    : (issue?.links ?? []);
  /*
   * Every picture on the page, in the order they are read in, so the viewer's
   * arrows walk the issue rather than only the chip that was clicked.
   */
  const pictures = [
    ...issueFiles,
    ...(issue?.comments.flatMap((said) => said.attachments) ?? []),
    ...commentFiles,
  ].filter((file) => isShowable(file.contentType));

  return (
    <AppShell
      title={creating ? t('New issue') : issue === null ? undefined : `#${issue.number} ${issue.title}`}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        </section>
      ) : !creating && issue === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <section className={styles.card}>
          <header className={styles.header}>
            <div className={styles.titleRow}>
              <BackLink to={`/workspace/${workspaceId}/issues`} label={t('Issues')} />
              {!creating && <span className={styles.number}>#{issue?.number}</span>}
              <input
                className={styles.titleInput}
                type="text"
                value={title}
                placeholder={t('What is wrong?')}
                aria-label={t('Title')}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className={styles.actions}>
              {/*
                Administrators only, and the button is only drawn for them so
                that it and the server's refusal agree - a button that exists
                only to be told no is worse than no button.
              */}
              {!creating && session.admin && (
                <button
                  type="button"
                  className={styles.ghost}
                  title={t('Move this issue to another workspace')}
                  onClick={() => setMoving(issue)}
                >{t('Move')}</button>
              )}
              {!creating && (
                <button
                  type="button"
                  className={styles.delete}
                  aria-label={t('Delete this issue')}
                  title={t('Delete')}
                  onClick={() => setDeleting(issue)}
                >
                  <TrashIcon />
                </button>
              )}
              {creating && (
                /*
                  Beside the button it changes, not above it: a checkbox that
                  alters what a button does has to be read in the same glance
                  as the button.
                */
                <label className={styles.fileAnother}>
                  <input
                    type="checkbox"
                    checked={fileAnother}
                    onChange={(event) => setFileAnother(event.target.checked)}
                  />
                  {t('File another')}
                </label>
              )}
              <button
                type="button"
                className={styles.save}
                onClick={() => void save()}
                disabled={saving || title.trim() === ''}
              >
                {saving ? t('Saving…') : creating ? t('File Issue') : 'Save'}
              </button>
            </div>
          </header>

          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {/*
            An emptied form looks exactly like a form that did nothing, so the
            one just filed says so and links to itself - the only way back to it
            once the page has moved on. Shown beside an error rather than
            instead of one, because filing the issue and failing to put an
            address on it is both of those things at once; the number is
            forgotten when the next save begins, so it can never be stale.
          */}
          {creating && filed !== null && (
            <p className={styles.filed} role="status">
              Filed{' '}
              <Link to={`/workspace/${workspaceId}/issues/${filed}`} className={styles.filedLink}>
                #{filed}
              </Link>
              {t('. The next one is ready.')}
            </p>
          )}

          {/*
            Below the header and above everything else, because it divides the
            page rather than the description: what the issue says, and what has
            happened to it. Not drawn while one is being filed - an issue that
            does not exist yet has no history, and a tab that is always empty is
            a tab that teaches people not to press it.
          */}
          {!creating && (
            <div className={styles.tabs} role="tablist" aria-label={t('Issue')}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'issue'}
                className={tab === 'issue' ? styles.tabActive : styles.tab}
                onClick={() => setTab('issue')}
              >{t('Issue')}</button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'history'}
                className={tab === 'history' ? styles.tabActive : styles.tab}
                onClick={() => setTab('history')}
              >{t('History')}</button>
            </div>
          )}

          {/*
            The side keeps its place under both tabs. What the issue is right
            now - who has it, what it is called, whether it is closed - is the
            context somebody reads a history against, and taking it away to show
            them how it got here would be answering half the question.
          */}
          <div className={styles.split}>
            {tab === 'history' ? (
              <div className={styles.main}>
                <History
                  history={history}
                  error={historyError}
                  onShowComment={(id) => {
                    setTab('issue');
                    /*
                      After the tab has been drawn, which is why this waits: the
                      comment is not on the page at the moment the button is
                      pressed, so anything looking for it now finds nothing.
                    */
                    window.setTimeout(() => {
                      document
                        .getElementById(`comment-${id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 0);
                  }}
                />
              </div>
            ) : (
            <div className={styles.main}>
              <span className={styles.labelRow}>
                <span className={styles.label}>{t('Description')}</span>
                {/*
                  Offered while the issue is being filed too. A report is
                  written once and read by everybody after, so the moment
                  somebody most wants to see how their markdown lands is
                  before they have handed it over.
                */}
                <button type="button" className={styles.textButton} onClick={() => setWriting(!writing)}>
                  {writing ? 'Preview' : 'Edit'}
                </button>
              </span>
              {writing ? (
                <MarkdownEditor
                  value={description}
                  onChange={setDescription}
                  workspaceId={workspaceId}
                  rows={10}
                  ariaLabel={t('Description')}
                  placeholder={t('What happens, and what should happen instead. Paste a screenshot to attach it.')}
                  onPaste={(event) => void pasted(event, 'issue')}
                />
              ) : (
                /* What was written, as it reads. Clicking it writes again,
                   because the thing somebody wants after reading their own
                   description is usually to change it. */
                <Written text={description} workspaceId={workspaceId} onWrite={() => setWriting(true)} />
              )}

              {/*
                What came with the issue, under what it says.

                Shown even when uploads have been switched off, because turning
                them off stops new files rather than taking away the evidence on
                issues that already have some.
              */}
              {(attachmentsAllowed || issueFiles.length > 0) && (
                <section className={styles.files}>
                  <span className={styles.labelRow}>
                    <span className={styles.label}>{t('Attachments')}</span>
                    {attachmentsAllowed && (
                      <button
                        type="button"
                        className={styles.textButton}
                        disabled={uploading}
                        onClick={() => issueFilesRef.current?.click()}
                      >
                        {uploading ? t('Uploading…') : t('Attach files')}
                      </button>
                    )}
                  </span>
                  {/*
                    "Nothing attached yet." stops being true the moment a file
                    is on it. That a screenshot beats a paragraph is an argument
                    for attaching one, and it is exactly as true of an issue with
                    four files on it - so by the rules file's test it is not
                    status. Behind the (?) beside the line, not deleted: it is
                    the only place the product makes the case.
                  */}
                  {issueFiles.length === 0 ? (
                    <p className={styles.nothing}>
                      <span className={styles.labelWithHint}>
                        {t('Nothing attached yet.')}
                        <FieldHint label={t('Nothing attached yet')}>
                          {t('A screenshot is worth a paragraph of description. Anything else that shows the thing rather than describes it belongs here too — a log, an export, the file that would not open.')}
                        </FieldHint>
                      </span>
                    </p>
                  ) : (
                    <Attachments files={issueFiles} onOpen={setPreviewId} onRemove={(id) => void detach(id)} />
                  )}
                  <input
                    ref={issueFilesRef}
                    className={styles.hiddenPicker}
                    type="file"
                    multiple
                    onChange={(event) => void upload(event.target.files, 'issue')}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                </section>
              )}

              {/*
                Where the rest of the story is.

                Offered while the issue is being filed too. The pull request
                and the failing page are what somebody has open at the moment
                they decide to report something, and telling them to file first
                and come back is telling them to lose the tab they were looking
                at.
              */}
              <section className={styles.files}>
                <span className={styles.labelRow}>
                  <span className={styles.label}>{t('Links')}</span>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      setAddingLink(!addingLink);
                      setLinkUrl('');
                      setLinkTitle('');
                    }}
                  >
                    {addingLink ? 'Cancel' : t('Add a link')}
                  </button>
                </span>
                {addingLink && (
                  <div className={styles.linkForm}>
                    <input
                      className={styles.linkInput}
                      type="url"
                      value={linkUrl}
                      placeholder="https://…"
                      aria-label={t('Address')}
                      autoFocus
                      onChange={(event) => setLinkUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void addLink();
                        }
                      }}
                    />
                    {/*
                      Optional, and says so: a GitHub address names itself,
                      and a box that looks required would have people typing
                      "PR" into it.
                    */}
                    <input
                      className={styles.linkInput}
                      type="text"
                      value={linkTitle}
                      placeholder={t('What to call it (optional)')}
                      aria-label={t('What to call it')}
                      onChange={(event) => setLinkTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void addLink();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={saving || linkUrl.trim() === ''}
                      onClick={() => void addLink()}
                    >{t('Add')}</button>
                  </div>
                )}
                {issueLinks.length === 0 ? (
                  <p className={styles.nothing}>
                    {t('Nothing linked yet. The pull request, the dashboard, the page that will not load.')}
                  </p>
                ) : (
                  <Links
                    links={issueLinks}
                    onRemove={(id) => {
                      // While the issue is being written the rows are this
                      // page's own, so taking one off is a matter for this page
                      // alone; once it exists the server is what holds them.
                      if (creating) dropPendingLink(id);
                      else void removeLink(id);
                    }}
                  />
                )}
              </section>

              {/*
                What this issue has to do with the others, under the addresses
                because the two are the same question asked twice: what else is
                this about, outside the tracker and inside it.

                Only once the issue exists, unlike the addresses above. A link
                is a row naming two issues, and while this form is still being
                written there is only one of them - the same reason the observer
                list and the reporter block wait.
              */}
              {!creating && issue !== null && (
                <IssueRelationList
                  workspaceId={workspaceId}
                  issueId={issue.id}
                  number={issue.number}
                  related={issue.related}
                  onChanged={setIssue}
                />
              )}

              {!creating && (
                <section className={styles.comments}>
                  <h2 className={styles.commentsTitle}>Comments</h2>
                  {issue?.comments.length === 0 && <p className={styles.nothing}>Nothing said yet.</p>}

                  {issue?.comments.map((said) => (
                    <article key={said.id} id={`comment-${said.id}`} className={styles.comment}>
                      <span className={styles.avatar} aria-hidden="true">
                        {initialsOf(said.author)}
                      </span>
                      <div className={styles.commentBody}>
                        <p className={styles.commentHead}>
                          <strong>{said.author}</strong> commented {timeAgo(said.createdAt)}
                          {/* Said, not hidden: a comment that changed says so. */}
                          {said.editedAt !== null && <span className={styles.edited}> · edited</span>}
                          {said.mine && editing?.id !== said.id && (
                            <button
                              type="button"
                              className={styles.textButton}
                              onClick={() => {
                                setEditing({ id: said.id, content: said.content });
                                setReadingEdit(false);
                              }}
                            >
                              {t('Edit')}
                            </button>
                          )}
                          {/*
                            Wider than Edit: whoever wrote it, or an administrator
                            of this workspace. The server says which on the comment
                            rather than this page comparing names, so the button and
                            the refusal cannot disagree.
                          */}
                          {said.mayRemove && (
                            <button
                              type="button"
                              className={styles.textButton}
                              aria-label={t('Remove this comment')}
                              onClick={() => setRemoving({ id: said.id, author: said.author })}
                            >
                              {t('Remove')}
                            </button>
                          )}
                        </p>

                        {editing?.id === said.id ? (
                          <div className={styles.commentEditor}>
                            <span className={styles.labelRow}>
                              <span className={styles.label}>Comment</span>
                              <button
                                type="button"
                                className={styles.textButton}
                                onClick={() => setReadingEdit(!readingEdit)}
                              >
                                {readingEdit ? 'Edit' : 'Preview'}
                              </button>
                            </span>
                            {readingEdit ? (
                              <Written
                                text={editing.content}
                                workspaceId={workspaceId}
                                onWrite={() => setReadingEdit(false)}
                                short
                              />
                            ) : (
                              <MarkdownEditor
                                value={editing.content}
                                onChange={(next) => setEditing({ id: said.id, content: next })}
                                workspaceId={workspaceId}
                                rows={4}
                                ariaLabel={t('Edit this comment')}
                              />
                            )}
                            <div className={styles.composerActions}>
                              <button
                                type="button"
                                className={styles.ghost}
                                onClick={() => {
                                  setEditing(null);
                                  setReadingEdit(false);
                                }}
                              >
                                {t('Cancel')}
                              </button>
                              <button
                                type="button"
                                className={styles.save}
                                onClick={() => void saveComment()}
                                disabled={saving || editing.content.trim() === ''}
                              >
                                {t('Save')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.commentText}>
                            <Markdown issuesIn={workspaceId}>{said.content}</Markdown>
                          </div>
                        )}

                        {said.attachments.length > 0 && (
                          <Attachments
                            files={said.attachments}
                            onOpen={setPreviewId}
                            onRemove={(id) => void detach(id)}
                          />
                        )}
                      </div>
                    </article>
                  ))}

                  <div className={styles.composer}>
                    {/* What is going with the comment, above the box it is going from. */}
                    {commentFiles.length > 0 && (
                      <Attachments
                        files={commentFiles}
                        onOpen={setPreviewId}
                        onRemove={(id) => void detach(id)}
                      />
                    )}
                    <span className={styles.labelRow}>
                      <span className={styles.label}>Comment</span>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => setReadingComment(!readingComment)}
                      >
                        {readingComment ? 'Edit' : 'Preview'}
                      </button>
                    </span>
                    {readingComment ? (
                      <Written
                        text={comment}
                        workspaceId={workspaceId}
                        onWrite={() => setReadingComment(false)}
                        short
                      />
                    ) : (
                      <MarkdownEditor
                        value={comment}
                        onChange={setComment}
                        workspaceId={workspaceId}
                        rows={3}
                        ariaLabel={t('Add a comment')}
                        placeholder={t('Say something… paste a screenshot to attach it.')}
                        onPaste={(event) => void pasted(event, 'comment')}
                      />
                    )}
                    <div className={styles.composerActions}>
                      {attachmentsAllowed && (
                        <button
                          type="button"
                          className={styles.textButton}
                          disabled={uploading}
                          onClick={() => commentFilesRef.current?.click()}
                        >
                          {uploading ? t('Uploading…') : t('Attach files')}
                        </button>
                      )}
                      <input
                        ref={commentFilesRef}
                        className={styles.hiddenPicker}
                        type="file"
                        multiple
                        onChange={(event) => void upload(event.target.files, 'comment')}
                        aria-hidden="true"
                        tabIndex={-1}
                      />
                      {/* Closing and commenting are the two things anybody does here. */}
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => void setIssueStatus(status === 'CLOSED' ? 'OPEN' : 'CLOSED')}
                        disabled={saving}
                      >
                        {status === 'CLOSED' ? t('Reopen issue') : t('Close issue')}
                      </button>
                      <button
                        type="button"
                        className={styles.save}
                        onClick={() => void comment_()}
                        disabled={saving || comment.trim() === ''}
                      >
                        {t('Comment')}
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>
            )}

            <aside className={styles.side}>
              <div className={styles.sideField}>
                <span className={styles.label}>Status</span>
                <button
                  type="button"
                  className={
                    status === 'OPEN'
                      ? styles.statusOpen
                      : status === 'IN_PROGRESS'
                        ? styles.statusProgress
                        : styles.statusClosed
                  }
                  onClick={() => void toggleStatus()}
                  disabled={creating || saving}
                  title={
                    creating
                      ? t('A new issue opens when it is filed')
                      : `Press for ${ISSUE_STATUS_LABEL[nextStatus(status)].toLowerCase()}`
                  }
                >
                  {ISSUE_STATUS_LABEL[status]}
                </button>
              </div>

              {/*
                One of a short, closed list, so a select and not the text box
                the labels below get. Untyped is a choice in it rather than the
                absence of one - an issue nobody has classified is a real state
                and stays readable as one.
              */}
              <div className={styles.sideField}>
                <span className={styles.label}>Type</span>
                <select
                  className={styles.typeSelect}
                  aria-label={t('Issue type')}
                  value={typeId}
                  onChange={(event) => setTypeId(event.target.value)}
                  disabled={saving}
                >
                  <option value="">Untyped</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              <AssigneePicker workspaceId={workspaceId} chosen={assignee} onChoose={setAssignee} />

              {/*
                Under the assignee, because it is about the assignee.

                Drawn only where the issue is assigned to an *agent* and is not
                closed - a person, a model and nobody are all things that cannot
                be set to work, and a button that exists only to be refused is
                worse than no button. It is the same condition the server checks,
                so the two cannot disagree.

                Once something is going it is a link and not a button. Two people
                looking at a stalled issue will both press it, and what the
                second one needs is the task that already exists rather than a
                second agent on the same problem.

                Read off the saved issue and not off the picker beside it. An
                agent chosen and not yet saved is not who the issue is assigned
                to, and a button that appeared on the choice would hand the work
                to whoever was there before it.
              */}
              {!creating &&
                issue !== null &&
                issue.assignee?.kind === 'AGENT' &&
                issue.status !== 'CLOSED' && (
                  <div className={styles.sideField} data-testid="issue-ai">
                    <span className={styles.labelWithHint}>
                      <span className={styles.label}>Start by AI</span>
                      <FieldHint label={t('Start by AI')}>
                        Hands this issue to <strong>{issue.assignee.name}</strong> as a task: the number,
                        the title, the kind, the labels, the description and the conversation, in the
                        agent's own words no further than that. The issue moves to In progress and the
                        task is linked to it both ways, so whoever is watching this issue hears what the
                        agent asks for and what it comes back with. Nothing puts the issue back
                        afterwards — a task that fails or is stopped leaves it where you put it, and it
                        is yours to move.
                      </FieldHint>
                    </span>
                    {stillGoing(issueTasks) !== null ? (
                      <Link
                        className={styles.aiRunning}
                        data-testid="issue-task-link"
                        to={`/workspace/${workspaceId}/tasks/${stillGoing(issueTasks)?.id}`}
                      >
                        {t('Working on it — open the task')}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={styles.aiStart}
                        data-testid="issue-start-ai"
                        disabled={starting}
                        onClick={() => void startByAI()}
                      >
                        {starting ? 'Starting…' : t('Start by AI')}
                      </button>
                    )}
                    {stillGoing(issueTasks) === null && issueTasks.length > 0 && (
                      <Link
                        className={styles.aiLast}
                        data-testid="issue-task-link"
                        to={`/workspace/${workspaceId}/tasks/${issueTasks[0].id}`}
                      >
                        Last task: {TASK_STATUS_LABEL[issueTasks[0].status].toLowerCase()}
                      </Link>
                    )}
                    {startError !== null && (
                      <span className={styles.startError} role="alert">
                        {startError}
                      </span>
                    )}
                  </div>
                )}

              <div className={styles.sideField}>
                <span className={styles.label}>Labels</span>
                <div className={styles.labels}>
                  {labels.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className={styles.label_}
                      title={t('Remove this label')}
                      onClick={() => setLabels(labels.filter((held) => held !== label))}
                    >
                      {label} ×
                    </button>
                  ))}
                </div>
                <input
                  className={styles.labelInput}
                  type="text"
                  value={labelDraft}
                  placeholder={t('Add a label…')}
                  aria-label={t('Add a label')}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addLabel();
                    }
                  }}
                  onBlur={addLabel}
                />
                {/*
                  What this workspace already calls things, narrowed as you
                  type. Only labels not already on this issue, and only when
                  there is something to choose - a list that never shrinks is a
                  list nobody reads.
                */}
                {known.filter(
                  (one) =>
                    !labels.includes(one) &&
                    (labelDraft.trim() === '' || one.toLowerCase().includes(labelDraft.trim().toLowerCase())),
                ).length > 0 && (
                  <div className={styles.labelSuggestions}>
                    {known
                      .filter(
                        (one) =>
                          !labels.includes(one) &&
                          (labelDraft.trim() === '' ||
                            one.toLowerCase().includes(labelDraft.trim().toLowerCase())),
                      )
                      .slice(0, SUGGESTIONS)
                      .map((one) => (
                        <button
                          key={one}
                          type="button"
                          className={styles.labelSuggestion}
                          // Pressed rather than clicked, so the label box losing
                          // focus does not add whatever was half-typed first.
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setLabels([...labels, one]);
                            setLabelDraft('');
                          }}
                        >
                          + {one}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/*
                Below Labels, where it was asked for, and only once the issue
                exists - an observer is a row against an issue, and there is
                nothing to hang one on while the form is still being written.
                The same reason the Reporter block underneath waits.
              */}
              {!creating && issue !== null && (
                <ObserverList
                  workspaceId={workspaceId}
                  issueId={issue.id}
                  observers={issue.observers}
                  admin={session.admin}
                  onChanged={setIssue}
                />
              )}

              {!creating && (
                <div className={styles.sideField}>
                  <span className={styles.label}>Reporter</span>
                  <span className={styles.reporter}>
                    <span className={styles.avatar} aria-hidden="true">
                      {initialsOf(issue?.reporter ?? '?')}
                    </span>
                    {issue?.reporter}
                  </span>
                  <span className={styles.when}>opened {timeAgo(issue?.createdAt ?? '')}</span>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {/*
        A picture opens over the issue rather than in a tab: a tab loses the
        issue it belongs to, and somebody checking a screenshot wants to look
        and carry on reading. Its own address, because an issue's files and a
        chat's are different rows served by different endpoints.
      */}
      <AttachmentViewer
        images={pictures}
        openId={previewId}
        onClose={() => setPreviewId(null)}
        onOpen={setPreviewId}
        urlOf={issueAttachmentUrl}
      />

      {/*
        The page goes to the issue's new address rather than reloading this one.
        The number changed, so the address in the bar now belongs to nothing, or
        to whatever was filed here next.
      */}
      <MoveIssueDialog
        issue={moving}
        onClose={() => setMoving(null)}
        onMoved={(moved) => {
          setMoving(null);
          navigate(`/workspace/${moved.workspaceId}/issues/${moved.number}`);
        }}
      />

      {/*
        Back to the list once it is gone: this page's address no longer names
        anything, so staying here would only show the not-found card.
      */}
      {/*
        Asked before it happens, like everything else here that cannot be
        undone. Named by whoever wrote the comment rather than by what it said.
      */}
      <ConfirmDialog
        subject={removing?.author ?? null}
        kind="removeComment"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing !== null) await removeComment(removing.id);
        }}
      />

      <DeleteIssueDialog
        issue={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          navigate(`/workspace/${workspaceId}/issues`);
        }}
      />

      {/*
        Outside the branch above, so it is the same dialog whichever state the
        page is in, exactly as the four editors draw theirs.

        An issue being written has no name until it has a title, and the dialog
        puts what it is given in quotation marks - so a form with nothing in the
        title box is described rather than quoted as an empty string.
      */}
      <UnsavedWorkDialog
        subject={guard.asking ? (creating ? title.trim() || t('This issue') : (issue?.title ?? t('This issue'))) : null}
        creating={creating}
        onStay={guard.stay}
        onLeave={guard.leave}
        onSaveAndLeave={guard.saveAndLeave}
      />
    </AppShell>
  );
}

interface WrittenProps {
  /** The markdown as it stands in the box this stands in for. */
  text: string;
  /** Where a `#12` in it points, which is the workspace the issue is in. */
  workspaceId: string;
  /** Back to the box, for the double click and the Enter that ask for it. */
  onWrite: () => void;
  /** Whether this replaces a comment's few rows rather than a whole description. */
  short?: boolean;
}

/**
 * Markdown as it will read once it is saved.
 *
 * Through the same renderer the saved text goes through rather than a second
 * one of its own, because the only useful preview is one that cannot disagree
 * with the page it is predicting - a `#12` has to become the link it will
 * become, and a fenced block has to be coloured the way it will be coloured.
 * The moment a preview draws it differently, the version somebody trusts is
 * the version that is wrong.
 */
function Written({ text, workspaceId, onWrite, short = false }: WrittenProps) {
  return (
    <div
      className={short ? `${styles.rendered} ${styles.renderedShort}` : styles.rendered}
      role="button"
      tabIndex={0}
      onDoubleClick={onWrite}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onWrite();
      }}
    >
      {text.trim() === '' ? (
        <p className={styles.nothing}>{t('Nothing written yet.')}</p>
      ) : (
        <Markdown issuesIn={workspaceId}>{text}</Markdown>
      )}
    </div>
  );
}

interface AttachmentsProps {
  files: IssueAttachment[];
  /** Opens a picture in the viewer. */
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * A row of files, as chips.
 *
 * A picture shows itself and opens in the viewer; anything else downloads. Not
 * a matter of taste - the server hands back everything that is not a picture as
 * an octet-stream marked `attachment`, so there is nothing a viewer could put
 * on the screen.
 *
 * Who attached it and when are on the chip rather than behind a hover, because
 * on an issue they are half the point: "the screenshot from before the fix" is
 * only answerable when the date is showing.
 *
 * The remove button appears on your own only. The server refuses anybody
 * else's, the way it refuses editing somebody else's comment, and a button
 * whose whole purpose is to produce a refusal is worse than no button.
 */
function Attachments({ files, onOpen, onRemove }: AttachmentsProps) {
  return (
    <div className={styles.attachments}>
      {files.map((file) => (
        <span key={file.id} className={styles.attachment}>
          {isShowable(file.contentType) && (
            <button
              type="button"
              className={styles.thumbButton}
              onClick={() => onOpen(file.id)}
              title={`Open ${file.filename}`}
            >
              <img className={styles.thumb} src={issueAttachmentUrl(file.id)} alt="" />
            </button>
          )}
          {isShowable(file.contentType) ? (
            <button
              type="button"
              className={styles.attachmentName}
              onClick={() => onOpen(file.id)}
              title={`Open ${file.filename}`}
            >
              {file.filename}
            </button>
          ) : (
            <a
              className={styles.attachmentName}
              href={issueAttachmentUrl(file.id)}
              download={file.filename}
              title={`Download ${file.filename}`}
            >
              {file.filename}
            </a>
          )}
          <span className={styles.attachmentMeta}>
            {formatSize(file.sizeBytes)} · {file.uploadedBy} · {timeAgo(file.uploadedAt)}
          </span>
          {file.mine && (
            <button
              type="button"
              className={styles.attachmentRemove}
              onClick={() => onRemove(file.id)}
              aria-label={`Remove ${file.filename}`}
              title={t('Remove')}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * A link as this page draws it, which is one of two things.
 *
 * Either one the server holds, or one typed against an issue that has not been
 * filed yet. The second has nobody recorded as having added it and no reading
 * of GitHub's shape - the server decides both, and has not been asked - so
 * those are the parts allowed to be missing. An `IssueLink` is one of these
 * with nothing missing, which is why it needs no converting.
 */
interface DrawnLink {
  id: string;
  url: string;
  title: string | null;
  github: string | null;
  addedBy: string | null;
  addedAt: string | null;
  mine: boolean;
}

interface LinksProps {
  links: DrawnLink[];
  onRemove: (id: string) => void;
}

/**
 * The addresses hung on an issue, oldest first.
 *
 * Each shown by the first of three things that is there: what somebody called
 * it, what GitHub would call it, and failing both the address itself. The
 * server decides the middle one, so the same link reads the same wherever it
 * appears rather than each page having its own opinion.
 *
 * A new tab, unlike the links inside the interface: this one leaves for
 * somewhere else entirely, and taking the issue with it would lose whatever was
 * half-typed in the comment box.
 */
function Links({ links, onRemove }: LinksProps) {
  return (
    <div className={styles.attachments}>
      {links.map((link) => {
        const name = link.title ?? link.github ?? link.url;
        return (
          <span key={link.id} className={styles.attachment}>
            <a
              className={styles.attachmentName}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              /*
               * The address in full on hover, because the label is often a
               * short name for it and a link nobody can check before clicking
               * is a link nobody should click.
               */
              title={link.url}
            >
              {name}
            </a>
            <span className={styles.attachmentMeta}>
              {link.addedAt === null ? (
                /* Nothing has been added yet, so the line says what will
                   happen instead of pretending a record exists. */
                'Added when the issue is filed'
              ) : (
                <>
                  {/*
                    The GitHub reading beside a name somebody chose, rather than
                    instead of it: both are worth knowing, and they are only
                    repeated when nobody named the link.
                  */}
                  {link.github !== null && link.title !== null && `${link.github} · `}
                  {link.addedBy} · {timeAgo(link.addedAt)}
                </>
              )}
            </span>
            {link.mine && (
              <button
                type="button"
                className={styles.attachmentRemove}
                onClick={() => onRemove(link.id)}
                aria-label={`Remove ${name}`}
                title={t('Remove')}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface HistoryProps {
  /** Null while it is being fetched, which is only ever the first moment. */
  history: IssueHistory | null;
  error: string | null;
  /** Takes the reader to a comment in full, on the tab that has the thread. */
  onShowComment: (commentId: string) => void;
}

/**
 * What happened to this issue, oldest first.
 *
 * Oldest first because it is read as a story: it opened, then this, then that.
 * Every line names somebody, including the ones nothing used to record - a
 * label going on, an issue changing hands - and the line where recording began
 * is drawn as plainly as the rest, because an issue older than the record has
 * to say so rather than show a quiet week it never had.
 */
function History({ history, error, onShowComment }: HistoryProps) {
  if (error !== null) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }
  if (history === null) return <Loader />;
  if (history.entries.length === 0) return <p className={styles.nothing}>{t('Nothing recorded here.')}</p>;

  return (
    <section className={styles.history}>
      {/*
        A list that simply stopped would be a list implying the issue was quiet
        before it, which is the one thing a history must never say.
      */}
      {history.earlier > 0 && (
        <p className={styles.historyEarlier}>
          {history.earlier} earlier {history.earlier === 1 ? 'entry is' : 'entries are'} not shown.
        </p>
      )}

      {history.entries.map((event) =>
        event.kind === 'RECORDING' ? (
          /*
            Not a line about somebody doing something, so it is not drawn as
            one. Everything above it is what survived from before there was a
            record: when the issue was opened, and what was said on it.
          */
          <p key={event.id} className={styles.historyRecording}>
            Changes have been recorded from here on. What happened before{' '}
            <time dateTime={event.at} title={new Date(event.at).toLocaleString()}>
              {timeAgo(event.at)}
            </time>{' '}
            was not written down.
          </p>
        ) : (
          <article key={event.id} className={styles.historyRow}>
            <span className={styles.avatar} aria-hidden="true">
              {initialsOf(event.actor)}
            </span>
            <div className={styles.historyBody}>
              <p className={styles.historyText}>
                {said(event)}{' '}
                <time
                  className={styles.historyWhen}
                  dateTime={event.at}
                  /* The exact moment on hover: "3 days ago" is the right thing
                     to read and the wrong thing to work from. */
                  title={new Date(event.at).toLocaleString()}
                >
                  {timeAgo(event.at)}
                </time>
                {event.edited && <span className={styles.edited}>{t('· edited')}</span>}
              </p>
              {event.said !== null && (
                <button
                  type="button"
                  className={styles.historySaid}
                  onClick={() => event.commentId !== null && onShowComment(event.commentId)}
                  title={t('Read it in full')}
                >
                  {event.said}
                </button>
              )}
            </div>
          </article>
        ),
      )}
    </section>
  );
}

/**
 * One entry as a sentence.
 *
 * Written out per kind rather than assembled from the columns, because "took
 * this away from Bob" and "handed it from Bob to Carol" are the same two
 * columns and different sentences - and a history nobody can read at a glance
 * is a history nobody reads.
 */
function said(event: IssueEvent) {
  const who = <strong>{event.actor}</strong>;
  switch (event.kind) {
    case 'OPENED':
      return <>{who} opened this issue</>;
    case 'STATUS':
      return (
        <>
          {who} changed the status from {statusName(event.was)} to {statusName(event.became)}
        </>
      );
    case 'TYPE':
      /*
       * Three sentences from two columns, like the assignee above: typed,
       * retyped and untyped are different things to have happened, and the
       * word each side holds is what the type was called at the time.
       */
      if (event.was === null) {
        return (
          <>
            {who} filed this as a <span className={styles.historyChip}>{event.became}</span>
          </>
        );
      }
      if (event.became === null) {
        return (
          <>
            {who} took the type <span className={styles.historyChip}>{event.was}</span> off
          </>
        );
      }
      return (
        <>
          {who} changed the type from <span className={styles.historyChip}>{event.was}</span> to{' '}
          <span className={styles.historyChip}>{event.became}</span>
        </>
      );
    case 'LABEL':
      return event.became !== null ? (
        <>
          {who} added the label <span className={styles.historyChip}>{event.became}</span>
        </>
      ) : (
        <>
          {who} removed the label <span className={styles.historyChip}>{event.was}</span>
        </>
      );
    case 'ASSIGNEE':
      if (event.was === null) return <>{who} assigned this to <strong>{event.became}</strong></>;
      if (event.became === null) return <>{who} took this away from <strong>{event.was}</strong></>;
      return (
        <>
          {who} handed this from <strong>{event.was}</strong> to <strong>{event.became}</strong>
        </>
      );
    case 'OBSERVER':
      return event.became !== null ? (
        <>
          {who} added <strong>{event.became}</strong> as an observer
        </>
      ) : (
        <>
          {who} took <strong>{event.was}</strong> off the observers
        </>
      );
    case 'LINK':
      /*
       * Read as what this issue became rather than as what somebody did to a
       * table: "recorded that this is blocked by #4" is the sentence, and it
       * is written on both issues, each in its own words.
       */
      return event.became !== null ? (
        <>
          {who} recorded that this <span className={styles.historyChip}>{readRelation(event.became)}</span>
        </>
      ) : (
        <>
          {who} took off: this <span className={styles.historyChip}>{readRelation(event.was)}</span>
        </>
      );
    case 'TASK_STARTED':
      /*
       * Who pressed it and which agent went to work, in one sentence.
       *
       * The status line beside this says an issue moved to in progress and
       * reads identically to a person picking the work up themselves, so
       * without this the thread's next entries are comments by an agent that
       * nothing on the page ever announced.
       */
      return (
        <>
          {who} set <strong>{event.became}</strong> {t('to work on this')}
        </>
      );
    case 'COMMENT_REMOVED':
      /*
       * Whose it was, and never a word of it - the entry carries no text to
       * draw, on purpose. A thread that quietly lost a message is the thing
       * this line exists to stop, so it reads as plainly as the rest.
       */
      return event.was === event.actor ? (
        <>
          {who} {t('removed a comment they wrote')}
        </>
      ) : (
        <>
          {who} {t('removed a comment by')} <strong>{event.was}</strong>
        </>
      );
    default:
      return <>{who} commented</>;
  }
}

/** A status in the words the rest of the page uses, or as it arrived. */
function statusName(status: string | null) {
  if (status === null) return 'nothing';
  const known = ISSUE_STATUS_LABEL[status as IssueStatus];
  return <em>{known ?? status}</em>;
}
