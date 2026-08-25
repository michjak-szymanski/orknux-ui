/**
 * What a cron expression actually does, in a sentence.
 *
 * A schedule is the one field in this interface where the thing typed and the
 * thing meant are written in different languages. `0 30 9 1 * *` is either "at
 * half past nine on the first of every month" or it is a row of digits somebody
 * copied from a wiki and is about to be surprised by, and nothing on the screen
 * used to say which. Now the field says it back in English as it is typed.
 *
 * ---------------------------------------------------------------------------
 * Which cron
 *
 * This reads Spring's `CronExpression`, because that is what the server parses
 * with, and it normalises the way the server normalises: `sixField` in
 * `TriggerAPI.kt` prepends `0` to an expression of exactly five fields, so five
 * fields are read from the minute with seconds at zero. Six fields lead with
 * seconds. That distinction is not decoration - issue #203 made a cron of
 * seconds a schedule the server keeps rather than one it merely accepts, so a
 * leading star-slash-ten now genuinely fires six times a minute and the field
 * has to be able to say so.
 *
 * The dialect is Spring's rather than a generic reference's: day of week is
 * 0-7 with both 0 and 7 Sunday, `?` means the same as `*`, `L` is the last day
 * (of the month, or of that weekday in the month), `#` picks the nth weekday,
 * and the `@daily` family expands. Where this cannot read a token it says so
 * with the token in it, rather than guessing - a description that quietly
 * describes something else is worse than no description.
 *
 * ---------------------------------------------------------------------------
 * Three answers, not two
 *
 * Parsing is not the only way an expression can be wrong. `0 0 30 2 *` is the
 * thirtieth of February: it parses, and it never comes round. The server
 * refuses it on save, in different words from a malformed one, and so does this
 * - before the save, which is the only place the distinction is any use.
 */

/**
 * This module is not translated, on purpose.
 *
 * It writes a sentence rather than printing one - "At 02:00 every day" is
 * assembled from a dozen fragments in English word order - and Polish declines
 * the noun after the numeral, so joining the same pieces the same way produces
 * something no Polish speaker would write. Translating it means writing a
 * second generator, which is a job of its own and not a catalogue entry.
 *
 * It is also the one module a check imports rather than reads: `cron-reading
 * -check` loads `CRON_FIELDS` from here in Node, where a directory import of
 * `../i18n` does not resolve.
 */

/** One position in the expression, for the legend beside the field. */
export interface CronFieldLegend {
  /** Where it stands, counting from one, in a six-field expression. */
  position: number;
  /** What it is. */
  label: string;
  /** What may go in it, in the server's dialect. */
  accepts: string;
}

/**
 * The six positions, in order, spelled as Spring parses them rather than as a
 * generic cron reference would. Exported so the legend and the checks that read
 * it agree by construction.
 */
export const CRON_FIELDS: readonly CronFieldLegend[] = [
  { position: 1, label: 'second', accepts: '0-59' },
  { position: 2, label: 'minute', accepts: '0-59' },
  { position: 3, label: 'hour', accepts: '0-23' },
  { position: 4, label: 'day of month', accepts: '1-31, L' },
  { position: 5, label: 'month', accepts: '1-12 or JAN-DEC' },
  { position: 6, label: 'day of week', accepts: '0-7 or MON-SUN' },
];

/**
 * What the field has to say about what is in it.
 *
 * `empty` is its own answer rather than an unreadable one: an untouched field
 * has not got it wrong.
 */
export type CronReading =
  | { state: 'empty'; text: string }
  | { state: 'reading'; text: string }
  | { state: 'unreadable'; text: string }
  | { state: 'unreachable'; text: string };

/* -------------------------------------------------------------------- units */

interface Unit {
  /** How the field is named in an error: "not a minute". */
  label: string;
  min: number;
  max: number;
  /** What may go in it, for the same error. */
  accepts: string;
  /** Names this field takes instead of numbers. */
  names?: Readonly<Record<string, number>>;
}

