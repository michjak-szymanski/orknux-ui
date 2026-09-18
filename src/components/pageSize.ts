import { useState } from 'react';

/**
 * How many rows a page holds, and what else it may be set to.
 *
 * The same four on every list, because the choice says how much of a screen
 * somebody has rather than what they are looking at. First offered on the
 * issue list, then the workflow list, and reported missing everywhere else -
 * "not all table views contain a show X per page option" - which is how the
 * choice ended up here instead of copied into every page.
 *
 * Ten by default rather than whatever fixed size a list used to hold. Five, or
 * six, or eight was never a choice anybody had made, and none of them is one of
 * the sizes on offer - a control that opens showing a number it cannot be set
 * back to is a control that looks broken.
 */
export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 10;

/**
 * The page size somebody chose for one list, remembered for them.
 *
 * Remembered per person and per list rather than per workspace or in the
 * address. Per list, because somebody who reads workflows ten at a time and
 * audit entries a hundred at a time is not being inconsistent; not in the
 * address, because it is a fact about the screen somebody is at, so a link they
 * send should not force their choice on the person who opens it.
 *
 * [list] names the list, and nothing else: the stored key is
 * `orknux.<list>.page-size`, and the keys the issue and workflow lists were
 * already remembered under spell it exactly this way.
 *
 * The setter persists the choice; it does not touch the page number. Which page
 * somebody is on means something else at another size, so every caller puts the
 * reader back on the first page itself, in whatever way that list turns pages.
 */
export function usePageSize(list: string): [number, (size: number) => void] {
  const key = `orknux.${list}.page-size`;
  const [pageSize, setPageSize] = useState(() => {
    const held = Number(window.localStorage.getItem(key));
    return PAGE_SIZES.includes(held) ? held : DEFAULT_PAGE_SIZE;
  });

  return [
    pageSize,
    (chosen: number) => {
      setPageSize(chosen);
      window.localStorage.setItem(key, String(chosen));
    },
  ];
}
