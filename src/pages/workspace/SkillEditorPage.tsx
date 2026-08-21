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
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
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
          ? { ok: true, message: 'Formatting valid' }
          : {
              ok: false,
              message:
                checked.line === null
                  ? (checked.message ?? 'Not well formed')
                  : `Line ${checked.line}: ${checked.message ?? 'not well formed'}`,
            },
      );
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not validate.' });
    }
  }

  async function handleSave() {
    if (skill === null || saving) return;
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
      setStatus({ ok: true, message: 'Formatting valid' });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the skill.');
    } finally {
      setSaving(false);
    }
  }

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

              <footer className={styles.editorFooter}>
                <span className={styles.statusLeft}>
                  <span
                    className={`${styles.indicator} ${status === null ? styles.indicatorIdle : status.ok ? styles.indicatorOk : styles.indicatorBad}`}
                    aria-hidden="true"
                  />
                  {status?.message ?? 'Not checked yet.'}
                </span>
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
    </AppShell>
  );
}