const DAY_NAMES: Readonly<Record<string, number>> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const MONTH_NAMES: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const SECOND: Unit = { label: 'second', min: 0, max: 59, accepts: '0-59' };
const MINUTE: Unit = { label: 'minute', min: 0, max: 59, accepts: '0-59' };
const HOUR: Unit = { label: 'hour', min: 0, max: 23, accepts: '0-23' };
const DAY_OF_MONTH: Unit = { label: 'day of month', min: 1, max: 31, accepts: '1-31' };
const MONTH: Unit = { label: 'month', min: 1, max: 12, accepts: '1-12 or JAN-DEC', names: MONTH_NAMES };
/** 0 and 7 are both Sunday, which is why the top of the range is 7 and not 6. */
const DAY_OF_WEEK: Unit = { label: 'day of week', min: 0, max: 7, accepts: '0-7 or MON-SUN', names: DAY_NAMES };

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_OF = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The most days a month can hold. February is 29 rather than 28 on purpose:
 * the question this answers is whether a date ever happens, and the twenty-ninth
 * happens every fourth year.
 */
const LONGEST = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The `@` shorthands Spring expands, expanded the same way. */
const MACROS: Readonly<Record<string, string>> = {
  '@yearly': '0 0 0 1 1 *',
  '@annually': '0 0 0 1 1 *',
  '@monthly': '0 0 0 1 * *',
  '@weekly': '0 0 0 * * 0',
  '@daily': '0 0 0 * * *',
  '@midnight': '0 0 0 * * *',
  '@hourly': '0 0 * * * *',
};

/* ------------------------------------------------------------------ parsing */

type Part =
  // A star, on its own or with a step: every value, or every nth of them.
  | { kind: 'all'; step: number | null }
  // `a-b`, on its own or with a step.
  | { kind: 'range'; from: number; to: number; step: number | null }
  /** `a/n` - from a, then every n to the end of the field. */
  | { kind: 'from'; from: number; step: number }
  | { kind: 'one'; value: number }
  /** Day of month: `L`, or `L-3` for the third-to-last. */
  | { kind: 'lastDay'; back: number }
  /** Day of week: `5L`, `FRIL` - the last Friday of the month. */
  | { kind: 'lastWeekday'; day: number }
  /** Day of week: `FRI#2` - the second Friday of the month. */
  | { kind: 'nthWeekday'; day: number; nth: number }
  /** Day of month: `LW` - the last weekday of the month. */
  | { kind: 'lastWorkday' };

/** Thrown while parsing and caught at the top; the message is what is shown. */
class Unreadable extends Error {}

/** "a minute", "an hour" - the article the label actually takes, silent h and all. */
const a = (label: string) => `${/^(hour|[aeiou])/i.test(label) ? 'an' : 'a'} ${label}`;

function number(token: string, unit: Unit): number {
  const named = unit.names?.[token.toUpperCase()];
  const value = named ?? (/^\d{1,2}$/.test(token) ? Number(token) : Number.NaN);
  if (!Number.isFinite(value) || value < unit.min || value > unit.max) {
    throw new Unreadable(`"${token}" is not ${a(unit.label)} (${unit.accepts}).`);
  }
  return value;
}

function step(token: string, unit: Unit): number {
  if (!/^\d{1,2}$/.test(token) || Number(token) < 1) {
    throw new Unreadable(`"${token}" is not a step for the ${unit.label}.`);
  }
  return Number(token);
}

function parsePart(raw: string, unit: Unit): Part {
  const token = raw.trim();
  if (token === '') throw new Unreadable(`the ${unit.label} is empty.`);

  /* The last-day family, which only the two day fields have. */
  if (unit === DAY_OF_MONTH) {
    if (/^L$/i.test(token)) return { kind: 'lastDay', back: 0 };
    if (/^LW$/i.test(token)) return { kind: 'lastWorkday' };
    const back = /^L-(\d{1,2})$/i.exec(token);
    if (back !== null) return { kind: 'lastDay', back: Number(back[1]) };
  }
  if (unit === DAY_OF_WEEK) {
    const last = /^(.+)L$/i.exec(token);
    if (last !== null) return { kind: 'lastWeekday', day: number(last[1], unit) % 7 };
    const nth = /^(.+)#(\d)$/.exec(token);
    if (nth !== null) {
      const which = Number(nth[2]);
      if (which < 1 || which > 5) throw new Unreadable(`"${token}" names no such week of the month.`);
      return { kind: 'nthWeekday', day: number(nth[1], unit) % 7, nth: which };
    }
  }

  const [head, tail, ...rest] = token.split('/');
  if (rest.length > 0) throw new Unreadable(`"${token}" has two steps in it.`);
  const every = tail === undefined ? null : step(tail, unit);

  if (head === '*' || head === '?') return { kind: 'all', step: every };

  const span = /^([^-]+)-(.+)$/.exec(head);
  if (span !== null) {
    return { kind: 'range', from: number(span[1], unit), to: number(span[2], unit), step: every };
  }

  const at = number(head, unit);
  return every === null ? { kind: 'one', value: at } : { kind: 'from', from: at, step: every };
}

