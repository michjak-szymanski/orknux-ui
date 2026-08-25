import { currentLanguage } from '../session/language';
import type { Language } from '../session/language';
import { PL } from './pl';

/**
 * How this product is translated: the English sentence is the key.
 *
 * ---------------------------------------------------------------------------
 * Why there are no `nav.workspace.settings` keys
 *
 * The usual arrangement invents an identifier for every string and puts the
 * English in a catalogue beside the Polish. It was rejected here for three
 * reasons, and the third is the one that settled it.
 *
 * There are about thirteen hundred of these. Inventing thirteen hundred names
 * is thirteen hundred chances to make a mechanical mistake, and every one of
 * those mistakes shows up as the wrong sentence on a screen rather than as a
 * compile error.
 *
 * `git grep "Add Connection"` is how anybody - a person or an agent - finds the
 * screen a report is about. Keys destroy that: the report says "Add Connection",
 * the source says a key nobody would guess, and finding one from the other
 * needs the catalogue open in a second window.
 *
 * And `hint-prose-check` reads the source. It recognises a paragraph under a
 * field by an unbroken run of five hard-coded words in an element's own text,
 * and it is the half of that check the file itself calls the valuable one -
 * it reads every file in a second and a page that fails to render cannot hide
 * from it. A key would hide every sentence in the product from it at once. With
 * the English still written at the call site, the check needed only to learn
 * that `{t('…')}` is text; it sees exactly what it saw before.
 *
 * ---------------------------------------------------------------------------
 * What it costs
 *
 * Two things, both accepted deliberately.
 *
 * Editing an English string breaks its own translation - the catalogue is keyed
 * on the old wording and no longer matches. That is not silent: the string falls
 * back to the English that is right there in the diff, and `catalogue-check`
 * fails on any entry whose English has left the source, so a reworded sentence
 * is a red build rather than a Polish screen with one line of English in it.
 *
 * And one English word can need two Polish ones. `t` takes an optional second
 * argument naming which sense is meant, and the catalogue holds
 * after a separator; it is only ever needed where one English word is
 * genuinely doing two jobs, which so far is a handful of places.
 */

/** What separates a string from the sense of it. Unit Separator, as gettext does. */
const CONTEXT = '\u001f';

const CATALOGUES: Partial<Record<Language, Record<string, string>>> = { pl: PL };

/**
 * The sentence, in the language in force.
 *
 * Falls back to what was passed, which is the English. So a string nobody has
 * translated yet, or one whose wording has just changed, reads as correct
 * English rather than as a key or a blank - the product is never broken by a
 * missing entry, only less translated.
 */
export function t(english: string, sense?: string): string {
  const catalogue = CATALOGUES[currentLanguage()];
  if (catalogue === undefined) return english;
  if (sense !== undefined) {
    const particular = catalogue[`${english}${CONTEXT}${sense}`];
    if (particular !== undefined) return particular;
  }
  return catalogue[english] ?? english;
}

/**
 * A sentence with values in it.
 *
 * `{name}` in both the English and the Polish, so a translation can move it -
 * Polish puts the object where English puts the subject often enough that a
 * positional list would be read back to front. A placeholder the arguments have
 * nothing for is left standing rather than replaced with `undefined`: it is
 * visible, and it says which name was expected.
 */
export function tf(english: string, values: Record<string, unknown>, sense?: string): string {
  return t(english, sense).replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * There is no hook here, and `t` is not reactive.
 *
 * It does not need to be: changing language reloads the page, and
 * `session/language.ts` says why that is the only answer that is complete -
 * `t` is usable in a module-level constant, about thirty lists in this
 * application are exactly that, and nothing but re-evaluating every module
 * gets all of them.
 *
 * What it buys is that `t` can be called anywhere, on anything: at the top of a
 * module, inside a `map`, on a value rather than a literal. `t(name)` where
 * `name` is a section key works, because the key is the English.
 */
export type { Language };
