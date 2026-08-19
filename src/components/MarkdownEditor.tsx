import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

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

/** The gap between the line being written and the list of names under it. */
const MENTION_GAP = 4;

/**
 * The properties a copy of a textarea has to wear to break its text in the
 * same places the real one does. Anything that moves a character sideways or
 * changes where a line ends belongs here.
 */
const LAID_OUT = [
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  'text-transform',
  'tab-size',
];

/**
 * Where a character sits inside a textarea, in pixels from its top left corner,
 * along with the height of the line it is on.
 *
 * A textarea will not say where its caret is, so the text is laid out a second
 * time in a hidden div wearing the same font, width and padding, and the
 * position of a marker dropped at the same index is read off that. The div is
 * built and thrown away on the spot rather than kept between calls, because it
 * has to agree with the box as it stands now - a box somebody has dragged
 * taller, or a font that has finished loading, would leave a kept one measuring
 * something that is no longer true.
 */
function caretPoint(box: HTMLTextAreaElement, index: number) {
  const worn = window.getComputedStyle(box);
  const mirror = document.createElement('div');
  for (const name of LAID_OUT) mirror.style.setProperty(name, worn.getPropertyValue(name));
  /*
   * Content-box on purpose: the width read off the real box is its content
   * width, so adding the padding back on top of it is what reproduces the
   * same wrapping rather than squeezing the text into a narrower column.
   */
  mirror.style.setProperty('box-sizing', 'content-box');
  mirror.style.setProperty('position', 'absolute');
  mirror.style.setProperty('top', '0');
  mirror.style.setProperty('left', '0');
  mirror.style.setProperty('visibility', 'hidden');
  mirror.style.setProperty('white-space', 'pre-wrap');
  mirror.style.setProperty('overflow-wrap', 'break-word');

  mirror.textContent = box.value.slice(0, index);
  const marker = document.createElement('span');
  // One real character rather than nothing, so the marker has the height of a
  // line and the width of a place where text could stand.
  marker.textContent = '.';
  mirror.appendChild(marker);
  // The rest of the writing after it, because a word that wraps decides which
  // line the caret is on, and a marker with nothing after it would never wrap.
  mirror.appendChild(document.createTextNode(box.value.slice(index)));

  document.body.appendChild(mirror);
  const at = { top: marker.offsetTop, left: marker.offsetLeft, line: marker.offsetHeight };
  mirror.remove();
  return at;
}

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
  const list = useRef<HTMLDivElement>(null);
  /** Where the @ that opened the list is, or null when nothing is being mentioned. */
  const [mentioning, setMentioning] = useState<{ at: number; search: string } | null>(null);
  const [candidates, setCandidates] = useState<Assignee[]>([]);
  /** Where the list is drawn, in the editor's own coordinates. */
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  /** Which row the arrows are on, the way the assignee box holds it. */
  const [at, setAt] = useState(0);
  /*
   * The rows need names a screen reader can be pointed at, and there are three
   * of these editors on an issue, so the identity comes from the instance
   * rather than from a constant two of them would share.
   */
  const rowId = useId();

  useEffect(() => {
    if (mentioning === null) {
      // Back to the top the moment the list is put away, so the next @ does
      // not open on the row somebody left behind on the last word.
      setAt(0);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      fetchAssignees(workspaceId, mentioning.search || undefined)
        .then((found) => {
          if (!current) return;
          setCandidates(found.slice(0, 8));
          // Back to the top whenever the list changes under the cursor:
          // keeping an index into a list that no longer has that row is how a
          // search ends up mentioning somebody nobody looked at.
          setAt(0);
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

  /*
   * The list put where the @ was typed rather than under the whole box.
   *
   * A ten-row description offered its names two hundred pixels below the word
   * they belonged to, and the comment box - being near the foot of the page -
   * offered them off the bottom of the window entirely. Measured in a layout
   * effect rather than worked out while typing, because the decision to open
   * upwards instead needs the height the list actually came out at, and doing
   * it before the browser paints means nobody sees the first guess.
   */
  useLayoutEffect(() => {
    const box = area.current;
    const panel = list.current;
    if (box === null || panel === null || mentioning === null) return;

    const at = caretPoint(box, mentioning.at);
    const caretTop = at.top - box.scrollTop;
    const under = box.offsetTop + caretTop + at.line + MENTION_GAP;
    const over = box.offsetTop + caretTop - panel.offsetHeight - MENTION_GAP;

    // Upwards only when there is no room below and there is room above, so a
    // list near the foot of the page stays on screen and one near the top does
    // not swap a cut-off bottom for a cut-off top.
    const onScreen = box.getBoundingClientRect().top + caretTop;
    const below = window.innerHeight - (onScreen + at.line);
    const flip = below < panel.offsetHeight + MENTION_GAP && onScreen > panel.offsetHeight + MENTION_GAP;

    // Held inside the box it belongs to, so a mention typed at the end of a
    // long line does not hang the list off the right-hand edge.
    const room = box.offsetLeft + box.offsetWidth - panel.offsetWidth;
    const left = Math.max(box.offsetLeft, Math.min(box.offsetLeft + at.left - box.scrollLeft, room));

    setSpot({ top: flip ? over : under, left });
  }, [mentioning, candidates]);

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

  /** Whether there is a list to steer: an @ open with names under it. */
  const open = mentioning !== null && candidates.length > 0;

  /**
   * Up and down move, Enter or Tab takes what is under the cursor, Escape puts
   * the list away without taking anything.
   *
   * Every one of them is prevented while the list is open and left alone when
   * it is not, so the arrows move the list rather than the caret and Enter
   * writes a mention rather than a newline, and the same keys go back to being
   * ordinary writing keys the moment the list is gone. The ends wrap, the way
   * the assignee box wraps: a list of eight is short enough that carrying on
   * past the bottom means the top rather than a dead key.
   */
  function onKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAt((held) => (held + 1 > candidates.length - 1 ? 0 : held + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAt((held) => (held - 1 < 0 ? candidates.length - 1 : held - 1));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const chosen = candidates[at];
      if (chosen === undefined) return;
      event.preventDefault();
      mention(chosen);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Held here rather than let go: an Escape meant for the list should not
      // also reach whatever else on the page listens for one.
      event.stopPropagation();
      setMentioning(null);
    }
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
        // The focus stays in the writing while the arrows walk the list, so
        // the row under the cursor is named here rather than focused there.
        aria-expanded={open}
        aria-controls={open ? `${rowId}-list` : undefined}
        aria-activedescendant={open ? `${rowId}-${at}` : undefined}
        onChange={(event) => onType(event.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        onBlur={() => window.setTimeout(() => setMentioning(null), 150)}
      />

      {open && (
        <div
          ref={list}
          id={`${rowId}-list`}
          className={styles.mentions}
          role="listbox"
          aria-label="Mention someone"
          style={spot === null ? undefined : { top: spot.top, left: spot.left }}
        >
          {candidates.map((candidate, index) => (
            <button
              key={`${candidate.kind}-${candidate.id}`}
              id={`${rowId}-${index}`}
              type="button"
              className={index === at ? `${styles.mentionOption} ${styles.mentionOptionAt}` : styles.mentionOption}
              role="option"
              aria-selected={index === at}
              // Kept in view as the arrows move past the bottom of the list.
              ref={(node) => {
                if (index === at) node?.scrollIntoView({ block: 'nearest' });
              }}
              // Under the pointer as well as under the arrows: a hand and a
              // keyboard should not disagree about which row is next.
              onMouseEnter={() => setAt(index)}
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
