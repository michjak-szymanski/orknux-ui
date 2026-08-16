import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import bash from 'highlight.js/lib/languages/bash';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import styles from './Markdown.module.css';
import { rehypeMarkMatches } from './searchMatches';

/**
 * The languages worth carrying, named one by one.
 *
 * The plugin's default is highlight.js's "common" set — some thirty grammars,
 * most of which nothing here will ever write. These are what the manual uses
 * and what a model answering about this project writes back: the shells and
 * config formats of the documentation, and the languages the product itself is
 * made of.
 *
 * `xml` is what highlight.js calls HTML too.
 */
const LANGUAGES = { bash, java, javascript, json, kotlin, python, sql, typescript, xml, yaml };

export interface MarkdownProps {
  /** What the model wrote, in the markdown it wrote it in. */
  children: string;
  /**
   * A term to mark wherever it appears in the prose. Left out everywhere nothing
   * is being searched for, which is every use of this but the documentation.
   */
  highlight?: string;
}

/**
 * An answer, rendered as the markdown it is.
 *
 * Models write markdown whether or not anything renders it, so showing the
 * source means showing `**like this**` and a wall of backticks around every
 * code block. GFM is on for the tables and fenced code that answers actually
 * use.
 *
 * `remark-breaks` because this is a chat, not a document. Markdown proper joins
 * lines separated by a single newline, so a model asked to count to ten answers
 * on ten lines and reads as one — which is what the plain `white-space:
 * pre-wrap` this replaced got right. A newline the model wrote is a newline it
 * meant.
 *
 * Raw HTML stays off — `react-markdown` ignores it unless `rehype-raw` is
 * added, and it is not. Model output is untrusted text: it arrives from a
 * provider, and a prompt can ask for anything at all, so it renders as markup
 * only for the constructs markdown itself defines.
 */
export function Markdown({ children, highlight }: MarkdownProps) {
  /*
   * Rebuilt only when the term changes. A fresh array on every render would have
   * react-markdown reparse the document on every keystroke, which for a manual
   * page is the whole document.
   */
  const rehypePlugins = useMemo(
    () => [
      /*
       * Colouring a fenced block, but only one that says what it is.
       *
       * `detect: false` matters more here than it looks. Half the blocks in the
       * manual are not code at all — they are what a command printed, tables of
       * variables and doctor's verdicts — and left to guess, highlight.js finds
       * keywords in prose and paints words in the middle of a sentence. A block
       * that names its language gets coloured; a block that does not is left
       * exactly as it was written, which is what output wants.
       */
      [rehypeHighlight, { detect: false, languages: LANGUAGES }] as const,
      ...(highlight?.trim() ? [rehypeMarkMatches(highlight)] : []),
    ],
    [highlight],
  );

  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={rehypePlugins}
        components={{
          // Anything the model links to is somewhere else entirely, so it opens
          // there and cannot reach back into this page.
          a: ({ children: text, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {text}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
