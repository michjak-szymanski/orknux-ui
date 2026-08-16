/**
 * Where a search term sits inside a piece of text.
 *
 * One matcher for both places a hit is shown — the snippet beside the result and
 * the prose on the page — so the two cannot disagree about what matched. The
 * docs search itself selects pages with a lowercased `includes`, and this splits
 * on the same terms: plain substring, case-insensitive, every occurrence.
 *
 * Deliberately not a regular expression. The needle is whatever somebody typed
 * into the box, and `c++`, `$ref` or an unclosed `(` would either throw when
 * compiled or quietly match something else.
 */

export interface Segment {
  text: string;
  /** True for the parts that matched, which are the ones drawn as a mark. */
  match: boolean;
}

/**
 * Splits `text` around every occurrence of `needle`.
 *
 * An empty needle, or one that does not appear, yields the whole string as a
 * single unmatched segment — so a caller can render the result without first
 * asking whether anything matched.
 */
export function segments(text: string, needle: string): Segment[] {
  const wanted = needle.trim().toLowerCase();
  if (wanted === '') return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const found: Segment[] = [];
  let at = 0;

  for (;;) {
    const next = haystack.indexOf(wanted, at);
    if (next === -1) break;
    if (next > at) found.push({ text: text.slice(at, next), match: false });
    found.push({ text: text.slice(next, next + wanted.length), match: true });
    at = next + wanted.length;
  }

  if (found.length === 0) return [{ text, match: false }];
  if (at < text.length) found.push({ text: text.slice(at), match: false });
  return found;
}

/*
 * The tree the plugin below walks. Only the three shapes it actually touches are
 * described, rather than depending on the hast type package: react-markdown
 * carries those types transitively, and a transitive dependency is not one this
 * project has declared.
 */

interface TextNode {
  type: 'text';
  value: string;
}

interface ElementNode {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

interface ParentNode {
  type: string;
  children?: HastNode[];
}

type HastNode = TextNode | ElementNode | ParentNode;

function isText(node: HastNode): node is TextNode {
  return node.type === 'text' && typeof (node as TextNode).value === 'string';
}

function marked(text: string): ElementNode {
  return {
    type: 'element',
    tagName: 'mark',
    /*
     * Attributed so the page can be walked match by match. A class would do for
     * styling, but CSS modules hash the ones this project writes, and the marks
     * are built here rather than in a component — an attribute is the same in
     * both places and is what the docs search queries for.
     */
    properties: { 'data-search-match': '' },
    children: [{ type: 'text', value: text }],
  };
}

/**
 * Wraps every occurrence of `needle` in a `<mark>`, everywhere in the document.
 *
 * A rehype plugin rather than a pass over the markdown source, because the
 * source is markdown: inserting tags into it would put them inside link targets
 * and fence info strings, and searching for `-` or `#` would rewrite the
 * structure of the page. By the time this runs the structure is already decided
 * and only text nodes are left to touch.
 *
 * This does not reopen the raw-HTML path the Markdown component deliberately
 * leaves closed. The marks are built as nodes in the tree that has already been
 * parsed; nothing here parses HTML, so untrusted prose still cannot introduce
 * markup of its own.
 */
export function rehypeMarkMatches(needle: string) {
  const wanted = needle.trim().toLowerCase();

  return function plugin() {
    return function transform(tree: unknown) {
      if (wanted === '') return;
      visit(tree as ParentNode, wanted);
    };
  };
}

function visit(node: ParentNode, needle: string): void {
  if (!Array.isArray(node.children)) return;

  const rebuilt: HastNode[] = [];

  for (const child of node.children) {
    if (isText(child)) {
      const parts = segments(child.value, needle);
      // Left alone when nothing matched, so the common case adds no nodes.
      if (!parts.some((part) => part.match)) {
        rebuilt.push(child);
        continue;
      }
      for (const part of parts) {
        rebuilt.push(part.match ? marked(part.text) : { type: 'text', value: part.text });
      }
      continue;
    }

    visit(child as ParentNode, needle);
    rebuilt.push(child);
  }

  node.children = rebuilt;
}
