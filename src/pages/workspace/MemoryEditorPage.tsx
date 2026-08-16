import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  createMemory,
  deleteMemory,
  fetchMemory,
  fetchMemoryCatalogs,
  moveMemory,
  updateMemory,
} from '../../api/memory';
import type { Memory, MemoryCatalog } from '../../api/memory';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import codeIcon from '../../assets/code.svg';
import linkIcon from '../../assets/link.svg';
import listOrderedIcon from '../../assets/list-ordered.svg';
import listIcon from '../../assets/list.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './MemoryEditorPage.module.css';

export interface MemoryEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * What each toolbar button does to the selection.
 *
 * `wrap` puts the marks either side of what is selected; `line` puts a prefix on
 * the front of each selected line, which is what a list is.
 */
type Mark =
  | { kind: 'wrap'; before: string; after: string; placeholder: string }
  | { kind: 'line'; prefix: (index: number) => string };

const MARKS: { key: string; label?: string; icon?: string; title: string; mark: Mark }[] = [
  { key: 'bold', label: 'B', title: 'Bold', mark: { kind: 'wrap', before: '**', after: '**', placeholder: 'bold' } },
  { key: 'italic', label: 'I', title: 'Italic', mark: { kind: 'wrap', before: '_', after: '_', placeholder: 'italic' } },
  { key: 'code', icon: codeIcon, title: 'Code', mark: { kind: 'wrap', before: '`', after: '`', placeholder: 'code' } },
  {
    key: 'link',
    icon: linkIcon,
    title: 'Link',
    mark: { kind: 'wrap', before: '[', after: '](https://)', placeholder: 'text' },
  },
  { key: 'list', icon: listIcon, title: 'Bulleted list', mark: { kind: 'line', prefix: () => '- ' } },
  {
    key: 'list-ordered',
    icon: listOrderedIcon,
    title: 'Numbered list',
    mark: { kind: 'line', prefix: (index) => `${index + 1}. ` },
  },
];

/**
 * Writing a memory, and editing one afterwards — the same page either way.
 *
 * A page rather than a dialog because a memory is written, not filled in: it is
 * the thing an agent will be handed, and it deserves the room the content
 * editors get. The toolbar inserts markdown around the selection rather than
 * hiding it, so what is stored is what was typed.
 */
