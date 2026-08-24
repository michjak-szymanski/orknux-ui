/**
 * What a message reads as, for something that is about to say it out loud.
 *
 * Models write markdown whether or not anything renders it, and a speech model
 * reads exactly what it is handed. So the answer on screen and the answer in
 * the room were two different documents: the screen showed a heading and the
 * room heard "hash hash Summary", the screen showed a word in bold and the room
 * heard "asterisk asterisk", a link was read as its text *and* its URL, and a
 * table was read as a row of vertical bars. `Markdown` renders the source; this
 * reads it, and the two are meant to be the same document said two ways.
 *
 * Written by hand rather than by walking remark's tree. The renderer's parser
 * is react-markdown's, reached through dependencies this file does not declare,
 * and borrowing it would tie what is spoken to the shape of somebody else's
 * transitive package. This only has to be right about the constructs a model
 * actually writes, and being wrong here costs a clause read oddly rather than a
 * wrong word.
 *
 * **A fenced code block is announced rather than read.** Three choices and none
 * of them is free: read it, and a listener gets minutes of "open brace, const,
 * equals, quote" that nobody can follow and nobody asked for; drop it, and the
 * answer goes on to say "the function above" about something the listener was
 * never told existed; announce it, and they know a block of code is on the
 * screen beside them. The third is the only one that leaves somebody able to
 * act. Inline code is read as its own text, because it is nearly always a name
 * being talked about - "the `id` field" is an ordinary sentence, and reading
 * the backticks is the whole of what this exists to stop.
 */

/** What a fenced block is read as, in place of the code in it. */
export const CODE_BLOCK_SAID = 'Code block.';

/** Opens or closes a fence: three or more backticks or tildes, barely indented. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** `## Heading`, with the optional closing hashes some writers add. */
const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/** The line drawn under a heading written the other way. */
const UNDERLINE = /^ {0,3}(=+|-{3,})\s*$/;

/** A rule across the page: drawn, never said. */
const RULE = /^ {0,3}(\*\s*){3,}$|^ {0,3}(-\s*){3,}$|^ {0,3}(_\s*){3,}$/;

/** One level of quoting, stripped one at a time so nested quotes come off too. */
const QUOTE = /^ {0,3}>\s?/;

/** A bullet or a number, which the eye reads off the shape of the list. */
const BULLET = /^\s*([-*+]|\d+[.)])\s+/;

/** The box in front of a task-list item. */
const BOX = /^\[[ xX]\]\s+/;

/** Where a reference link's address is kept, which is nowhere on screen. */
const ADDRESS = /^ {0,3}\[[^\]]+\]:\s+\S+/;

/** A row of a table: pipes, and cells between them. */
const ROW = /^ {0,3}\|/;

/** The dashes under a table's head, which are the table being drawn. */
const HEAD_RULE = /^[\s:|-]+$/;

/** The handful of entities a model writes on purpose. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * A sentence, ended.
 *
 * A heading is not written with a full stop and is read as one all the same, so
 * one is put back: without it a heading runs into the paragraph under it and
 * both are said in a single breath, which is precisely the seam a heading
 * exists to draw.
 */
function ended(text: string): string {
  const said = text.trim();
  if (said === '') return said;
  return /[.!?:;,…]$/.test(said) ? said : `${said}.`;
}

/** Everything a line can say that is markup rather than words. */
function prose(text: string): string {
  return (
    text
      // A picture is read as its description, which is what it is there for.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // A link is read as its text. The address is not on screen and is not
      // language: "https colon slash slash" is a minute of nobody's time.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      // A bare address in angle brackets renders as itself, so it is read as
      // itself - the brackets are the markup and go.
      .replace(/<((?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^>\s]+)>/gi, '$1')
      // Raw HTML is not rendered at all, so there is nothing of it to say.
      .replace(/<\/?[a-z][^>\n]*>/gi, '')
      .replace(/(\*\*\*|___)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
      .replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
      .replace(/(\*|_)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
      .replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, '$1')
      // What is left of a pair whose other half has not arrived yet, or was
      // never written. A single one is left alone on purpose: an underscore is
      // half the identifiers a model writes and an asterisk is multiplication.
      .replace(/\*\*|__/g, '')
      // A character the writer escaped is the character itself.
      .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
      .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (found) => ENTITIES[found] ?? found)
  );
}

/**
 * One line, with the markup taken out of it.
 *
 * Code spans are lifted out whole before anything else runs, because what is
 * inside one is not markup: the emphasis rules would eat the underscores out of
 * `some_name` and the link rule would eat a bracket out of an array index.
 */
function inline(text: string): string {
  return text
    .split(/(`+[^`]*`+)/g)
    .map((part, at) => (at % 2 === 1 ? part.replace(/^`+|`+$/g, '') : prose(part)))
    .join('');
}

/** A table row, said as its cells rather than as its pipes. */
function cells(line: string): string {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => inline(cell).trim())
    .filter((cell) => cell !== '')
    .join(', ');
}

/**
 * The markdown a model wrote, as the words it renders to.
 *
 * Line by line, because every construct that changes how a line is read - a
 * fence, a heading, a quote, a bullet, a table row - is decided at the start of
 * one. An unterminated fence contributes nothing at all: while an answer is
 * still arriving that is a code block halfway through being written, and it is
 * announced when it closes rather than half-announced now.
 */
export function spokenText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const said: string[] = [];
  /** The fence that opened the block being passed over, or null outside one. */
  let inside: string | null = null;

  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (inside !== null) {
      // Closed by a run of the same character at least as long as the opener.
      if (fence !== null && fence[1][0] === inside[0] && fence[1].length >= inside.length) {
        inside = null;
        said.push(CODE_BLOCK_SAID);
      }
      continue;
    }
    if (fence !== null) {
      inside = fence[1];
      continue;
    }

    if (ADDRESS.test(line)) continue;

    const heading = HEADING.exec(line);
    if (heading !== null) {
      said.push(ended(inline(heading[1])));
      continue;
    }

    if (UNDERLINE.test(line)) {
      // The same line means two things and the line above it decides which: a
      // heading is being underlined, or a rule is being drawn across nothing.
      const above = said[said.length - 1] ?? '';
      if (above.trim() !== '') said[said.length - 1] = ended(above);
      continue;
    }
    if (RULE.test(line)) {
      said.push('');
      continue;
    }

    let text = line;
    while (QUOTE.test(text)) text = text.replace(QUOTE, '');

    if (ROW.test(text)) {
      if (HEAD_RULE.test(text)) continue;
      said.push(cells(text));
      continue;
    }

    said.push(inline(text.replace(BULLET, '').replace(BOX, '')));
  }

  return said
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