function parseField(raw: string, unit: Unit): Part[] {
  return raw.split(',').map((part) => parsePart(part, unit));
}

/** Every value a field names, or null when a part of it does not name values. */
function values(parts: Part[], unit: Unit): number[] | null {
  const out = new Set<number>();
  for (const part of parts) {
    if (part.kind === 'all') {
      for (let value = unit.min; value <= unit.max; value += part.step ?? 1) out.add(value);
    } else if (part.kind === 'range') {
      const by = part.step ?? 1;
      if (part.from <= part.to) {
        for (let value = part.from; value <= part.to; value += by) out.add(value);
      } else {
        // Spring lets a range wrap: FRI-MON is Friday, Saturday, Sunday, Monday.
        for (let value = part.from; value <= unit.max; value += by) out.add(value);
        for (let value = unit.min; value <= part.to; value += by) out.add(value);
      }
    } else if (part.kind === 'from') {
      for (let value = part.from; value <= unit.max; value += part.step) out.add(value);
    } else if (part.kind === 'one') {
      out.add(part.value);
    } else {
      return null;
    }
  }
  return [...out].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------- shapes */

/**
 * A field boiled down to the one thing that decides how it is worded. Anything
 * that does not fit one of these - a list with a range in it, a last-weekday -
 * is `other`, and worded from its parts instead.
 */
type Shape =
  | { kind: 'all' }
  | { kind: 'step'; step: number; from: number | null; to: number | null }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'one'; value: number }
  | { kind: 'list'; values: number[] }
  | { kind: 'other' };

function shapeOf(parts: Part[]): Shape {
  if (parts.length === 1) {
    const only = parts[0];
    if (only.kind === 'all') {
      return only.step === null ? { kind: 'all' } : { kind: 'step', step: only.step, from: null, to: null };
    }
    if (only.kind === 'from') return { kind: 'step', step: only.step, from: only.from, to: null };
    if (only.kind === 'range') {
      return only.step === null
        ? { kind: 'range', from: only.from, to: only.to }
        : { kind: 'step', step: only.step, from: only.from, to: only.to };
    }
    if (only.kind === 'one') return { kind: 'one', value: only.value };
    return { kind: 'other' };
  }
  if (parts.every((part) => part.kind === 'one')) {
    return { kind: 'list', values: parts.map((part) => (part.kind === 'one' ? part.value : 0)) };
  }
  return { kind: 'other' };
}

const unrestricted = (shape: Shape) => shape.kind === 'all';
const zero = (shape: Shape) => shape.kind === 'one' && shape.value === 0;

/* ------------------------------------------------------------------- wording */

