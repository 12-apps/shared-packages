import { ReportBuilderError } from '../errors';

/**
 * The period a report runs over (FUT-391) — calendar arithmetic, moved here
 * from the host along with the endpoints that use it.
 *
 * It has to travel with them. Every read route resolves a window, scopes the
 * adapter to it and echoes it back on the wire; a host left holding this math
 * would be re-deriving half of a contract whose other half already lives in
 * this package, which is exactly the split the port exists to close.
 *
 * Two invariants everything downstream leans on:
 *
 *  1. **Half-open windows.** Every window is `[from, toExclusive)`. Consecutive
 *     windows tile the timeline, so a row on the seam is counted once.
 *  2. **Calendar days on a STATED clock.** A "day" is midnight-to-midnight on
 *     the tenant's IANA zone, not on UTC. Date buckets are truncated on that
 *     same clock, and a window that disagreed with its buckets would describe a
 *     different period from the one it names: a São Paulo restaurant's "hoje"
 *     resolved on UTC runs 21:00 yesterday → 21:00 today, which moves peak
 *     dinner service into tomorrow's report. Threading the zone into the run
 *     but not into the window changes nothing at all — both ends have to name
 *     the same clock for either to matter.
 */

/** The period presets the reports surface offers. */
export const REPORT_RANGE_PRESETS = ['today', '7d', '30d', 'custom'] as const;
export type ReportRangePreset = (typeof REPORT_RANGE_PRESETS)[number];

/**
 * The longest custom window that will resolve. A daily series over a year is
 * 366 points — enough for any report, and a hard bound on the response an
 * agent or a hand-written query string can ask for.
 */
export const REPORT_MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many trailing calendar days each rolling preset covers (today included). */
const PRESET_DAYS: Record<Exclude<ReportRangePreset, 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
};

/** The requested period: a preset, or `custom` with inclusive calendar bounds. */
export interface ReportRangeInput {
  preset: ReportRangePreset;
  /** `YYYY-MM-DD`, inclusive — required (and only used) when preset is custom. */
  from?: string;
  /** `YYYY-MM-DD`, inclusive — required (and only used) when preset is custom. */
  to?: string;
}

/** A resolved half-open window, with the preset that produced it. */
export interface ResolvedReportRange {
  preset: ReportRangePreset;
  /** Inclusive start. */
  from: Date;
  /** Exclusive end. */
  toExclusive: Date;
}

/** The window a DataSource scopes its reads to — `ReportWindow`'s two fields. */
export interface ReportRangeView {
  preset: string;
  from: string;
  toExclusive: string;
}

/** A civil (wall-clock) calendar date, with no instant attached to it. */
interface CivilDay {
  year: number;
  month: number;
  day: number;
}

const civilFormatters = new Map<string, Intl.DateTimeFormat>();

function civilFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = civilFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  civilFormatters.set(timeZone, created);
  return created;
}

/** How far `timeZone`'s wall clock is ahead of UTC at this instant, in ms. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = civilFormatter(timeZone).formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant `civil` midnight begins on `timeZone`'s clock (UTC when absent).
 *
 * Two passes, because the offset to subtract depends on the instant being
 * solved for: the first guess reads the offset at the same wall time taken as
 * UTC, the second re-reads it at the candidate. They differ only across a DST
 * transition — `America/Sao_Paulo` has had none since 2019 — and the second
 * pass is what keeps this honest for a zone that still does.
 */
function startOfCivilDay(civil: CivilDay, timeZone: string | undefined): Date {
  const asUtc = Date.UTC(civil.year, civil.month - 1, civil.day);
  if (!timeZone) return new Date(asUtc);
  const firstGuess = new Date(asUtc - zoneOffsetMs(new Date(asUtc), timeZone));
  return new Date(asUtc - zoneOffsetMs(firstGuess, timeZone));
}

/** The civil date `instant` falls on, on `timeZone`'s clock (default UTC). */
function civilDayOf(instant: Date, timeZone: string | undefined): CivilDay {
  const local = timeZone ? new Date(instant.getTime() + zoneOffsetMs(instant, timeZone)) : instant;
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
}

