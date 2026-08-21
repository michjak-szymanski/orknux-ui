import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import {
  deleteSkill,
  fetchSkill,
  fetchSkillCatalogs,
  setSkillEnabled,
  updateSkill,
  validateSkillContent,
} from '../../api/skills';
import type { Skill, SkillCatalog } from '../../api/skills';
import { timeAgo } from '../../api/tools';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import fileTextIcon from '../../assets/file-text.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { RevisionHistory } from '../../components/RevisionHistory';
import { UnsavedWorkDialog } from '../../components/UnsavedWorkDialog';
import { ValidationStatus } from '../../components/ValidationStatus';
import type { Validation } from '../../components/ValidationStatus';
import { useLeaveGuard } from '../../components/leaveGuard';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import { highlightMarkdown } from './highlightMarkdown';
import styles from './EditorPage.module.css';

export interface SkillEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * One skill: the markdown on the left, what it is on the right.
 *
 * There is no gutter and no colouring here, unlike the tool editor — a skill is
 * prose, so it wraps, and there is nothing in it to parse. Validate checks the
 * frontmatter it opens with, which is the part an agent reads.
 */
export function SkillEditorPage({ session, onSignOut }: SkillEditorPageProps) {
  const { workspaceId = '', skillId = '' } = useParams();
  const navigate = useNavigate();

  const [skill, setSkill] = useState<Skill | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  /** Which folder it lives in; changing it moves the skill. */
  const [catalogId, setCatalogId] = useState('');
  const [catalogs, setCatalogs] = useState<SkillCatalog[]>([]);
  const [content, setContent] = useState('');
  const highlightRef = useRef<HTMLPreElement>(null);

  // The coloured copy under the textarea, which draws only its caret. The
  // palette lives in the stylesheet, beside every other colour on the page.
  const highlighted = useMemo(
    () =>
      highlightMarkdown(content, {
        frontmatter: styles.mdFrontmatter,
        heading: styles.mdHeading,
        code: styles.mdCode,
        quote: styles.mdQuote,
        bullet: styles.mdBullet,
        link: styles.mdLink,
        bold: styles.mdBold,
        italic: styles.mdItalic,
      }),
    [content],
  );
/*
   * Null until something has actually been checked.
   *
   * A green light that is simply the value the page opens with reports a check
   * nobody ran, and one that survives an edit describes a version of this that
   * no longer exists. Both are worse than showing nothing: an indicator is only
   * worth having if it can be wrong.
   */
  const [status, setStatus] = useState<Validation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (skillId === '') return;
    fetchSkill(skillId)
      .then((found) => {
        if (found === null) {
          setLoadError('That skill does not exist, or you do not have access to it.');
          return;
        }
        apply(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the skill.');
      });
  }, [skillId]);

  function apply(found: Skill) {
    setSkill(found);
    setName(found.name);
    setDescription(found.description ?? '');
    setContent(found.content);
    setCatalogId(found.catalogId);
  }

  useEffect(() => {
    if (workspaceId === '') return;
    fetchSkillCatalogs(workspaceId)
      .then(setCatalogs)
      .catch(() => setCatalogs([]));
  }, [workspaceId]);

  async function handleValidate() {
    try {
      const checked = await validateSkillContent(workspaceId, content);
      setStatus(
        checked.valid
          ? { ok: true, message: 'the frontmatter and the body are well formed' }
          : {
              ok: false,
              message:
                checked.line === null
                  ? (checked.message ?? 'Not well formed')
                  : `Line ${checked.line}: ${checked.message ?? 'not well formed'}`,
            },
      );
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not validate.', whole: true });
    }
  }

  /**
   * Stores what is on screen, and says whether it landed.
   *
   * The answer is for `Save & Leave` in the dialog below, the same as the other
   * three editors of this shape: a name the workspace already has, a catalog
   * that has been deleted underneath this tab - the server refuses those, and
   * leaving on a refused save is precisely the loss the guard exists to stop.
   *
   * `apply` is what makes the baseline move: what came back is what the server
   * now holds, so a save followed by a Back press asks nothing.
   */
  async function handleSave(): Promise<boolean> {
    if (skill === null || saving) return false;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      apply(
        await updateSkill(skill.id, {
          name: name.trim(),
          description: description.trim(),
          content,
          catalogId,
        }),
      );
      setSaved(true);
      setStatus({ ok: true, message: 'the frontmatter and the body are well formed' });
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the skill.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * There is work on this screen the server has not been told about.
   *
   * A value comparison against what was loaded, not the `saved` flag beside it:
   * that flag can only say a key was pressed, and somebody who types a
   * character and deletes it has changed nothing. Being asked to confirm losing
   * nothing is how a prompt teaches people to click through prompts.
   *
   * Four fields, because a save sends four. The markdown is the one this issue
   * was filed about and the one with the most to lose - a skill is prose, so
   * there is more of it on screen than in any of the three editors that were
   * guarded first - but the catalog is in here too: moving a skill to another
   * folder is a change the server has not heard about, and it is lost on the
   * way out exactly like the rest. Name and description are compared trimmed
   * because that is how they are sent; the markdown is not, because whitespace
   * in prose is the prose.
   *
   * `skill` is the baseline and it maintains itself: `apply` sets it on load and
   * again from what a save stored. The Active badge deliberately does not go
   * through `apply` - see `handleToggle` - so pressing it leaves the baseline's
   * four fields alone rather than adopting the draft as saved.
   *
   * A skill is always one that exists, there being no create route to this
   * page, so a null baseline means still loading and there is nothing to lose.
   */
  const unsaved = useMemo(() => {
    if (skill === null) return false;
    return (
      name.trim() !== skill.name.trim() ||
      description.trim() !== (skill.description ?? '').trim() ||
      content !== skill.content ||
      catalogId !== skill.catalogId
    );
  }, [skill, name, description, content, catalogId]);

  /*
   * The three ways out, and the question before any of them: a link, a Back
   * press, a closed tab. Shared with the function, tool and object editors,
   * because all four lose work the same way; see `useLeaveGuard`.
   */
  const guard = useLeaveGuard({
    unsaved,
    backTo: `/workspace/${workspaceId}/skills`,
    save: handleSave,
  });

  /**
   * Active/Inactive, pressed.
   *
   * The same badge over the same shape of draft as the tool editor's, and it had
   * the same hole (issue #155): the mutation answers with the whole skill, and
   * putting that through `apply` - the function that fills the form on load -
   * replaced the name, the description, the catalog and the markdown with the
   * stored copy. Type a paragraph, press the badge, and the paragraph was gone.
   *
   * So only what the press changed is taken. `lastModifiedAt` and
   * `lastModifiedBy` come across with it, because turning a skill off is a
   * change to the row and the panel below should not go on naming the time
   * before this one.
   */
  async function handleToggle() {
    if (skill === null) return;
    try {
      const { enabled, lastModifiedAt, lastModifiedBy } = await setSkillEnabled(skill.id, !skill.enabled);
      setSkill((current) => (current === null ? current : { ...current, enabled, lastModifiedAt, lastModifiedBy }));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not change the skill.');
    }
  }

  async function handleDelete() {
    if (skill === null || removing) return;
    setRemoving(true);
    try {
      await deleteSkill(skill.id);
      navigate(`/workspace/${workspaceId}/skills`);
    } catch (cause) {
      setRemoving(false);
      setSaveError(cause instanceof Error ? cause.message : 'Could not delete the skill.');
    }
  }

  return (
    <AppShell
      title={skill?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/skills`} label="Skills" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/skills`}>
            Skills
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{skill?.name ?? '…'}</span>
        </p>
        <div className={styles.headerRow}>
          <div className={styles.titleGroup}>
            <h1 className={styles.pageTitle}>{skill?.name ?? 'Skill'}</h1>
            {skill !== null && (
              <button
                type="button"
                className={skill.enabled ? styles.activeBadge : styles.inactiveBadge}
                onClick={() => void handleToggle()}
                title={skill.enabled ? 'Disable this skill' : 'Enable this skill'}
              >
                {skill.enabled ? 'Active' : 'Inactive'}
              </button>
            )}
          </div>
          <div className={styles.actions}>
            {/* Beside the button that caused it, where somebody is already looking. */}
            {saved && saveError === null && <span className={styles.savedInline}>Saved.</span>}
            {/*
              Beside the button it is about, not down in the footer where it
              used to sit - and in the button's own word. See `ValidationStatus`.
            */}
            <ValidationStatus
              subject="The definition"
              status={status}
              explains={
                <>
                  Validate reads this definition the way the runtime will: the frontmatter block at the top — the
                  fence, and the <code>name</code> and <code>description</code> in it — and the prose under it. It
                  answers whether this skill would load, and says which line stopped it if it would not.
                </>
              }
            />
            <button type="button" className={styles.secondaryButton} onClick={() => void handleValidate()}>
              Validate
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleSave()}
              disabled={saving || skill === null}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </header>

      {loadError !== null ? (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      ) : skill === null ? (
        <Loader />
      ) : (
        <>
          {saveError !== null && (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
          <div className={styles.split}>
            <section className={styles.editorCard}>
              <header className={styles.editorHeader}>
                <span className={styles.editorTitle}>
                  <img src={fileTextIcon} alt="" width={16} height={16} />
                  Skill Definition
                </span>
                <span className={styles.formatBadge}>Standard Format</span>
              </header>

              {/*
                The same stack the function editor uses: a coloured copy
                underneath, and a transparent textarea over it drawing only the
                caret and the selection.
              */}
              <div className={styles.proseStack}>
                <pre className={styles.proseHighlight} aria-hidden="true" ref={highlightRef}>
                  <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                </pre>
                <textarea
                  className={styles.prose}
                  value={content}
                  spellCheck={false}
                  aria-label="Skill definition"
                  onChange={(event) => {
                    setContent(event.target.value);
                    setSaved(false);
                    // What was checked was the text as it was; this is not that
                    // text any more.
                    setStatus(null);
                  }}
                  onScroll={(event) => {
                    // The coloured copy follows the text.
                    const { scrollTop, scrollLeft } = event.currentTarget;
                    if (highlightRef.current !== null) {
                      highlightRef.current.scrollTop = scrollTop;
                      highlightRef.current.scrollLeft = scrollLeft;
                    }
                  }}
                />
              </div>

              {/* What the column is written in, and nothing else; see the function editor. */}
              <footer className={`${styles.editorFooter} ${styles.editorFooterEnd}`}>
                <span className={styles.caret}>Markdown</span>
              </footer>
            </section>

            <aside className={styles.panel}>
              <div className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Skill Details</h2>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="skill-name">
                    Name
                  </label>
                  <input
                    id="skill-name"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="skill-catalog">
                    Catalog
                  </label>
                  <div className={styles.selectWrapper}>
                    <select
                      id="skill-catalog"
                      className={styles.input}
                      value={catalogId}
                      onChange={(event) => {
                        setCatalogId(event.target.value);
                        setSaved(false);
                      }}
                    >
                      {catalogs.map((catalog) => (
                        <option key={catalog.id} value={catalog.id}>
                          {catalog.name}
                        </option>
                      ))}
                    </select>
                    <img src={chevronDown12Icon} alt="" width={12} height={12} />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="skill-description">
                    Description
                  </label>
                  <textarea
                    id="skill-description"
                    className={styles.textarea}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setSaved(false);
                    }}
                    placeholder="What an agent reads to decide whether to follow this."
                  />
                </div>
              </div>

              {skill !== null && (
                <div className={styles.metadata}>
                  <span className={styles.metadataLabel}>Last modified</span>
                  <span className={styles.metadataValue}>
                    {timeAgo(skill.lastModifiedAt)} by{' '}
                    <span className={styles.metadataWho}>{skill.lastModifiedBy}</span>
                  </span>
                </div>
              )}

              {/*
                What this skill has been. A restore rewrites the row, so the
                page reads it again - the editor is holding the version from
                before, and its next save would put that back.
              */}
              <div className={styles.panelSection}>
                <RevisionHistory
                  kind="SKILL"
                  componentId={skillId}
                  currentName={skill?.name}
                  onRestored={() => {
                    void fetchSkill(skillId)
                      .then((found) => {
                        if (found !== null) apply(found);
                      })
                      .catch(() => undefined);
                  }}
                />
              </div>

              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => void handleDelete()}
                disabled={removing || skill === null}
              >
                {removing ? 'Deleting…' : 'Delete'}
              </button>
            </aside>
          </div>
        </>
      )}

      {/*
        Outside the branch above, so it is the same dialog whichever state the
        page is in - and so closing it never depends on what the page happens to
        be showing behind it.
      */}
      <UnsavedWorkDialog
        subject={guard.asking ? (skill?.name ?? 'This skill') : null}
        creating={false}
        onStay={guard.stay}
        onLeave={guard.leave}
        onSaveAndLeave={guard.saveAndLeave}
      />
    </AppShell>
  );
}
