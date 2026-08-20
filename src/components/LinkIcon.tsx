/**
 * The link mark, for a way out to the definition a field is pointing at.
 *
 * The path is `assets/link.svg` transcribed, with one change: the file hardcodes
 * its stroke as #A1A1AA, and an <img> of it is therefore a fixed grey no CSS can
 * reach. These sit inside links that carry the brand colour and underline on
 * hover, so the mark has to follow the text it replaced — `currentColor` is what
 * makes it do that, in either theme.
 *
 * Drawn rather than masked. The nav masks its icons because it has a dozen of
 * them and one class; this is one shape used in five places, and an element that
 * inherits colour by itself needs nothing at the call sites.
 */
export function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M5.83343 7.58331C6.08394 7.91822 6.40355 8.19533 6.77058 8.39586C7.13761 8.59638 7.54347 8.71563 7.96064 8.7455C8.37781 8.77538 8.79652 8.71519 9.18838 8.56902C9.58024 8.42284 9.93608 8.1941 10.2318 7.89831L11.9818 6.14831C12.5131 5.59822 12.807 4.86146 12.8004 4.09672C12.7937 3.33198 12.487 2.60045 11.9462 2.05967C11.4055 1.5189 10.6739 1.21216 9.90918 1.20551C9.14444 1.19886 8.40768 1.49285 7.85759 2.02414L6.85426 3.02164M8.16688 6.41679C7.91636 6.08189 7.59675 5.80477 7.22972 5.60425C6.86269 5.40372 6.45683 5.28448 6.03966 5.2546C5.6225 5.22472 5.20378 5.28491 4.81192 5.43109C4.42007 5.57726 4.06423 5.806 3.76854 6.10179L2.01854 7.85179C1.48725 8.40188 1.19326 9.13864 1.19991 9.90338C1.20656 10.6681 1.5133 11.3997 2.05407 11.9404C2.59485 12.4812 3.32638 12.7879 4.09112 12.7946C4.85586 12.8012 5.59262 12.5073 6.14271 11.976L7.14021 10.9785"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
