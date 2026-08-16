/**
 * Colours JavaScript for the function editor.
 *
 * A tokenizer rather than a highlighting library: the project ships no editor
 * component, and what the design asks for is five colours — keywords, strings,
 * numbers, comments, and the names being called or read. Anything it does not
 * recognise stays plain, which is the right failure for a highlighter.
 *
 * The output is HTML, so everything that is not a tag this builds is escaped.
 */
const TOKEN = new RegExp(
  [
    // Comments, first, so a // inside one does not start a string.
    String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/)`,
    // Strings, including templates; escapes are consumed so a \" does not end one.
    String.raw`('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\`(?:\\.|[^\`\\])*\`)`,
    String.raw`\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b`,
    String.raw`\b(await|async|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|false|try|typeof|undefined|var|void|while|yield)\b`,
    // A name being called: `transform(` or `Date.now(`.
    String.raw`([A-Za-z_$][\w$]*)(?=\s*\()`,
    // A property being read: the `.body` in `input.body`.
    String.raw`\.([A-Za-z_$][\w$]*)`,
  ].join('|'),
  'g',
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

/**
 * @param classes the CSS-module class names to colour with, so the palette
 *   stays in the stylesheet where the rest of the page's colours are.
 */
export function highlightJs(
  source: string,
  classes: {
    comment: string;
    string: string;
    number: string;
    keyword: string;
    callee: string;
    property: string;
  },
): string {
  let html = '';
  let last = 0;

  for (const match of source.matchAll(TOKEN)) {
    const [text, comment, string, number, keyword, callee, property] = match;
    const at = match.index;

    html += escapeHtml(source.slice(last, at));
    if (comment !== undefined) html += span(classes.comment, text);
    else if (string !== undefined) html += span(classes.string, text);
    else if (number !== undefined) html += span(classes.number, text);
    else if (keyword !== undefined) html += span(classes.keyword, text);
    else if (callee !== undefined) html += span(classes.callee, text);
    // The dot stays plain; only the name after it is coloured.
    else if (property !== undefined) html += `.${span(classes.property, property)}`;
    last = at + text.length;
  }

  html += escapeHtml(source.slice(last));
  // A trailing newline would otherwise collapse, leaving the last line of the
  // underlay a row short of the textarea.
  return `${html}\n`;
}
