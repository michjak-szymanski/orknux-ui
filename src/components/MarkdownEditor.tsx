import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';

import { fetchAssignees } from '../api/issues';
import type { Assignee } from '../api/issues';
import styles from './MarkdownEditor.module.css';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Where the mentions come from: the same people, agents and models. */
  workspaceId: string;
  placeholder?: string;
  ariaLabel: string;
  rows?: number;
  /**
   * What to do with a paste, where the page around this can do something with
   * one - an issue attaches the screenshot on the clipboard. Left out
   * everywhere else, and an ordinary text paste is untouched either way.
   */
  onPaste?: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
}

/** What the toolbar does, in the order a hand reaches for it. */
const MARKS: { label: string; title: string; before: string; after: string; block?: boolean }[] = [
  { label: 'B', title: 'Bold', before: '**', after: '**' },
  { label: 'I', title: 'Italic', before: '_', after: '_' },
  { label: '</>', title: 'Code', before: '`', after: '`' },
  { label: '{ }', title: 'Code block', before: '```\n', after: '\n```', block: true },
  { label: '"', title: 'Quote', before: '> ', after: '', block: true },
  { label: '•', title: 'List', before: '- ', after: '', block: true },
  { label: '🔗', title: 'Link', before: '[', after: '](https://)' },
];

/** How long typing after an @ waits before the names are asked for. */
const MENTION_PAUSE_MS = 200;

/**
 * Writing that ends up rendered: a textarea, a few marks, and mentions.
 *
 * Markdown rather than a rich editor, because what is written here is stored
 * as text and read in several places - a rich editor would have to agree with
 * the renderer about everything, and the moment it did not, somebody's
 * formatting would be silently different from what they saw. The toolbar only
 * writes the characters somebody could have typed.
 *
 * Typing `@` opens the same list the assignee box uses: people, agents and
 * models. A mention is stored as plain text - `@Support responder` - so the
 * comment is still readable anywhere that shows text, and nothing is broken by
 * a rename.
 */
export function MarkdownEditor({
  value,
  onChange,
  workspaceId,
  placeholder,
  ariaLabel,
  rows = 4,
  onPaste,
}: MarkdownEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  /** Where the @ that opened the list is, or null when nothing is being mentioned. */
  const [mentioning, setMentioning] = useState<{ at: number; search: string } | null>(null);
  const [candidates, setCandidates] = useState<Assignee[]>([]);

  useEffect(() => {
    if (mentioning === null) return;
    let current = true;
    const timer = window.setTimeout(() => {
      fetchAssignees(workspaceId, mentioning.search || undefined)
        .then((found) => {
          if (current) setCandidates(found.slice(0, 8));
        })
        .catch(() => {
          if (current) setCandidates([]);
        });
    }, MENTION_PAUSE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [mentioning, workspaceId]);

  /** Wraps what is selected, or opens the marks where the caret is. */
  function mark(before: string, after: string, block = false) {
    const box = area.current;
    if (box === null) return;
    const from = box.selectionStart;
    const to = box.selectionEnd;
    const chosen = value.slice(from, to);
    /*
     * A block mark starts on its own line. Written here rather than left to
     * the person, because "> " in the middle of a sentence is not a quote and
     * looks like a mistake nobody made.
     */
    const lead = block && from > 0 && value[from - 1] !== '\n' ? '\n' : '';
    const next = `${value.slice(0, from)}${lead}${before}${chosen}${after}${value.slice(to)}`;
    onChange(next);

    // The caret goes where the writing continues: inside empty marks, or after
    // what was just wrapped.
    const caret = from + lead.length + before.length + chosen.length;
    window.setTimeout(() => {
      box.focus();
      box.setSelectionRange(caret, caret);
    }, 0);
  }

  /** Watches for an @ and for the word being typed after it. */
  function onType(next: string) {
    onChange(next);
    const box = area.current;
    if (box === null) return;
    const caret = box.selectionStart;
    const before = next.slice(0, caret);
    // The @ has to start a word, or every email address opens a list.
    const found = /(^|\s)@([^\s@]*)$/.exec(before);
    setMentioning(found === null ? null : { at: caret - found[2].length - 1, search: found[2] });
  }

  function mention(chosen: Assignee) {
    if (mentioning === null) return;
    const box = area.current;
    const caret = box?.selectionStart ?? value.length;
    const next = `${value.slice(0, mentioning.at)}@${chosen.name} ${value.slice(caret)}`;
    onChange(next);
    setMentioning(null);
    const landed = mentioning.at + chosen.name.length + 2;
    window.setTimeout(() => {
      box?.focus();
      box?.setSelectionRange(landed, landed);
    }, 0);
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
        {MARKS.map((entry) => (
          <button
            key={entry.title}
            type="button"
            className={styles.mark}
            title={entry.title}
            aria-label={entry.title}
            onMouseDown={(event) => {
              // Kept from taking focus, so the selection it is about to wrap
              // is still there when it runs.
              event.preventDefault();
              mark(entry.before, entry.after, entry.block);
            }}
          >
            {entry.label}
          </button>
        ))}
        <span className={styles.hint}>Markdown · @ to mention</span>
      </div>

      <textarea
        ref={area}
        className={styles.area}
        value={value}
        rows={rows}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onType(event.target.value)}
        onPaste={onPaste}
        onBlur={() => window.setTimeout(() => setMentioning(null), 150)}
      />

      {mentioning !== null && candidates.length > 0 && (
        <div className={styles.mentions} role="listbox" aria-label="Mention someone">
          {candidates.map((candidate) => (
            <button
              key={`${candidate.kind}-${candidate.id}`}
              type="button"
              className={styles.mentionOption}
              onMouseDown={(event) => {
                event.preventDefault();
                mention(candidate);
              }}
            >
              <span className={styles.mentionName}>{candidate.name}</span>
              <span className={styles.mentionHint}>{candidate.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
