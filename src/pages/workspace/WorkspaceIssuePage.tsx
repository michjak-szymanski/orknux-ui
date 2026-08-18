import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { formatSize, isShowable } from '../../api/attachments';
import {
  ISSUE_STATUS_LABEL,
  attachToIssue,
  commentOnIssue,
  createIssue,
  deleteIssue,
  editIssueComment,
  fetchIssue,
  fetchIssueLabels,
  issueAttachmentUrl,
  removeIssueAttachment,
  updateIssue,
  uploadIssueAttachments,
} from '../../api/issues';
import type { Assignee, Issue, IssueAttachment, IssueStatus } from '../../api/issues';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import { initialsOf } from '../../api/users';
import { AppShell } from '../../components/AppShell';
import { AssigneePicker } from '../../components/AssigneePicker';
import { AttachmentViewer } from '../../components/AttachmentViewer';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { TrashIcon } from '../../components/TrashIcon';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { useInstallation } from '../../session/installation';
import { shellUser } from '../../session/user';
import styles from './WorkspaceIssuePage.module.css';

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
 * One issue, in the shape everybody already knows.
 *
 * Title across the top with what can be done to it; the description on the
 * left, its details on the right; the conversation underneath. The same page
 * writes a new one - no id in the path means it does not exist yet - so the
 * form somebody files an issue in is the page they will read it on, rather
 * than a thinner thing they have to leave to finish.
 */
