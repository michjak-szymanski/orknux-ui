import { useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
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
import { ImageZoom } from './ImageZoom';
import type { Picture } from './ImageZoom';
import { rehypeIssueLinks } from './issueLinks';
import { rehypeMarkMatches } from './searchMatches';
import { t } from '../i18n';

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
   * Where `#12` in the prose points, when it points anywhere.
   *
   * A tracker's own shorthand only works if it is a link: people write "see
   * #12" because that is how it is said out loud, and then it is a number
   * somebody has to copy into a URL by hand. Given a workspace, those become
   * links; given none - the chat, the manual - they stay as written, because
   * `#1` in an answer about HTTP status codes is not an issue.
   */
  issuesIn?: string;
  /**
   * A term to mark wherever it appears in the prose. Left out everywhere nothing
   * is being searched for, which is every use of this but the documentation.
   */
  highlight?: string;
  /**
   * Whether a picture in the prose opens larger when it is clicked.
   *
   * On for the manual, where a screenshot of a 1440-wide application is drawn
   * into a column half that width and the labels it was taken to show cannot be
   * read (issue #217). On for a task's outcome too, and for the same reason
   * rather than for a new one: since #283 a task can draw, and what it drew is
   * the thing that was asked for, arriving in a card narrower than the picture.
   *
   * Off elsewhere by default. A chat's own drawing does not need it — the
   * answer bubble is the width of the conversation and the composer is right
   * there to ask for another — and an issue's attachments are looked at through
   * the viewer the attachment list opens, which can step between them.
   */
  zoomImages?: boolean;
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
/** The plugin list, exactly as the renderer that takes it declares it. */
type RehypePlugins = ComponentProps<typeof ReactMarkdown>['rehypePlugins'];

export function Markdown({ children, highlight, issuesIn, zoomImages = false }: MarkdownProps) {
  /** Which picture is open over the page, or null while none is. */
  const [zoomed, setZoomed] = useState<Picture | null>(null);
  /*
   * The pictures whose bytes did not come back.
   *
   * A chat can now hold a picture it drew, and that picture is an attachment
   * like any other: deleted, or on an installation whose attachment directory
   * has been moved out from under it, the link answers 404 and the browser draws
   * its broken-image icon - which says this page is broken rather than that the
   * file is gone. One line saying so is the truth, and it belongs here rather
   * than in the chat, because a manual page whose screenshot is missing has
   * exactly the same problem.
   */
  const [missing, setMissing] = useState<string[]>([]);

  /*
   * Rebuilt only when the term changes. A fresh array on every render would have
   * react-markdown reparse the document on every keystroke, which for a manual
   * page is the whole document.
   */
  const rehypePlugins = useMemo<RehypePlugins>(
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
      [rehypeHighlight, { detect: false, languages: LANGUAGES }],
      ...(highlight?.trim() ? [rehypeMarkMatches(highlight)] : []),
      ...(issuesIn === undefined ? [] : [rehypeIssueLinks(issuesIn)]),
    ],
    [highlight, issuesIn],
  );

  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={rehypePlugins}
        components={{
          /*
           * Anything the model links to is somewhere else entirely, so it opens
           * there and cannot reach back into this page.
           *
           * A link into this application is the exception, and there is only
           * one kind: the `#12` an issue's own prose mentions. That one behaves
           * like every other link in the interface - a plain click goes there,
           * and a ctrl-click still opens a tab, because it is a real anchor.
           */
          a: ({ children: text, ...props }) => {
            const here = typeof props.href === 'string' && props.href.startsWith('/');
            return here ? (
              <a {...props}>{text}</a>
            ) : (
              <a {...props} target="_blank" rel="noreferrer noopener">
                {text}
              </a>
            );
          },
          /*
           * A picture in the prose is content, not furniture.
           *
           * `data-keeps-colour` whether or not it can be zoomed: the light
           * theme darkens every `<img>` to 42% brightness, because every one of
           * them is a stroked icon file that would otherwise be invisible on
           * white — and the forty-six screenshots of the manual were being put
           * through that too, which is why the light theme's manual was
           * illustrated with photographs taken at dusk. The rule already has an
           * opt-out for anything carrying colour of its own, and a screenshot
           * is exactly that.
           *
           * Where zooming is on it is a button, not an `onClick` on the image:
           * this is a control, so it belongs in the tab order and answers the
           * space bar like every other one.
           */
          img: ({ node: _node, ...props }) => {
            const picture = { src: String(props.src ?? ''), alt: String(props.alt ?? '') };
            if (missing.includes(picture.src)) {
              return <span className={styles.gone}>{t('This picture is gone.')}</span>;
            }

            const image = (
              <img
                {...props}
                data-keeps-colour=""
                onError={() =>
                  setMissing((known) => (known.includes(picture.src) ? known : [...known, picture.src]))
                }
              />
            );
            if (!zoomImages || picture.src === '') return image;

            return (
              <button
                type="button"
                className={styles.zoom}
                onClick={() => setZoomed(picture)}
                aria-label={picture.alt === '' ? t('Open this picture') : `Open larger: ${picture.alt}`}
                title={t('Click to open this picture larger')}
              >
                {image}
              </button>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>

      {zoomImages && <ImageZoom picture={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}
