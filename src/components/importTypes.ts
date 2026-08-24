import { tsType } from '../api/functions';
import type { ScriptImport } from '../api/functions';
import type { ValueType } from '../api/actions';

/**
 * What a script's imports are, written as TypeScript the editor can check against.
 *
 * The sandbox hands the code one frozen global called `imports`, keyed by the name
 * the importer chose - so `imports.upper(word)` is the whole of the calling
 * convention. Undeclared, that object is an error on every line that touches it,
 * and declared as `any` it is worse: every mistake in a call would compile.
 *
 * Written as a global declaration rather than a module, for the reason
 * `objectTypes` gives: a script's source is a module of its own, and an ambient
 * declaration is what is visible from inside one without an import nobody could
 * write.
 */
export function importTypes(imports: ScriptImport[]): string {
  const usable = imports.filter((held) => IDENTIFIER.test(held.name) && held.function !== null);

  /*
   * Nothing imported is said out loud rather than left out.
   *
   * An empty declaration file would leave `imports` a name the language service
   * has never heard of, and dropping the lib altogether would leave whatever the
   * last script declared - so a script with no imports would complete the names
   * of one that has them. `Record<string, never>` is the truthful answer: the
   * object exists, and there is nothing on it.
   */
  if (usable.length === 0) {
    return ['declare global {', '  const imports: Record<string, never>;', '}', 'export {};', ''].join('\n');
  }

  const members = usable.flatMap((held) => [
    ...described(held),
    `  ${held.name}: (${parameters(held.function?.signature ?? '()')}) => ${returned(held)};`,
  ]);

  return ['declare global {', '  const imports: {', ...members, '  };', '}', 'export {};', ''].join('\n');
}

/** A name TypeScript can declare a member by. The server insists on one; this checks. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * What the imported function does, put where the editor will show it.
 *
 * A doc comment rather than a plain one, because that is the form the language
 * service reads: hovering the call shows the sentence its author wrote. A
 * function with nothing said about it gets no comment - an empty one would
 * occupy the hover with a blank.
 */
function described(held: ScriptImport): string[] {
  const said = held.function?.description?.trim() ?? '';
  // A close-comment inside would end the comment early and leave the rest of the
  // sentence declared as TypeScript, which is a parse error nobody typed.
  return said === '' ? [] : [`  /** ${said.replace(/\*\//g, '* /')} */`];
}

/** What the call gives back, in the same words a parameter is annotated in. */
function returned(held: ScriptImport): string {
  const fn = held.function;
  return fn === null ? 'unknown' : tsType(fn.returnType, fn.returnObjectName);
}

/**
 * The imported function's parameters, as the annotation this call is checked
 * against.
 *
 * Read off the signature the server prints - "(city: string, days: number)" -
 * because that is what an importer is told about the callee, and it is written
 * from the same list of types the editor annotates with. The types are turned
 * back into TypeScript through `tsType`, so `map` is `Record<string, unknown>`
 * here exactly as it is in the callee's own declaration; two tables would show
 * up as a call being underlined for an argument the callee accepts.
 *
 * An entry this cannot read is annotated `unknown`, which is the honest answer
 * and keeps the rest of the signature checkable. A parameter list that could not
 * be read at all leaves the function taking whatever it is given, rather than
 * declaring it takes nothing and underlining every call.
 */
function parameters(signature: string): string {
  const inside = signature.trim().replace(/^\(/, '').replace(/\)$/, '').trim();
  if (inside === '') return '';

  return inside
    .split(',')
    .map((entry, at) => {
      const [written, annotation] = split(entry);
      const name = IDENTIFIER.test(written) ? written : `argument${at + 1}`;
      return `${name}: ${annotated(annotation)}`;
    })
    .join(', ');
}

/** One written parameter, as its name and whatever was written after the colon. */
function split(entry: string): [string, string] {
  const at = entry.indexOf(':');
  return at === -1 ? [entry.trim(), ''] : [entry.slice(0, at).trim(), entry.slice(at + 1).trim()];
}

/**
 * The shape a word in a signature stands for.
 *
 * The server writes a parameter's type as the value type in lower case, so the
 * word maps straight onto one - and through `tsType`, which is the one table the
 * editor annotates from. Anything else is an object's name, which is declared
 * from the workspace's own objects and can be written as it stands.
 */
function annotated(word: string): string {
  if (word === '') return 'unknown';
  const type = word.toUpperCase();
  if (KNOWN.includes(type as ValueType)) return tsType(type as ValueType);
  return IDENTIFIER.test(word) ? word : 'unknown';
}

/** The words a signature can hold that are types rather than an object's name. */
const KNOWN: ValueType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'OBJECT', 'MAP', 'ARRAY', 'NONE'];
