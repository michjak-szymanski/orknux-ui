import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import bookIcon from '../../assets/book.svg';
import searchIcon from '../../assets/search.svg';
import { AppShell, SidebarNavItem } from '../../components/AppShell';
import { Markdown } from '../../components/Markdown';
import { segments } from '../../components/searchMatches';
import { shellUser } from '../../session/user';
import styles from './DocsPage.module.css';

export interface DocsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * The pages themselves, compiled in.
 *
 * Bundled rather than fetched from a documentation site: the documentation that
 * ships with a version describes that version, and an installation behind a
 * firewall still has it. A file added under `src/docs` appears here with no
 * further wiring — the leading number orders it, and its first heading names
 * it.
 */
const SOURCES = import.meta.glob('../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface DocPage {
  /** From the filename, with the ordering prefix dropped: `workflows`. */
  slug: string;
  /** The first heading in the file. */
  title: string;
  body: string;
}

function pages(): DocPage[] {
  return Object.entries(SOURCES)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, body]) => {
      const name = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
      const heading = /^#\s+(.+)$/m.exec(body);
      return {
        slug: name.replace(/^\d+-/, ''),
        title: heading?.[1] ?? name,
        body,
      };
    });
}

/** A page that matched, with the line it matched on. */
interface Hit {
  page: DocPage;
  /**
   * The first matching line, for showing what was found where. Null when only
   * the title matched: the title is already the label, and repeating it under
   * itself says nothing.
   */
  line: string | null;
  /** How many lines matched, so a page full of it is obvious. */
  count: number;
}

/**
 * A line of markdown as the prose it renders to.
 *
 * A snippet is a sentence shown to somebody, not source. Left alone, the line
 * arrives as `2. Give it a **trigger**` — the markers read as typos next to the
 * very term they are meant to be showing. Headings lose their hashes for the
 * same reason the search looks at them at all: `## Chat` is about chat.
 *
 * Underscores are left alone deliberately. They mean emphasis in markdown and
 * they mean nothing at all in `user_search_base`, and this manual has more of
 * the second than the first.
 */
