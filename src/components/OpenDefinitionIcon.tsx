/**
 * The mark on the way out to the definition a field is naming.
 *
 * It was a chain link, which was the wrong idea. A chain link means *hyperlink*
 * or *attach* — that two things are joined. What this control does is open the
 * thing the field points at, in a tab of its own, so the form being filled in is
 * not thrown away by going to look. Every call site is a `target="_blank"` link
 * and every title says "in a new tab"; the arrow leaving a box is the mark for
 * exactly that, and it is the only one in common use that says *leaves here*
 * rather than *is joined to*.
 *
 * Not the gear. `settings-14.svg` is the row action on every list page and it
 * goes to the same editors this does — but it navigates in place, and it is the
 * primary way to open a row that already *is* the thing. Here the field only
 * names something else, the trip is secondary, and not losing the page is the
 * whole reason the control exists. A gear beside a form label reads as "options
 * for this field". Two marks for opening-in-place and opening-elsewhere is the
 * distinction, not an inconsistency.
 *
 * The path is `assets/external-link.svg` transcribed, with one change: the file
 * hardcodes its stroke as #A1A1AA, and an <img> of it is therefore a fixed grey
 * no CSS can reach. These sit inside links that carry the brand colour and
 * brighten on hover, so the mark has to follow the text it replaced —
 * `currentColor` is what makes it do that, in either theme.
 *
 * Drawn rather than masked. The nav masks its icons because it has a dozen of
 * them and one class; this is one shape used in ten places, and an element that
 * inherits colour by itself needs nothing at the call sites.
 */
export function OpenDefinitionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      {/*
        Lucide's external-link, scaled by 14/24 the way every other 14px mark in
        `assets/` was, and then the box pulled in by one unit on the two sides
        the arrow crosses. This set keeps stroke-width 2 in a 14 box, which is
        about 1.7x Lucide's weight relative to its own grid: at that weight the
        original spacing closes up and the arrow's tail welds itself to the
        corner the box leaves open. A unit of clearance is what keeps the two
        shapes readable as two shapes at 14px.
      */}
      <path
        d="M8.75 1.75H12.25V5.25M6.41667 7.58333L12.25 1.75M10.5 8.16667V11.0833C10.5 11.7277 9.97767 12.25 9.33333 12.25H2.91667C2.27233 12.25 1.75 11.7277 1.75 11.0833V4.66667C1.75 4.02233 2.27233 3.5 2.91667 3.5H5.83333"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
