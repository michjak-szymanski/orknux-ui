/**
 * Colours markdown for the skill editor.
 *
 * The same approach `highlightJs` takes, for the same reason: the project ships
 * no editor component, and what is wanted is a handful of colours over a
 * textarea. A skill is markdown with frontmatter, so the things worth marking
 * are the frontmatter block, headings, fenced code, emphasis, links, list
 * bullets and inline code. Anything unrecognised stays plain, which is the
 * right failure for a highlighter.
 *
 * Order matters. Frontmatter is matched first because it is only frontmatter at
 * the very top of the file; fences before everything else, so `# not a heading`
 * inside a code block stays code.
 *
 * The output is HTML, so everything that is not a tag this builds is escaped.
 */
const TOKEN = new RegExp(
  [
    // Frontmatter, and only at the start: --- ... --- before anything else.
    String.raw`^(---\n[\s\S]*?\n---)(?=\n|$)`,
    // A fenced block, from ``` to the matching ``` or the end of the file.
    String.raw`(^|\n)(\x60\x60\x60[^\n]*\n[\s\S]*?(?:\n\x60\x60\x60|$))`,
    // ATX headings: up to six hashes at the start of a line.
    String.raw`(^|\n)(#{1,6} [^\n]*)`,
    // A quote, and a bullet or number opening a list item.
    String.raw`(^|\n)(>[^\n]*)`,
    String.raw`(^|\n)([ \t]*(?:[-*+]|\d+\.)[ \t])`,
    // Inline code, before emphasis, so `**` inside it is not bold.
    String.raw`(\x60[^\x60\n]+\x60)`,
    // [text](target)
    String.raw`(\[[^\]\n]*\]\([^)\n]*\))`,
    // Bold before italic: ** would otherwise match as two singles.
    String.raw`(\*\*[^\n*]+\*\*|__[^\n_]+__)`,
    String.raw`(\*[^\n*]+\*|_[^\n_]+_)`,
  ].join('|'),
  'gm',
);

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (character) => ESCAPES[character] ?? character);
}

function span(className: string, text: string): string {
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

export interface MarkdownClasses {
  frontmatter: string;
  heading: string;
  code: string;
  quote: string;
  bullet: string;
  link: string;
  bold: string;
  italic: string;
}

/**
 * @param classes the CSS-module class names to colour with, so the palette
 *   stays in the stylesheet where the rest of the page's colours are.
 */
export function highlightMarkdown(source: string, classes: MarkdownClasses): string {
  let html = '';
  let last = 0;

  for (const match of source.matchAll(TOKEN)) {
    const [
      text,
      frontmatter,
      fenceLead,
      fence,
      headingLead,
      heading,
      quoteLead,
      quote,
      bulletLead,
      bullet,
      inline,
      link,
      bold,
      italic,
    ] = match;
    const at = match.index;

    html += escapeHtml(source.slice(last, at));
    // The newline these patterns match to anchor to a line start is not part of
    // what is being coloured, so it is written back out plain.
    if (frontmatter !== undefined) html += span(classes.frontmatter, text);
    else if (fence !== undefined) html += escapeHtml(fenceLead) + span(classes.code, fence);
    else if (heading !== undefined) html += escapeHtml(headingLead) + span(classes.heading, heading);
    else if (quote !== undefined) html += escapeHtml(quoteLead) + span(classes.quote, quote);
    else if (bullet !== undefined) html += escapeHtml(bulletLead) + span(classes.bullet, bullet);
    else if (inline !== undefined) html += span(classes.code, text);
    else if (link !== undefined) html += span(classes.link, text);
    else if (bold !== undefined) html += span(classes.bold, text);
    else if (italic !== undefined) html += span(classes.italic, text);
    last = at + text.length;
  }

  html += escapeHtml(source.slice(last));
  // A trailing newline would otherwise collapse, leaving the last line of the
  // underlay a row short of the textarea.
  return `${html}\n`;
}