/** The same civil date `days` later — plain calendar arithmetic, DST-free. */
function civilDayPlus(civil: CivilDay, days: number): CivilDay {
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Parse a `YYYY-MM-DD` bound into a civil date; NaN parts on malformed input. */
function parseCivilDay(date: string): CivilDay {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? Number.NaN, month: month ?? Number.NaN, day: day ?? Number.NaN };
}

/** The instant an inclusive `YYYY-MM-DD` bound BEGINS, on the given clock. */
export function startOfDay(date: string, timeZone?: string): Date {
  return startOfCivilDay(parseCivilDay(date), timeZone);
}

/**
 * The instant the day AFTER an inclusive `YYYY-MM-DD` bound begins — the
 * EXCLUSIVE upper bound. A row at 23:59 on the last day is inside the window;
 * midnight of the next day is not.
 */
export function startOfNextDay(date: string, timeZone?: string): Date {
  return startOfCivilDay(civilDayPlus(parseCivilDay(date), 1), timeZone);
}

/**
 * An incoherent period is the CALLER's mistake, so it carries the same error
 * type a bad spec does and folds to the same 400 — a period the caller can fix
 * from the message, not a server fault.
 */
function invalidRange(message: string): ReportBuilderError {
  return new ReportBuilderError('invalid_range', message);
}

/** Resolve `custom`'s inclusive `from`/`to` days into a half-open window. */
function resolveCustomWindow(
  input: ReportRangeInput,
  timeZone: string | undefined,
): { from: Date; toExclusive: Date } {
  if (!input.from || !input.to) {
    throw invalidRange('Informe as datas inicial e final do período.');
  }
  const from = startOfDay(input.from, timeZone);
  // `to` is an INCLUSIVE calendar day, so the exclusive bound is the next
  // midnight — a row at 23:59 on the last day still counts.
  const toExclusive = startOfNextDay(input.to, timeZone);
  if (Number.isNaN(from.getTime()) || Number.isNaN(toExclusive.getTime())) {
    throw invalidRange('Data inválida.');
  }
  if (toExclusive <= from) {
    throw invalidRange('A data final deve ser igual ou posterior à inicial.');
  }
  if (toExclusive.getTime() - from.getTime() > REPORT_MAX_RANGE_DAYS * DAY_MS) {
    throw invalidRange(`O período não pode exceder ${REPORT_MAX_RANGE_DAYS} dias.`);
  }
  return { from, toExclusive };
}

/** A rolling preset's window: N calendar days ending at the next midnight. */
function resolveRollingWindow(
  preset: Exclude<ReportRangePreset, 'custom'>,
  now: Date,
  timeZone: string | undefined,
): { from: Date; toExclusive: Date } {
  const today = civilDayOf(now, timeZone);
  return {
    from: startOfCivilDay(civilDayPlus(today, 1 - PRESET_DAYS[preset]), timeZone),
    toExclusive: startOfCivilDay(civilDayPlus(today, 1), timeZone),
  };
}

/**
 * Resolve a requested period into the window a report runs over.
 *
 * Rolling presets end at the NEXT midnight, so the current (partial) day is
 * always fully inside the window — "7d" means today plus the six days before
 * it, never six-and-a-bit.
 */
export function resolveReportRange(
  input: ReportRangeInput,
  now: Date,
  timeZone?: string,
): ResolvedReportRange {
  const window =
    input.preset === 'custom'
      ? resolveCustomWindow(input, timeZone)
      : resolveRollingWindow(input.preset, now, timeZone);
  return { preset: input.preset, ...window };
}

/** The resolved window as echoed on the wire. */
export function toReportRangeView(range: ResolvedReportRange): ReportRangeView {
  return {
    preset: range.preset,
    from: range.from.toISOString(),
    toExclusive: range.toExclusive.toISOString(),
  };
}

/**
 * Read a period off a request's query string. Absent/unknown values fall back
 * to the schema's defaults rather than rejecting: the query is the host
 * framework's raw strings here, and a report with no `?preset=` is the
 * builder's first load, not an error.
 */
export function rangeFromQuery(query: Record<string, string | undefined>): ReportRangeInput {
  const preset = REPORT_RANGE_PRESETS.find((candidate) => candidate === query.preset) ?? '30d';
  return {
    preset,
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
  };
}