export function MemoryEditorPage({ session, onSignOut }: MemoryEditorPageProps) {
  const { workspaceId = '', memoryId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const adding = memoryId === undefined;

  const contentRef = useRef<HTMLTextAreaElement>(null);

  const [memory, setMemory] = useState<Memory | null>(null);
  const [catalogs, setCatalogs] = useState<MemoryCatalog[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [catalogId, setCatalogId] = useState(params.get('catalog') ?? '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMemoryCatalogs(workspaceId)
      .then((found) => {
        setCatalogs(found);
        // A memory has to live somewhere, so a new one opens in the catalog it
        // was started from, or the first that exists.
        setCatalogId((present) => (present !== '' ? present : found[0]?.id ?? ''));
      })
      .catch(() => setCatalogs([]));
  }, [workspaceId]);

  useEffect(() => {
    if (memoryId === undefined) return;
    fetchMemory(memoryId)
      .then((found) => {
        if (found === null) {
          setError('That memory does not exist, or you do not have access to it.');
          return;
        }
        setMemory(found);
        setTitle(found.title);
        setContent(found.content);
        setCatalogId(found.catalogId);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load the memory.');
      });
  }, [memoryId]);

  /** Applies a mark to what is selected, and leaves the caret somewhere useful. */
  function apply(mark: Mark) {
    const field = contentRef.current;
    if (field === null) return;

    const from = field.selectionStart;
    const to = field.selectionEnd;
    const selected = content.slice(from, to);

    let replacement: string;
    let caret: number;

    if (mark.kind === 'wrap') {
      const inner = selected === '' ? mark.placeholder : selected;
      replacement = `${mark.before}${inner}${mark.after}`;
      // With nothing selected the placeholder is selected instead, so typing
      // replaces it.
      caret = from + mark.before.length;
    } else {
      // A list marks every line it covers, and an empty selection is one line.
      const lines = (selected === '' ? '' : selected).split('\n');
      replacement = lines.map((line, index) => `${mark.prefix(index)}${line}`).join('\n');
      caret = from + replacement.length;
    }

    const next = content.slice(0, from) + replacement + content.slice(to);
    setContent(next);
    setSaved(false);

    // The value lands on the next render, so the caret is moved after it.
    window.requestAnimationFrame(() => {
      field.focus();
      if (mark.kind === 'wrap' && selected === '') {
        field.setSelectionRange(caret, caret + mark.placeholder.length);
      } else {
        field.setSelectionRange(caret, caret);
      }
    });
  }

  async function handleSave() {
    if (title.trim() === '' || content.trim() === '' || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (adding) {
        const created = await createMemory(catalogId, title.trim(), content.trim());
        navigate(`/workspace/${workspaceId}/memory/${created.id}`, { replace: true });
      } else if (memory !== null && catalogId !== memory.catalogId) {
        // Changing the catalog is a move, which the server records as one.
        setMemory(await moveMemory(memory.id, title.trim(), content.trim(), catalogId));
      } else if (memory !== null) {
        setMemory(await updateMemory(memory.id, title.trim(), content.trim()));
      }
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the memory.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (memory === null) return;
    if (!window.confirm(`Delete "${memory.title}"?`)) return;
    try {
      await deleteMemory(memory.id);
      navigate(`/workspace/${workspaceId}/memory`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the memory.');
    }
  }

  const catalogName = catalogs.find((one) => one.id === catalogId)?.name ?? '';
  const complete = title.trim() !== '' && content.trim() !== '' && catalogId !== '';

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="memory" />}
    >
      <header className={styles.breadcrumbBar}>
        <BackLink to={`/workspace/${workspaceId}/memory`} label="Memory" />
        <p className={styles.breadcrumbs}>
          <span className={styles.crumb}>{catalogName}</span>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{adding ? 'New memory' : (memory?.title ?? '…')}</span>
        </p>
        <span className={styles.spacer} />
        {saved && <span className={styles.saved}>Saved.</span>}
        <button type="button" className={styles.save} onClick={() => void handleSave()} disabled={!complete || saving}>
          {saving ? 'Saving…' : adding ? 'Create Memory' : 'Save Changes'}
        </button>
      </header>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.split}>
        <section className={styles.editorCard}>
          <div className={styles.section}>
            <label className={styles.sectionLabel} htmlFor="memory-title">
              MEMORY TITLE
            </label>
            <input
              id="memory-title"
              className={styles.titleInput}
              type="text"
              placeholder="REST API Authentication Flow"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaved(false);
              }}
            />
          </div>

          <div className={styles.contentLabelRow}>
            <span className={styles.sectionLabel}>MEMORY CONTENT</span>
          </div>

          {/* Markdown, put in rather than hidden: what is stored is what was typed. */}
          <div className={styles.toolbar}>
            {MARKS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={styles.tool}
                onClick={() => apply(entry.mark)}
                title={entry.title}
                aria-label={entry.title}
              >
                {entry.label !== undefined ? (
                  <span className={entry.key === 'italic' ? styles.toolItalic : styles.toolLetter}>{entry.label}</span>
                ) : (
                  <img src={entry.icon} alt="" width={14} height={14} />
                )}
              </button>
            ))}
          </div>

          <textarea
            ref={contentRef}
            className={styles.content}
            value={content}
            spellCheck={false}
            aria-label="Memory content"
            placeholder="What should be remembered, and anything an agent would need to act on it."
            onChange={(event) => {
              setContent(event.target.value);
              setSaved(false);
            }}
          />
        </section>

        <aside className={styles.properties}>
          <div className={styles.propertySection}>
            <p className={styles.propertyHeading}>MEMORY DETAILS</p>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="memory-catalog">
                Catalog
              </label>
              <div className={styles.selectWrapper}>
                <select
                  id="memory-catalog"
                  className={styles.select}
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
                <img src={chevronDown12Icon} alt="" width={8} height={8} />
              </div>
            </div>

            {/* Who wrote it, which editing does not change. */}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Author</span>
              <span className={styles.fieldValue}>{adding ? session.username : (memory?.createdBy ?? '…')}</span>
            </div>
          </div>

          {memory !== null && (
            <div className={styles.field}>
              <span className={styles.metaLabel}>Last modified</span>
              <span className={styles.fieldValue}>{timeAgo(memory.lastModifiedAt)}</span>
            </div>
          )}

          {memory !== null && (
            <button type="button" className={styles.delete} onClick={() => void handleDelete()}>
              Delete
            </button>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