function plain(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/^>\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    // The words, not the address behind them.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

/**
 * Searches the pages as text.
 *
 * The whole manual is already in memory, so this is a scan rather than a
 * request: there is nothing to wait for and nothing to debounce.
 */
function search(all: DocPage[], text: string): Hit[] {
  const needle = text.trim().toLowerCase();
  if (needle === '') return [];

  return all.flatMap((page) => {
    /*
     * The pictures come out first, and before the split rather than after it.
     *
     * An image is not a sentence: matched, it offers the reader a line that is
     * nowhere on the page they are then sent to. Left in, its alt text arrives
     * as `!The quick chat, open over…` — the link rule takes the brackets and
     * leaves the bang — and one wrapped across two lines leaves its second
     * half, `back](/screens/actions.png)`, looking like a broken manual.
     */
    const prose = page.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    const lines = prose
      .split('\n')
      .map(plain)
      .filter(
        (line) =>
          line !== '' &&
          // The page's own heading is already the label on the result.
          line !== page.title &&
          line.toLowerCase().includes(needle),
      );

    if (lines.length === 0 && !page.title.toLowerCase().includes(needle)) return [];
    return [{ page, line: lines[0] ?? null, count: lines.length }];
  });
}

/**
 * `text` with every occurrence of `needle` marked.
 *
 * The term is picked out in the title, in the line beside it and in the page
 * itself, so wherever the reader looks after typing, the word they typed is the
 * one their eye lands on.
 */
function Marked({ text, needle }: { text: string; needle: string }) {
  return (
    <>
      {segments(text, needle).map((part, index) =>
        part.match ? (
          <mark key={index} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * How far down the view the reader is taken to be looking.
 *
 * Not the very top: a heading that has just appeared is not yet what somebody is
 * reading, and treating it as such makes the contents flicker a line early.
 */
const READING_LINE = 120;



/**
 * The manual, as it stood when this version was built.
 *
 * One page at a time with the contents down the side, which is what
 * documentation is read as: somebody arrives with a question, finds the page
 * whose title matches it, and reads that page. The box above the contents is
 * for when no title matches the question — it looks inside the pages and says
 * which one says it.
 */
export function DocsPage({ session, onSignOut }: DocsPageProps) {
  const { page } = useParams();
  const all = useMemo(pages, []);
  const [query, setQuery] = useState('');
  const hits = useMemo(() => search(all, query), [all, query]);
  const searching = query.trim() !== '';
  const current = all.find((one) => one.slug === page);

  const article = useRef<HTMLElement>(null);

  /*
   * The manual is one document, and it is read as one.
   *
   * Every page is rendered, stacked in order, and the reader scrolls. There is no
   * turn between them: the next page's heading arrives the way the next section of
   * anything does, because that is what it is — the files are split for writing,
   * not for reading.
   *
   * Scrolling moves nothing but the highlight in the contents. It deliberately does
   * not touch the address: an address that followed the reader would come back
   * through the router as a page to go to, and the reader would be dragged to the
   * top of each section as they crossed into it. Reading is not navigation, and the
   * only thing that needs to know where you are is the list on the left.
   */
  const sections = useRef(new Map<string, HTMLElement>());
  /** Which page is under the reading line: what the contents lights up. */
  const [reading, setReading] = useState(page);

  /*
   * Chosen from the contents, or arrived at by link. This is the only thing that
   * moves the view, so nothing can move it out from under somebody who is reading.
   */
  const landed = useRef(false);
  useEffect(() => {
    if (page === undefined) return;
    const scroller = document.querySelector<HTMLElement>('main');
    const section = sections.current.get(page);
    if (scroller === null || section === undefined) return;

    setReading(page);
    scroller.scrollTo({
      top: section.offsetTop - scroller.offsetTop,
      // The first arrival is a deep link: be there, rather than travel there.
      behavior: landed.current ? 'smooth' : 'auto',
    });
    landed.current = true;
  }, [page]);

  /*
   * Which page is being read, from where the view is: the last section that has
   * started by the time the reading line is reached.
   *
   * Listened for on the document, in the capture phase, rather than on the element
   * that scrolls. A scroll event does not bubble, but it does capture — and the
   * element it comes from is replaced whenever the route changes, because the frame
   * animates each page in. Held directly, the listener was left on a node that had
   * been thrown away: the highlight followed the reader until the first time they
   * used the contents, and then never moved again.
   */
  useEffect(() => {
    let queued = false;

    const onScroll = (event: Event) => {
      const scroller = document.querySelector<HTMLElement>('main');
      if (scroller === null || event.target !== scroller) return;
      if (queued) return;
      queued = true;

      requestAnimationFrame(() => {
        queued = false;
        const line = scroller.scrollTop + READING_LINE;
        let found: string | undefined;
        for (const one of all) {
          const section = sections.current.get(one.slug);
          if (section === undefined) continue;
          if (section.offsetTop - scroller.offsetTop <= line) found = one.slug;
        }
        if (found !== undefined) setReading((was) => (was === found ? was : found));
      });
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [all]);
  /** The marks on the page being read, in the order they appear in it. */
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const [at, setAt] = useState(0);

  /*
   * Collected from the page rather than counted in the text, so what can be
   * stepped through is exactly what is drawn. The marks are made while the
   * markdown renders, so this has to run after that: an effect, not a memo.
   */
  useEffect(() => {
    const found =
      article.current === null || !searching
        ? []
        : Array.from(article.current.querySelectorAll<HTMLElement>('[data-search-match]'));
    setMatches(found);
    setAt(0);
    /*
     * Not on which page is being read. It used to be, because only that page was
     * rendered and its marks arrived with it; now the whole manual is on screen and
     * the marks are all there at once. Left as a dependency it would recollect every
     * time scrolling crossed a heading, and the effect below would take the reader
     * back to the first match — a search that fought anyone trying to read past it.
     */
  }, [searching, query]);

  /*
   * The current match is set on the element rather than rendered, because
   * stepping through matches must not re-render the page: the marks are put
   * there by a plugin over the parsed document, and reparsing a manual page on
   * every press of Enter to move a ring by one word is work for nothing.
   */
  useEffect(() => {
    matches.forEach((mark, index) => {
      if (index === at) mark.setAttribute('data-current', 'true');
      else mark.removeAttribute('data-current');
    });
    matches[at]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [matches, at]);

  /** Enter and the arrows walk the matches; Shift reverses. Wraps at both ends. */
  function step(event: KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return;
    const forward = event.key === 'Enter' ? !event.shiftKey : event.key === 'ArrowDown';
    const back = event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey);
    if (!forward && !back) return;
    event.preventDefault();
    setAt((was) => (was + (forward ? 1 : -1) + matches.length) % matches.length);
  }

  /*
   * Choosing a result goes to the first match on it, whether the title or the
   * line beside it was clicked. Landing at the top of a page and being left to
   * find the word yourself is what the mark was supposed to solve.
   */
  function toFirstMatch(slug: string) {
    const section = sections.current.get(slug);
    const first = section?.querySelector<HTMLElement>('[data-search-match]');
    if (first === null || first === undefined) return;

    // Which of the marks this is, so stepping on with Enter carries on from here
    // rather than starting again at the top of the manual.
    const index = matches.indexOf(first);
    setAt(index === -1 ? 0 : index);
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // An address that names no page — an old link, a typo — goes to the first one
  // rather than to an empty frame.
  if (current === undefined) {
    return <Navigate to={`/docs/${all[0]?.slug ?? ''}`} replace />;
  }

  return (
    <AppShell
      title={current.title}
      user={shellUser(session)}
      section="docs"
      onSignOut={onSignOut}
      scrollContent
      sidebar={
        <>
          <div className={styles.search}>
            <img src={searchIcon} alt="" width={16} height={16} />
            <input
              className={styles.searchField}
              type="search"
              placeholder="Search the docs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={step}
              aria-label="Search the documentation"
            />
            {/* Which match of how many, on the page being read. */}
            {matches.length > 0 && (
              <span className={styles.counter}>
                {at + 1}/{matches.length}
              </span>
            )}
          </div>

          {searching && hits.length === 0 && <p className={styles.noHits}>Nothing found.</p>}

          {searching
            ? hits.map((hit) => (
                <div
                  key={hit.page.slug}
                  className={styles.hit}
                  onClick={() => toFirstMatch(hit.page.slug)}
                >
                  <SidebarNavItem
                    label={
                      <>
                        <Marked text={hit.page.title} needle={query} />
                        {hit.count > 1 && ` (${hit.count})`}
                      </>
                    }
                    icon={bookIcon}
                    active={hit.page.slug === reading}
                    to={`/docs/${hit.page.slug}`}
                  />
                  {/*
                   * The line the page matched on. A list of titles answers
                   * "which page", but not "is this the one I meant" — the
                   * sentence it was found in does.
                   */}
                  {hit.line !== null && (
                    <Link to={`/docs/${hit.page.slug}`} className={styles.snippet}>
                      <Marked text={hit.line} needle={query} />
                    </Link>
                  )}
                </div>
              ))
            : all.map((one) => (
                <SidebarNavItem
                  key={one.slug}
                  label={one.title}
                  icon={bookIcon}
                  active={one.slug === reading}
                  to={`/docs/${one.slug}`}
                />
              ))}
        </>
      }
    >
      <article className={styles.card} ref={article}>
        {/*
          Every page, in order, in one column. What used to be here was whichever
          page the address named; the rest of the manual was a click away and the
          reader had to know to want it.

          The term is marked wherever it appears, which now means the whole manual
          rather than one page of it — so a search says where the word is, and
          scrolling is how you get there.
        */}
        {all.map((one) => (
          <section
            key={one.slug}
            id={one.slug}
            className={styles.section}
            ref={(element) => {
              if (element === null) sections.current.delete(one.slug);
              else sections.current.set(one.slug, element);
            }}
          >
            <Markdown highlight={searching ? query : undefined}>{one.body}</Markdown>
          </section>
        ))}
      </article>
    </AppShell>
  );
}
