/**
 * What the icon picker hides, and what it must not.
 *
 * The furniture rule used to be one prefix-anchored regular expression, so it
 * hid anything merely *starting* with a listed word. `plus-circle`,
 * `search-code`, `save-all`, `sunrise`, `sunset`, `moon-star` and `pen-tool`
 * would each have vanished the day somebody added them, with nothing anywhere
 * to say they had - and the next person would have added them again.
 *
 * That is why this check reads the source rather than the screen. A hidden icon
 * draws nothing, so a browser cannot tell "deliberately furniture" from
 * "swallowed by a prefix". Only the rule itself knows, and the rule is what is
 * asserted here.
 *
 * It runs in about a second, needs no server and no browser, and covers an icon
 * the moment the file lands in `assets`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../src/components/IconPicker.tsx'), 'utf8');
const assets = readdirSync(join(here, '../src/assets'))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.replace(/\.svg$/, ''));

/* The rule, read out of the file rather than restated here - a copy would drift. */
const families = new RegExp(
  source.match(/const CHROME_FAMILIES = \/(.+?)\/;/)?.[1] ?? '$^',
);
const exact = new Set(
  [...(source.match(/const CHROME_EXACT = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
    (found) => found[1],
  ),
);

const hidden = (name) => families.test(name) || exact.has(name);

let failures = 0;
const check = (ok, said) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${said}`);
  if (!ok) failures += 1;
};

/*
 * The five the owner asked back. Each is a reasonable thing to call a node - a
 * run, a persist, a lookup, an add, a duplicate - and each was hidden by the
 * old prefix rule rather than by anybody deciding it should be.
 */
for (const name of ['play', 'save', 'search', 'plus', 'copy']) {
  if (!assets.includes(name)) continue;
  check(!hidden(name), `${name} is offered - it names a node, it is not furniture`);
}

/*
 * The trap, stated as the cases that sprung it. None of these is in the set
 * today; the point is that adding one must not silently do nothing.
 */
for (const name of ['plus-circle', 'search-code', 'save-all', 'sunrise', 'sunset', 'moon-star', 'pen-tool']) {
  check(!hidden(name), `${name} would be offered if it were added, rather than vanishing`);
}

/* And the furniture itself is still furniture, or the rule bought nothing. */
for (const name of ['chevron-down', 'panel-left', 'arrow-left', 'toggle-on', 'trash-2', 'undo', 'redo', 'settings-14']) {
  if (!assets.includes(name)) continue;
  check(hidden(name), `${name} stays out of the picker`);
}

/*
 * A family takes everything below it, which is the half a plain list cannot do.
 * These are not in the set either - the assertion is about the shape of the
 * rule, not about today's files.
 */
for (const name of ['chevron-up-down', 'arrow-big-right', 'panel-bottom-close']) {
  check(hidden(name), `${name} is furniture by family, without being listed`);
}

const browsable = assets.filter((name) => !hidden(name));
console.log(`\n${assets.length} icons, ${browsable.length} offered, ${assets.length - browsable.length} furniture`);
check(browsable.length > 250, `the catalogue is wide (${browsable.length} offered)`);

console.log(failures === 0 ? `\nALL PASS` : `\nSOME FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
