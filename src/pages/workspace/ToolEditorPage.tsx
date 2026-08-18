import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import { deleteTool, fetchTool, setToolEnabled, timeAgo, updateTool, validateToolSource } from '../../api/tools';
import type { Tool } from '../../api/tools';
import codeIcon from '../../assets/code.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { CodeEditor } from '../../components/CodeEditor';
import type { CodeEditorHandle } from '../../components/CodeEditor';
import { compile } from '../../components/monaco';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './EditorPage.module.css';

export interface ToolEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * One tool: the code on the left, what it is on the right.
 *
 * Written in TypeScript, like a function: what an agent may call is code
 * somebody has to read later, and types are how it says what it takes. The
 * sandbox runs JavaScript, so saving compiles and stores both — what runs, and
 * what was written.
 */
export function ToolEditorPage({ session, onSignOut }: ToolEditorPageProps) {
  const { workspaceId = '', toolId = '' } = useParams();
  const navigate = useNavigate();
  const editor = useRef<CodeEditorHandle>(null);

  const [tool, setTool] = useState<Tool | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [status, setStatus] = useState<{ ok: boolean; message: string }>({ ok: true, message: 'No errors' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (toolId === '') return;
    fetchTool(toolId)
      .then((found) => {
        if (found === null) {
          setLoadError('That tool does not exist, or you do not have access to it.');
          return;
        }
        apply(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the tool.');
      });
  }, [toolId]);

  function apply(found: Tool) {
    setTool(found);
    setName(found.name);
    setDescription(found.description ?? '');
    setSource(found.typescript ?? found.source);
  }

  async function handleValidate() {
    try {
      const emitted = await compile(source);
      if (!emitted.ok) {
        setStatus({
          ok: false,
          message: emitted.line === null ? emitted.reason : `Line ${emitted.line}: ${emitted.reason}`,
        });
        return;
      }

      // The compiled JavaScript, because that is what the sandbox is handed.
      const checked = await validateToolSource(workspaceId, emitted.javascript);
      setStatus(
        checked.valid
          ? { ok: true, message: 'No errors' }
          : {
              ok: false,
              message:
                checked.line === null
                  ? (checked.message ?? 'Could not be parsed')
                  : `Line ${checked.line}: ${checked.message ?? 'could not be parsed'}`,
            },
      );
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not validate.' });
    }
  }

  async function handleSave() {
    if (tool === null || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const emitted = await compile(source);
      if (!emitted.ok) {
        setStatus({
          ok: false,
          message: emitted.line === null ? emitted.reason : `Line ${emitted.line}: ${emitted.reason}`,
        });
        return;
      }

      apply(
        await updateTool(tool.id, {
          name: name.trim(),
          description: description.trim(),
          source: emitted.javascript,
          typescript: source,
        }),
      );
      setSaved(true);
      setStatus({ ok: true, message: 'No errors' });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the tool.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (tool === null) return;
    try {
      apply(await setToolEnabled(tool.id, !tool.enabled));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not change the tool.');
    }
  }

  async function handleDelete() {
    if (tool === null || removing) return;
    setRemoving(true);
    try {
      await deleteTool(tool.id);
      navigate(`/workspace/${workspaceId}/tools`);
    } catch (cause) {
      setRemoving(false);
      setSaveError(cause instanceof Error ? cause.message : 'Could not delete the tool.');
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="tools" />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/tools`} label="Tools" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/tools`}>
            Tools
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{tool?.name ?? '…'}</span>
        </p>
        <div className={styles.headerRow}>
          <div className={styles.titleGroup}>
            <h1 className={styles.pageTitle}>{tool?.name ?? 'Tool'}</h1>
            {tool !== null && (
              <button
                type="button"
                className={tool.enabled ? styles.activeBadge : styles.inactiveBadge}
                onClick={() => void handleToggle()}
                title={tool.enabled ? 'Disable this tool' : 'Enable this tool'}
              >
                {tool.enabled ? 'Active' : 'Inactive'}
              </button>
            )}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void handleValidate()}>
              Validate
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleSave()}
              disabled={saving || tool === null}
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
      ) : (
        <>
          {saveError !== null && (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
          {saved && saveError === null && <p className={styles.saved}>Saved.</p>}

          <div className={styles.split}>
            <section className={styles.editorCard}>
              <header className={styles.editorHeader}>
                <span className={styles.editorTitle}>
                  <img src={codeIcon} alt="" width={16} height={16} />
                  Editor
                </span>
                <span className={styles.formatBadge}>TypeScript</span>
              </header>

              <div className={styles.codeArea}>
                <CodeEditor
                  ref={editor}
                  value={source}
                  language="typescript"
                  ariaLabel="Tool source"
                  onChange={(next) => {
                    setSource(next);
                    setSaved(false);
                  }}
                  onCaretChange={(line, column) => setCaret({ line, column })}
                />
              </div>

              <footer className={styles.editorFooter}>
                <span className={styles.statusLeft}>
                  <span
                    className={`${styles.indicator} ${status.ok ? styles.indicatorOk : styles.indicatorBad}`}
                    aria-hidden="true"
                  />
                  {status.message}
                </span>
                <span className={styles.caret}>
                  Ln {caret.line}, Col {caret.column}
                </span>
              </footer>
            </section>

            <aside className={styles.panel}>
              <div className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Tool Details</h2>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="tool-name">
                    Name
                  </label>
                  <input
                    id="tool-name"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="tool-description">
                    Description
                  </label>
                  <textarea
                    id="tool-description"
                    className={styles.textarea}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setSaved(false);
                    }}
                    placeholder="What an agent reads to decide whether to call this."
                  />
                </div>
              </div>

              {tool !== null && (
                <div className={styles.metadata}>
                  <span className={styles.metadataLabel}>Last modified</span>
                  <span className={styles.metadataValue}>
                    {timeAgo(tool.lastModifiedAt)} by <span className={styles.metadataWho}>{tool.lastModifiedBy}</span>
                  </span>
                </div>
              )}

              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => void handleDelete()}
                disabled={removing || tool === null}
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
