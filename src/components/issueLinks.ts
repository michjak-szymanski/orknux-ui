/**
 * `#12` in prose, turned into a link to issue 12.
 *
 * A tracker's own shorthand only works if it is a link. People write "see #12"
 * because that is how it is said out loud, and without this it is a number
 * somebody has to copy into an address by hand - which is the complaint this
 * exists to answer.
 *
 * Only where a workspace is named. The chat and the manual render the same
 * markdown, and `#1` in an answer about HTTP headers or a CSS colour is not an
 * issue; a renderer that guessed would turn ordinary prose into broken links.
 */

interface TextNode {
  type: 'text';
  value: string;
}

interface ElementNode {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

type HastNode = TextNode | ElementNode | { type: string; children?: HastNode[] };

interface ParentNode {
  children?: HastNode[];
  tagName?: string;
}

/*
 * A hash, a few digits, and a boundary either side.
 *
 * The leading boundary keeps `#12` out of things that merely contain one, since
 * a hash in the middle of a word is part of the word.
 *
 * Five digits at most, and nothing hexadecimal allowed to follow, because a
 * six-digit colour is written exactly like an issue number: the first version
 * of this turned `#123456` in a sentence about styling into a link to issue
 * 123456. `#123` remains genuinely ambiguous with a shorthand colour, and is
 * read as an issue - this renders the prose of an issue tracker, where it
 * almost always is one, and a colour that loses is still readable text.
 *
 * A tracker that passes 99999 issues loses the shorthand, which is a trade
 * worth making for not linking every colour anybody writes.
 */
const MENTIONED = /(^|[\s([{,;:!?])#(\d{1,5})(?=$|[\s)\]},.;:!?])/g;

export function rehypeIssueLinks(workspaceId: string) {
  return function plugin() {
    return function transform(tree: unknown) {
      visit(tree as ParentNode, workspaceId);
    };
  };
}

function visit(node: ParentNode, workspaceId: string): void {
  if (!Array.isArray(node.children)) return;

  const rebuilt: HastNode[] = [];

  for (const child of node.children) {
    /*
     * Never inside code or an existing link. A hash and a number in a code
     * block is code - a colour, a comment, an anchor - and linking inside an
     * anchor would nest one link in another, which is invalid and renders
     * unpredictably.
     */
    if (isElement(child) && (child.tagName === 'code' || child.tagName === 'pre' || child.tagName === 'a')) {
      rebuilt.push(child);
      continue;
    }

    if (isText(child)) {
      const parts = split(child.value, workspaceId);
      // Left exactly as it was when nothing matched, which is most prose.
      if (parts === null) {
        rebuilt.push(child);
        continue;
      }
      rebuilt.push(...parts);
      continue;
    }

    visit(child as ParentNode, workspaceId);
    rebuilt.push(child);
  }

  node.children = rebuilt;
}

/** @returns the pieces, or null when the text holds no issue number. */
function split(text: string, workspaceId: string): HastNode[] | null {
  MENTIONED.lastIndex = 0;
  if (!MENTIONED.test(text)) return null;
  MENTIONED.lastIndex = 0;

  const parts: HastNode[] = [];
  let at = 0;

  for (let hit = MENTIONED.exec(text); hit !== null; hit = MENTIONED.exec(text)) {
    const [whole, before, digits] = hit;
    const start = hit.index + before.length;
    if (start > at) parts.push({ type: 'text', value: text.slice(at, start) });
    parts.push({
      type: 'element',
      tagName: 'a',
      properties: { href: `/workspace/${workspaceId}/issues/${digits}`, className: ['issueLink'] },
      children: [{ type: 'text', value: `#${digits}` }],
    });
    at = hit.index + whole.length;
  }

  if (at < text.length) parts.push({ type: 'text', value: text.slice(at) });
  return parts;
}

function isText(node: HastNode): node is TextNode {
  return (node as TextNode).type === 'text' && typeof (node as TextNode).value === 'string';
}

function isElement(node: HastNode): node is ElementNode {
  return (node as ElementNode).type === 'element' && typeof (node as ElementNode).tagName === 'string';
}
