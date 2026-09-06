import { useState } from 'react';

/**
 * A page number that goes back to the first when what is being paged changes.
 *
 * Every list on a workspace screen keeps which page it is showing, and the
 * workspace switcher does not unmount the screen: the route is the same shape
 * with a different id, so React keeps the component and the number with it.
 * Standing on page 3 of Acme's triggers and switching to a workspace with one
 * page asked for page 3 of that, which the server answered truthfully with
 * nothing - an empty list, on a workspace that has triggers. Reported
 * 2026-09-06 against the triggers screen; every paged list on a workspace had
 * it.
 *
 * Reset during the render that sees the change rather than in an effect. An
 * effect would let one render through with the new workspace and the old page
 * number, and that render is what fetches - so the empty answer would still be
 * asked for, and then thrown away, once per switch. React re-renders on a
 * `set` during render before it commits anything, which is the documented way
 * to derive state from a prop that changed.
 *
 * [within] is whatever the number is a page *of*: a workspace id where the list
 * is the workspace's, a session id where it is one session's.
 */
export function usePageWithin(within: string): [number, (page: number) => void] {
  const [page, setPage] = useState(1);
  const [paged, setPaged] = useState(within);

  if (paged !== within) {
    setPaged(within);
    setPage(1);
  }

  return [page, setPage];
}
