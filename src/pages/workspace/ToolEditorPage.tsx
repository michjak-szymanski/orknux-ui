import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import { deleteTool, fetchTool, setToolEnabled, timeAgo, updateTool, validateToolSource } from '../../api/tools';
import type { Tool } from '../../api/tools';
import codeIcon from '../../assets/code.svg';
import wandIcon from '../../assets/wand.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { CodeDiff } from '../../components/CodeDiff';
import { CodeEditor } from '../../components/CodeEditor';
import type { CodeEditorHandle } from '../../components/CodeEditor';
import { Loader } from '../../components/Loader';
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
  /**
   * A change the assistant is offering for this tool, if one is open.
   *
   * Claimed off the quick chat: the panel announces a suggestion with a
   * cancelable event, and a page already showing the tool it is for takes it —
   * the diff belongs where the code is, not in a chat column three hundred
   * pixels wide. While one is held the code column shows the change against
   * what is on screen, and the two buttons above it are the only things that
   * touch anything.
   */
  const [offered, setOffered] = useState<{ note: string | null; code: string } | null>(null);
  /** Why the last accept did not land, shown in the bar it was pressed in. */
  const [offerFailed, setOfferFailed] = useState<string | null>(null);

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

  useEffect(() => {
    function onSuggested(event: Event) {
      const held = (event as CustomEvent<{ toolId: string; note: string | null; code: string }>).detail;
      if (held?.toolId !== toolId) return;
      // Claimed: the chat shows a pointer here instead of its own card.
      event.preventDefault();
      setOffered({ note: held.note, code: held.code });
      setOfferFailed(null);
    }
    window.addEventListener('orknux:tool-suggestion', onSuggested);
    return () => window.removeEventListener('orknux:tool-suggestion', onSuggested);
  }, [toolId]);

  /*
   * Somebody accepted a change to this tool in the panel beside it.
   *
   * The page is holding the version from before, and its next save would put
   * that back — so it reloads. Only for this tool: the panel can be used
   * anywhere, and another tool being changed is none of this page's business.
   */
  useEffect(() => {
    function onSaved(event: Event) {
      const held = (event as CustomEvent<{ id: string }>).detail;
      if (held?.id !== toolId) return;
      fetchTool(toolId)
        .then((found) => {
          if (found !== null) apply(found);
        })
        .catch(() => undefined);
    }
    window.addEventListener('orknux:tool-saved', onSaved);
    return () => window.removeEventListener('orknux:tool-saved', onSaved);
  }, [toolId]);

  /** What happened to the offer, said back into the conversation it came from. */
  function settleOffer(said: string) {
    setOffered(null);
    setOfferFailed(null);
    window.dispatchEvent(new CustomEvent('orknux:tool-suggestion-settled', { detail: { said } }));
  }

  /**
   * A failed accept keeps the diff on screen, with the reason above it.
   *
   * Closing it on failure took the change away in the same breath as the error,
   * so the next suggestion arrived into an empty column and Accept was pressed
   * on code nobody had re-read. The model is still told at once.
   */
  function failOffer(shown: string, said: string) {
    setOfferFailed(shown);
    window.dispatchEvent(new CustomEvent('orknux:tool-suggestion-settled', { detail: { said } }));
  }

  /**
   * Accepting compiles here, exactly as Save does, and for the same reason:
   * what runs is stored beside the TypeScript it came from, and this is the
   * only place with a compiler. A proposal that will not compile is refused
   * with the compiler's reason, and the assistant is told it — its next attempt
   * should be at the actual problem.
   */
  async function acceptOffer() {
    if (offered === null || tool === null || saving) return;
    setSaving(true);
    try {
      const emitted = await compile(offered.code);
      if (!emitted.ok) {
        const reason = emitted.line === null ? emitted.reason : `line ${emitted.line}: ${emitted.reason}`;
        failOffer(
          `This would not compile — ${reason}`,
          `I tried to accept it and it would not compile — ${reason}. It was not saved.`,
        );
        return;
      }

      apply(await updateTool(tool.id, { source: emitted.javascript, typescript: offered.code }));
      setSaved(true);
      setStatus({ ok: true, message: 'The suggested change is saved.' });
      settleOffer('I accepted the change and it is saved.');
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'It could not be saved.';
      failOffer(
        `The save was refused — ${reason}`,
        `I tried to accept it and it could not be saved — ${reason}. It was not saved.`,
      );
    } finally {
      setSaving(false);
    }
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
      title={tool?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
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
            {/*
              Help, offered where the work is. The wand opens the quick chat; on
              a conversation that has not started it also asks the first
              question, so one click goes from stuck to being helped — a
              conversation already under way is joined, not talked over.
            */}
            <button
              type="button"
              className={styles.wandButton}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('orknux:quick-chat', { detail: { opener: 'Can you help me with that?' } }),
                )
              }
              aria-label="Ask the assistant for help with this tool"
              title="Ask the assistant for help"
            >
              <img src={wandIcon} alt="" width={16} height={16} />
            </button>
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
      ) : tool === null ? (
        <Loader />
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

              {/*
                The change on offer, above the diff it describes. Accept and
                Reject live up here rather than in the chat: the person reading
                the diff is looking at this column, and the answer belongs where
                the question is.
              */}
              {offered !== null && (
                <div className={offerFailed === null ? styles.suggestionBar : styles.suggestionBarFailed}>
                  <span className={styles.suggestionNote}>
                    {offerFailed ??
                      (offered.note !== null && offered.note !== ''
                        ? offered.note
                        : 'The assistant suggests this change.')}
                  </span>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void acceptOffer()}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => settleOffer('I rejected the change. The tool is unchanged.')}
                    disabled={saving}
                  >
                    Reject
                  </button>
                </div>
              )}
              <div className={styles.codeArea}>
                {offered === null ? (
                  <CodeEditor
                    ref={editor}
                    value={source}
                    language="typescript"
                    ariaLabel="Tool source"
                    onChange={(next) => {
                      setSource(next);
                      setSaved(false);
                      // What was checked was the code as it was; this is not
                      // that code any more.
                      setStatus(null);
                    }}
                    onCaretChange={(line, column) => setCaret({ line, column })}
                  />
                ) : (
                  <CodeDiff original={source} modified={offered.code} ariaLabel="Suggested change" />
                )}
              </div>

              <footer className={styles.editorFooter}>
                <span className={styles.statusLeft}>
                  <span
                    className={`${styles.indicator} ${status === null ? styles.indicatorIdle : status.ok ? styles.indicatorOk : styles.indicatorBad}`}
                    aria-hidden="true"
                  />
                  {status?.message ?? 'Not checked yet.'}
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