function join(words: string[]): string {
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${count} ${noun}s`;
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const ones = value % 10;
  return `${value}${ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'}`;
}

const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

const pad = (value: number) => String(value).padStart(2, '0');

function clock(hour: number, minute: number, second: number): string {
  return second === 0 ? `${pad(hour)}:${pad(minute)}` : `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** How often a step happens, with whatever window it is held inside. */
function everyStep(shape: Extract<Shape, { kind: 'step' }>, noun: string): string {
  const how = `Every ${plural(shape.step, noun)}`;
  if (shape.from !== null && shape.to !== null) return `${how} between ${shape.from} and ${shape.to}`;
  if (shape.from !== null && shape.from !== 0) return `${how} from ${shape.from}`;
  return how;
}

/** A field's values as words, for the sentences that cannot be more specific. */
function counted(shape: Shape, parts: Part[], noun: string): string {
  switch (shape.kind) {
    case 'all':
      return `every ${noun}`;
    case 'step':
      return `every ${ordinal(shape.step)} ${noun}`;
    case 'range':
      return `${noun}s ${shape.from} to ${shape.to}`;
    case 'one':
      return `${noun} ${shape.value}`;
    case 'list':
      return `${noun}s ${join(shape.values.map(String))}`;
    default:
      return `${noun}s ${parts.length} ways`;
  }
}

/** The time of day half of the sentence. */
function timeWords(second: Part[], minute: Part[], hour: Part[]): string {
  const s = shapeOf(second);
  const m = shapeOf(minute);
  const h = shapeOf(hour);

  /** The values a field names outright, or null when it names them another way. */
  const named = (shape: Shape) => (shape.kind === 'one' ? [shape.value] : shape.kind === 'list' ? shape.values : null);
  /** A field naming nothing but zero is not a rate; it is the top of the unit above. */
  const onlyZero = (shape: Shape) => zero(shape);

  if (unrestricted(h) && unrestricted(m)) {
    if (unrestricted(s)) return 'Every second';
    if (s.kind === 'step') return everyStep(s, 'second');
    const at = named(s);
    if (at !== null && !onlyZero(s)) return `At ${join(at.map(String))} seconds past every minute`;
  }

  if (zero(s) && unrestricted(h)) {
    if (unrestricted(m)) return 'Every minute';
    if (m.kind === 'step') return everyStep(m, 'minute');
    const at = named(m);
    if (at !== null) {
      return onlyZero(m) ? 'Every hour, on the hour' : `At ${join(at.map(String))} minutes past every hour`;
    }
  }

  if (zero(s) && zero(m)) {
    if (h.kind === 'step') return everyStep(h, 'hour');
    // A working day rather than nine separate times: "09:00, 10:00, 11:00…".
    if (h.kind === 'range') return `Every hour from ${pad(h.from)}:00 to ${pad(h.to)}:00`;
  }

  /*
   * A handful of wall-clock times, which is what a schedule usually is. Held to
   * six: a list crossed with a list is a sentence nobody reads, and "minutes 0
   * and 30 past hours 9 to 17" says the same thing in one line.
   */
  if (s.kind === 'one') {
    const hours = h.kind === 'one' ? [h.value] : h.kind === 'list' ? h.values : null;
    const minutes = m.kind === 'one' ? [m.value] : m.kind === 'list' ? m.values : null;
    if (hours !== null && minutes !== null && hours.length * minutes.length <= 6) {
      return `At ${join(hours.flatMap((at) => minutes.map((past) => clock(at, past, s.value))))}`;
    }
  }

  const past = `At ${counted(m, minute, 'minute')} past ${counted(h, hour, 'hour')}`;
  return zero(s) ? past : `${past}, at ${counted(s, second, 'second')}`;
}

function dayOfMonthWords(shape: Shape, parts: Part[]): string {
  if (parts.length === 1) {
    const only = parts[0];
    if (only.kind === 'lastDay') {
      return only.back === 0 ? 'the last day' : `the ${ordinal(only.back)}-to-last day`;
    }
    if (only.kind === 'lastWorkday') return 'the last weekday';
  }
  switch (shape.kind) {
    case 'step':
      return `every ${ordinal(shape.step)} day`;
    case 'range':
      return `the ${ordinal(shape.from)} to the ${ordinal(shape.to)}`;
    case 'one':
      return `the ${ordinal(shape.value)}`;
    case 'list':
      return `the ${join(shape.values.map(ordinal))}`;
    default:
      return 'the days it names';
  }
}

function monthWords(shape: Shape): string {
  switch (shape.kind) {
    case 'step':
      return `every ${ordinal(shape.step)} month`;
    case 'range':
      return `${MONTH_OF[shape.from - 1]} to ${MONTH_OF[shape.to - 1]}`;
    case 'one':
      return MONTH_OF[shape.value - 1];
    case 'list':
      return join(shape.values.map((at) => MONTH_OF[at - 1]));
    default:
      return 'the months it names';
  }
}

function dayOfWeekWords(shape: Shape, parts: Part[]): string {
  if (parts.length === 1) {
    const only = parts[0];
    if (only.kind === 'lastWeekday') return `on the last ${WEEKDAY[only.day]} of the month`;
    if (only.kind === 'nthWeekday') return `on the ${NTH[only.nth]} ${WEEKDAY[only.day]} of the month`;
  }
  // 7 is Sunday as surely as 0 is, so both land on the same name.
  const named = (at: number) => WEEKDAY[at % 7];
  switch (shape.kind) {
    case 'step':
      return `on every ${ordinal(shape.step)} day of the week`;
    case 'range':
      return `${named(shape.from)} to ${named(shape.to)}`;
    case 'one':
      return `on ${named(shape.value)}s`;
    case 'list':
      return `on ${join(shape.values.map((at) => `${named(at)}s`))}`;
    default:
      return 'on the days it names';
  }
}

/* ---------------------------------------------------------------- the answer */

/**
 * What the expression does, in English.
 *
 * Never stale: every answer is computed from the string handed in, so a field
 * mid-edit reads as unreadable rather than as whatever it last parsed to. A
 * description that lags the field is a description that lies.
 */
export function describeCron(expression: string): CronReading {
  const typed = expression.trim();
  if (typed === '') return { state: 'empty', text: 'A schedule reads back here as it is typed.' };

  const expanded = MACROS[typed.toLowerCase()] ?? typed;
  const fields = expanded.split(/\s+/);
  /*
   * Five fields are read from the minute, exactly as `sixField` on the server
   * reads them: it prepends a zero second rather than treating the expression
   * as a different dialect.
   */
  const six = fields.length === 5 ? ['0', ...fields] : fields;
  if (six.length !== 6) {
    return {
      state: 'unreadable',
      text: `Not a schedule: ${six.length} ${six.length === 1 ? 'field' : 'fields'}. A cron has six, seconds first, or five read from the minute.`,
    };
  }

  let second: Part[];
  let minute: Part[];
  let hour: Part[];
  let dayOfMonth: Part[];
  let month: Part[];
  let dayOfWeek: Part[];
  try {
    second = parseField(six[0], SECOND);
    minute = parseField(six[1], MINUTE);
    hour = parseField(six[2], HOUR);
    dayOfMonth = parseField(six[3], DAY_OF_MONTH);
    month = parseField(six[4], MONTH);
    dayOfWeek = parseField(six[5], DAY_OF_WEEK);
  } catch (wrong) {
    const why = wrong instanceof Unreadable ? wrong.message : 'it cannot be read.';
    return { state: 'unreadable', text: `Not a schedule: ${why}` };
  }

  /*
   * Whether it ever comes round. Only the date is asked, because that is the
   * whole of the class the server refuses: "0 0 30 2 *" is the thirtieth of
   * February, it parses, and waiting is otherwise the only way to find out.
   */
  const days = values(dayOfMonth, DAY_OF_MONTH);
  const months = values(month, MONTH);
  if (days !== null && months !== null && !months.some((at) => days.some((day) => day <= LONGEST[at - 1]))) {
    const only = months.length === 1 ? MONTH_OF[months[0] - 1] : 'no month it names';
    const soonest = Math.min(...days);
    return {
      state: 'unreachable',
      text:
        months.length === 1
          ? `This never comes round: ${only} has no ${ordinal(soonest)}.`
          : `This never comes round: ${only} is ever that long.`,
    };
  }

  const dayShape = shapeOf(dayOfMonth);
  const monthShape = shapeOf(month);
  const weekShape = shapeOf(dayOfWeek);
  const onDays = !unrestricted(dayShape);
  const inMonths = !unrestricted(monthShape);
  const onWeekdays = !unrestricted(weekShape);

  let date = '';
  if (onDays) {
    date = ` on ${dayOfMonthWords(dayShape, dayOfMonth)} of ${inMonths ? monthWords(monthShape) : 'every month'}`;
  } else if (inMonths) {
    date = ` in ${monthWords(monthShape)}`;
  }
  if (onWeekdays) {
    /*
     * Spring asks both day fields, so a schedule naming a date *and* a weekday
     * fires on neither alone. "but only" is the difference between the two
     * readings, and it is the whole of what somebody would otherwise get wrong.
     */
    date += onDays ? `, but only ${dayOfWeekWords(weekShape, dayOfWeek)}` : `, ${dayOfWeekWords(weekShape, dayOfWeek)}`;
  }

  const time = timeWords(second, minute, hour);
  /*
   * "At 02:00" leaves somebody wondering which days, so it is told. "Every 10
   * seconds" and "At 15 minutes past every hour" do not - the hour is already
   * unrestricted there, and "every day" after either says nothing they did not.
   */
  if (date === '' && time.startsWith('At ') && !unrestricted(shapeOf(hour))) date = ' every day';

  return { state: 'reading', text: `${time}${date}` };
}
