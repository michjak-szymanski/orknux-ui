import type { MessageTarget } from '../api/actions';

/**
 * Which of the two a Slack target is, as a mark rather than as a word.
 *
 * One list can hold channels and members together now: `slackSuggestions` asked
 * without a kind returns both, ordered against each other by how well they
 * match, and each row carries its own `target` so that it can be drawn. It has
 * to be drawn, because a list where `#platform` and `@platform-bot` sit two rows
 * apart with nothing between them saying they are different things is a list
 * somebody picks the wrong row out of.
 *
 * **Why a mark and not a grouping.** The obvious answer is two headed sections,
 * Channels then People, and it is wrong here: the server's order is the value of
 * the list - exact match, then what starts with the typing, then what contains
 * it - and cutting that into two piles throws away the ranking that put the row
 * somebody wants at the top. The kind is a property of a row, not the axis the
 * list is sorted on, so it is drawn on the row.
 *
 * **Why a mark and not a word.** "Channel" beside every name is fifty pixels of
 * the two hundred a row gets in the node panel, taken from the name, which is
 * the thing being read; and repeated down twenty-five rows it is a column of
 * prose next to a column of the actual answers. Two shapes down the left edge
 * are told apart at a glance and before either name is read, which is what "one
 * list, two kinds" needs, and they cost twelve pixels.
 *
 * **Why not lean on the `#` and the `@`.** The name already carries its sigil -
 * the server sends `#general` and `@alice` - and that does distinguish the two
 * once somebody has read the name. What it cannot do is distinguish them at a
 * glance: it is one character at the weight and colour of the rest of the name,
 * at the very place the match highlighting is drawn, and it is the first thing
 * to be argued with by a workspace whose display names begin with punctuation.
 * The mark says the same thing in a fixed place, in the muted colour, before the
 * name is read at all. Saying it twice is the point: this is a picker, and the
 * cost of the wrong row is a message sent to the wrong place.
 *
 * Drawn with `currentColor`, transcribed from `assets/hash.svg` and
 * `assets/user.svg` for the reason `OpenDefinitionIcon` transcribes its own: the
 * files hardcode their strokes - white in one, `#71717A` in the other - so an
 * `<img>` of the pair is one bright mark beside one grey one, in both themes,
 * with no CSS able to reach either. Here they have to be the same weight and the
 * same colour as each other or they are not a pair.
 *
 * It carries its own name rather than being `aria-hidden`. This stands inside a
 * `role="option"`, and a row read aloud as "#general" when the row under it is
 * read aloud as "@general" is exactly the ambiguity the mark exists to remove -
 * so the mark is in the accessible name too, in Slack's own two words for the
 * two things.
 */
export function SlackTargetKind({ target, className }: { target: MessageTarget; className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      role="img"
      aria-label={target === 'CHANNEL' ? 'Channel' : 'User'}
    >
      {target === 'CHANNEL' ? (
        /*
          `assets/hash.svg` scaled by 14/16 into this set's box, and at this
          set's weight rather than its own: the file is stroke 1.7 on a 16 grid,
          which beside a stroke-2 user on a 14 grid reads as a lighter mark
          rather than as a different one.
        */
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.43 1.75L4.38 12.25" />
          <path d="M9.8 1.75L8.75 12.25" />
          <path d="M2.19 4.81H12.25" />
          <path d="M1.75 9.19H11.81" />
        </g>
      ) : (
        /* `assets/user.svg`, which is already this box and this weight. */
        <path
          d="M11.0838 12.25V11.0833C11.0838 10.4645 10.8379 9.871 10.4003 9.43342C9.96267 8.99583 9.36911 8.75 8.7502 8.75H5.2498C4.63089 8.75 4.03733 8.99583 3.5997 9.43342C3.16206 9.871 2.9162 10.4645 2.9162 11.0833V12.25M9.3336 4.08333C9.3336 5.372 8.28881 6.41667 7 6.41667C5.71119 6.41667 4.6664 5.372 4.6664 4.08333C4.6664 2.79467 5.71119 1.75 7 1.75C8.28881 1.75 9.3336 2.79467 9.3336 4.08333Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
