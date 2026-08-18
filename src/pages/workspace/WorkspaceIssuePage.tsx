import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  commentOnIssue,
  createIssue,
  deleteIssue,
  editIssueComment,
  fetchIssue,
  updateIssue,
} from '../../api/issues';
import type { Assignee, Issue, IssueStatus } from '../../api/issues';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import { initialsOf } from '../../api/users';
import { AppShell } from '../../components/AppShell';
import { AssigneePicker } from '../../components/AssigneePicker';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { TrashIcon } from '../../components/TrashIcon';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceIssuePage.module.css';

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
  const { workspaceId = '', issueId = '' } = useParams();
  const navigate = useNavigate();
  const creating = issueId === '';

  const [issue, setIssue] = useState<Issue | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
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

  // A new issue is written from the first keystroke, not read.
  useEffect(() => {
    if (creating) setWriting(true);
  }, [creating]);

  useEffect(() => {
    if (creating) return;
    let current = true;
    fetchIssue(issueId)
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
  }, [creating, issueId]);

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
        navigate(`/workspace/${workspaceId}/issues/${made.id}`, { replace: true });
      } else {
        setIssue(await updateIssue(issueId, details));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the issue.');
    } finally {
      setSaving(false);
    }
  }

  /** Open and closed are one click, not a field somebody has to find. */
  async function toggleStatus() {
    if (creating || saving) return;
    const wanted: IssueStatus = status === 'OPEN' ? 'CLOSED' : 'OPEN';
    setSaving(true);
    try {
      const held = await updateIssue(issueId, { status: wanted });
      setIssue(held);
      setStatus(held.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the status.');
    } finally {
      setSaving(false);
    }
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
    if (said === '' || creating || saving) return;
    setSaving(true);
    try {
      setIssue(await commentOnIssue(issueId, said));
      setComment('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the comment.');
    } finally {
      setSaving(false);
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
                    void deleteIssue(issueId).then(() => navigate(`/workspace/${workspaceId}/issues`));
                  }}
                >
                  <TrashIcon />
                </button>
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
                      </div>
                    </article>
                  ))}

                  <div className={styles.composer}>
                    <MarkdownEditor
                      value={comment}
                      onChange={setComment}
                      workspaceId={workspaceId}
                      rows={3}
                      ariaLabel="Add a comment"
                      placeholder="Say something…"
                    />
                    <div className={styles.composerActions}>
                      {/* Closing and commenting are the two things anybody does here. */}
                      <button type="button" className={styles.ghost} onClick={() => void toggleStatus()} disabled={saving}>
                        {status === 'OPEN' ? 'Close issue' : 'Reopen issue'}
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
                  className={status === 'OPEN' ? styles.statusOpen : styles.statusClosed}
                  onClick={() => void toggleStatus()}
                  disabled={creating || saving}
                  title={creating ? 'A new issue opens when it is filed' : 'Change the status'}
                >
                  {status === 'OPEN' ? 'Open' : 'Closed'}
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
    </AppShell>
  );
}