export function WorkspaceIssuePage({ session, onSignOut }: WorkspaceIssuePageProps) {
  /*
   * The address carries the number, not the row id.
   *
   * "#4" is what this page shows and what somebody types in a message, so
   * `/issues/4` has to be that issue. Mutations still take the id, which is
   * why the loaded issue is what they are given.
   */
  const { workspaceId = '', number = '' } = useParams();
  const navigate = useNavigate();
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
  const [status, setStatus] = useState<IssueStatus>('OPEN');
  const [comment, setComment] = useState('');
  /** Whether the description is being written rather than read. */
  const [writing, setWriting] = useState(false);
  /** The comment being changed, and what it is being changed to. */
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const issueFilesRef = useRef<HTMLInputElement>(null);
  const commentFilesRef = useRef<HTMLInputElement>(null);

  // A new issue is written from the first keystroke, not read.
  useEffect(() => {
    if (creating) setWriting(true);
  }, [creating]);

  useEffect(() => {
    if (creating) return;
    let current = true;
    fetchIssue(workspaceId, Number(number))
      .then((found) => {
        if (!current) return;
        if (found === null) {
          setLoadError('That issue no longer exists.');
          return;
        }
        setIssue(found);
        // An issue that says nothing opens ready to be written in; one that
        // says something opens as what it says.
        setWriting((found.description ?? '') === '');
        setTitle(found.title);
        setDescription(found.description ?? '');
        setLabels(found.labels);
        setAssignee(found.assignee);
        setStatus(found.status);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : 'Could not load the issue.');
      });
    return () => {
      current = false;
    };
  }, [creating, workspaceId, number]);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchIssueLabels(workspaceId)
      .then(setKnown)
      .catch(() => setKnown([]));
  }, [workspaceId]);

  async function save() {
    if (saving || title.trim() === '') return;
    setSaving(true);
    setError(null);
    try {
      const details = {
        title: title.trim(),
        description,
        labels,
        status,
        assigneeKind: assignee?.kind ?? null,
        assigneeId: assignee?.id ?? null,
      };
      if (creating) {
        const made = await createIssue({ workspaceId, ...details });
        // The files went up before there was an issue to put them on; this is
        // the moment there is one.
        if (pending.length > 0) {
          await attachToIssue(made.id, pending.map((file) => file.id));
          setPending([]);
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
        } else {
          navigate(`/workspace/${workspaceId}/issues/${made.number}`, { replace: true });
        }
      } else if (issue !== null) {
        setIssue(await updateIssue(issue.id, details));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the issue.');
    } finally {
      setSaving(false);
    }
  }

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
      setError(cause instanceof Error ? cause.message : 'Could not change the status.');
    } finally {
      setSaving(false);
    }
  }

  /** The one-click move, for the places that offer it. */
  async function toggleStatus() {
    await setIssueStatus(nextStatus(status));
  }

  /** Saving a change to a comment; only the author is offered this. */
  async function saveComment() {
    if (editing === null || saving) return;
    setSaving(true);
    try {
      setIssue(await editIssueComment(editing.id, editing.content));
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the comment.');
    } finally {
      setSaving(false);
    }
  }

  async function comment_() {
    const said = comment.trim();
    if (said === '' || creating || saving || issue === null) return;
    setSaving(true);
    try {
      setIssue(await commentOnIssue(issue.id, said, commentFiles.map((file) => file.id)));
      setComment('');
      setCommentFiles([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the comment.');
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
    if (files === null || files.length === 0 || workspaceId === '') return;

    setUploading(true);
    setError(null);
    try {
      const held = await uploadIssueAttachments(workspaceId, Array.from(files));
      if (going === 'comment') {
        setCommentFiles((current) => [...current, ...held]);
      } else if (!creating && issue !== null) {
        setIssue(await attachToIssue(issue.id, held.map((file) => file.id)));
      } else {
        setPending((current) => [...current, ...held]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Those files could not be uploaded.');
    } finally {
      setUploading(false);
      // Cleared so the same file can be picked twice in a row.
      const picker = going === 'comment' ? commentFilesRef.current : issueFilesRef.current;
      if (picker !== null) picker.value = '';
    }
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
      setError(cause instanceof Error ? cause.message : 'Could not remove the attachment.');
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
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="issues" />}
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
              <BackLink to={`/workspace/${workspaceId}/issues`} label="Issues" />
              {!creating && <span className={styles.number}>#{issue?.number}</span>}
              <input
                className={styles.titleInput}
                type="text"
                value={title}
                placeholder="What is wrong?"
                aria-label="Title"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className={styles.actions}>
              {!creating && (
                <button
                  type="button"
                  className={styles.delete}
                  aria-label="Delete this issue"
                  title="Delete"
                  onClick={() => {
                    if (issue === null) return;
                    void deleteIssue(issue.id).then(() => navigate(`/workspace/${workspaceId}/issues`));
                  }}
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
                  File another
                </label>
              )}
              <button
                type="button"
                className={styles.save}
                onClick={() => void save()}
                disabled={saving || title.trim() === ''}
              >
                {saving ? 'Saving…' : creating ? 'File Issue' : 'Save'}
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
            once the page has moved on.
          */}
          {creating && filed !== null && error === null && (
            <p className={styles.filed} role="status">
              Filed{' '}
              <Link to={`/workspace/${workspaceId}/issues/${filed}`} className={styles.filedLink}>
                #{filed}
              </Link>
              . The next one is ready.
            </p>
          )}

          <div className={styles.split}>
            <div className={styles.main}>
              <span className={styles.labelRow}>
                <span className={styles.label}>Description</span>
                {!creating && (
                  <button type="button" className={styles.textButton} onClick={() => setWriting(!writing)}>
                    {writing ? 'Preview' : 'Edit'}
                  </button>
                )}
              </span>
              {writing ? (
                <MarkdownEditor
                  value={description}
                  onChange={setDescription}
                  workspaceId={workspaceId}
                  rows={10}
                  ariaLabel="Description"
                  placeholder="What happens, and what should happen instead."
                />
              ) : (
                /* What was written, as it reads. Clicking it writes again,
                   because the thing somebody wants after reading their own
                   description is usually to change it. */
                <div
                  className={styles.rendered}
                  role="button"
                  tabIndex={0}
                  onDoubleClick={() => setWriting(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setWriting(true);
                  }}
                >
                  {description.trim() === '' ? (
                    <p className={styles.nothing}>Nothing written yet.</p>
                  ) : (
                    <Markdown>{description}</Markdown>
                  )}
                </div>
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
                    <span className={styles.label}>Attachments</span>
                    {attachmentsAllowed && (
                      <button
                        type="button"
                        className={styles.textButton}
                        disabled={uploading}
                        onClick={() => issueFilesRef.current?.click()}
                      >
                        {uploading ? 'Uploading…' : 'Attach files'}
                      </button>
                    )}
                  </span>
                  {issueFiles.length === 0 ? (
                    <p className={styles.nothing}>
                      Nothing attached yet. A screenshot is worth a paragraph of description.
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

              {!creating && (
                <section className={styles.comments}>
                  <h2 className={styles.commentsTitle}>Comments</h2>
                  {issue?.comments.length === 0 && <p className={styles.nothing}>Nothing said yet.</p>}

                  {issue?.comments.map((said) => (
                    <article key={said.id} className={styles.comment}>
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
                              onClick={() => setEditing({ id: said.id, content: said.content })}
                            >
                              Edit
                            </button>
                          )}
                        </p>

                        {editing?.id === said.id ? (
                          <div className={styles.commentEditor}>
                            <MarkdownEditor
                              value={editing.content}
                              onChange={(next) => setEditing({ id: said.id, content: next })}
                              workspaceId={workspaceId}
                              rows={4}
                              ariaLabel="Edit this comment"
                            />
                            <div className={styles.composerActions}>
                              <button type="button" className={styles.ghost} onClick={() => setEditing(null)}>
                                Cancel
                              </button>
                              <button
                                type="button"
                                className={styles.save}
                                onClick={() => void saveComment()}
                                disabled={saving || editing.content.trim() === ''}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.commentText}>
                            <Markdown>{said.content}</Markdown>
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
                    <MarkdownEditor
                      value={comment}
                      onChange={setComment}
                      workspaceId={workspaceId}
                      rows={3}
                      ariaLabel="Add a comment"
                      placeholder="Say something…"
                    />
                    <div className={styles.composerActions}>
                      {attachmentsAllowed && (
                        <button
                          type="button"
                          className={styles.textButton}
                          disabled={uploading}
                          onClick={() => commentFilesRef.current?.click()}
                        >
                          {uploading ? 'Uploading…' : 'Attach files'}
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
                        {status === 'CLOSED' ? 'Reopen issue' : 'Close issue'}
                      </button>
                      <button
                        type="button"
                        className={styles.save}
                        onClick={() => void comment_()}
                        disabled={saving || comment.trim() === ''}
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>

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
                      ? 'A new issue opens when it is filed'
                      : `Press for ${ISSUE_STATUS_LABEL[nextStatus(status)].toLowerCase()}`
                  }
                >
                  {ISSUE_STATUS_LABEL[status]}
                </button>
              </div>

              <AssigneePicker workspaceId={workspaceId} chosen={assignee} onChoose={setAssignee} />

              <div className={styles.sideField}>
                <span className={styles.label}>Labels</span>
                <div className={styles.labels}>
                  {labels.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className={styles.label_}
                      title="Remove this label"
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
                  placeholder="Add a label…"
                  aria-label="Add a label"
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
    </AppShell>
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
              title="Remove"
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
