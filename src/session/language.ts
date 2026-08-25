const KEY = 'orknux.language';

/**
 * The languages this bundle was built with words for.
 *
 * A list and not a free tag, because it is what the picker offers and what a
 * catalogue is looked up in. The server stores whatever it was told, so a tag
 * that is not on this list arrives here from time to time - a row written by a
 * later version, or by hand - and reads as English rather than as an error.
 */
export const LANGUAGES = ['en', 'pl'] as const;

export type Language = (typeof LANGUAGES)[number];

/** What the picker calls each of them, in that language and not in English. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  pl: 'Polski',
};

function known(tag: string | null | undefined): Language | null {
  if (tag === null || tag === undefined) return null;
  const head = tag.trim().toLowerCase().split('-')[0];
  return (LANGUAGES as readonly string[]).includes(head) ? (head as Language) : null;
}

/**
 * What the browser is set to, as an opening guess and nothing more.
 *
 * Only ever consulted for somebody who has never chosen. A header that could
 * override a stated preference would make the picker a suggestion, and somebody
 * who deliberately reads an English product on a Polish machine would find it
 * in Polish again every time they cleared their cookies.
 */
function guessed(): Language {
  const offered = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of offered) {
    const found = known(tag);
    if (found !== null) return found;
  }
  return 'en';
}

/**
 * The language in force, read once when this module loads.
 *
 * Local storage is the copy that survives a reload; the row on the server is
 * the copy that follows somebody to another machine, and it arrives with the
 * session a moment later.
 */
const language: Language = read();

function read(): Language {
  try {
    return known(window.localStorage.getItem(KEY)) ?? guessed();
  } catch {
    // A browser that refuses storage still works; it simply guesses every time.
    return guessed();
  }
}

export function currentLanguage(): Language {
  return language;
}

/**
 * Puts the language on the root element, where a screen reader and the
 * browser's own hyphenation pick it up.
 *
 * Unlike the theme beside it, English writes the attribute too: `lang` has no
 * "leave it as it was" value, and `index.html` ships `lang="en"` which would
 * otherwise still be claiming English on a Polish page.
 */
export function applyLanguage(next: Language): void {
  document.documentElement.lang = next;
}

function remember(next: Language): void {
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Not remembered is not broken; the reload below simply lands in the old one.
  }
}

/**
 * Changing language reloads the page, on purpose.
 *
 * `t` is a plain function reading module state, which makes it usable anywhere
 * - including in a module-level constant. `navigation.ts` names every page in
 * one array, `WorkspaceIssuesPage` names its statuses in another, and about
 * thirty such lists are built once, when their module is first imported. A
 * language change that only re-rendered would leave every one of them in the
 * language the tab was opened in, and the failure would be a sidebar in Polish
 * beside a Quick actions list in English - the sort of thing that is noticed by
 * a person and never by a test.
 *
 * The alternative was to make each of those lazy, and there is no way to know
 * that all of them have been: a constant added tomorrow would be stale again
 * and nothing would say so. Re-evaluating every module is the one answer that
 * is complete by construction, and a reload is what re-evaluates every module.
 *
 * It costs a moment and whatever is half-typed on the screen - which is a page
 * of Preferences with a picker on it, pressed deliberately, once.
 */
function reloadInto(next: Language): void {
  remember(next);
  applyLanguage(next);
  window.location.reload();
}

/**
 * What the session says this person chose, taken without being a choice.
 *
 * Called when the session arrives. Null means they have never said, and the
 * guess already in force stands - putting them into English there would be the
 * product deciding for somebody who has not been asked, which is the one thing
 * `null` exists to prevent.
 *
 * Reloads only when it actually differs from what this tab loaded with, which
 * is the first sign-in on a machine and no other time. The reload writes the
 * new tag to storage on its way out, so the page it lands on agrees and there
 * is nothing left to differ about.
 */
export function adoptLanguage(tag: string | null | undefined): boolean {
  const found = known(tag);
  if (found === null || found === language) return false;
  reloadInto(found);
  return true;
}

/** Somebody choosing, in the picker. The server is told first, by the caller. */
export function setLanguage(next: Language): void {
  if (next === language) return;
  reloadInto(next);
}
