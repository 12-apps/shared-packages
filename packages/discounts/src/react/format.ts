import { discountWindowState, type DiscountWindowState } from "../engine/kinds";
import type { DiscountSchedule } from "../engine/schedule";

import { fill, type DiscountsWebCopy } from "./copy";
import { formatScheduleCell } from "./schedule-summary";

/**
 * Money, percentages and dates — as ONE locale's reader expects them, and as
 * that same reader would type them back.
 *
 * The origin hard-coded `pt-BR` and `BRL` in five places, which is the shape of
 * copy leaking into logic: the number "12,5" is not a translation of "12.5", it
 * is the same number written for a different reader, and a package that assumes
 * one of them cannot be adopted by the other. So the locale and the currency
 * arrive as config, and the FORMATTERS ARE BUILT ONCE per surface — `Intl`
 * constructors are expensive enough that building one per cell is a measurable
 * cost on a page of eight columns.
 *
 * Parsing is the half that is easy to forget. A form takes what the operator
 * typed, in their own notation, and a `Number("12,5")` is `NaN` — so the
 * decimal separator is DERIVED from the locale rather than assumed, which is
 * the only way "1.234,56" and "1,234.56" can both be read correctly.
 */

/** The dash a surface renders for "nothing here", shared so it stays one glyph. */
export const EMPTY = "—";

export interface DiscountsFormatters {
  /** Integer cents as money, or {@link EMPTY}. */
  money(cents: number | null): string;
  /** Basis points as a percentage ("1250" → "12,5%"), or {@link EMPTY}. */
  percent(basisPoints: number | null): string;
  /** An ISO instant as a calendar date, read in UTC — see below. */
  date(iso: string | null): string;
  /** What the operator typed, as a number. `null` for blank or unreadable. */
  parseDecimal(typed: string): number | null;
  /** A number as the operator would type it back ("12.5" → "12,5"). */
  toInput(value: number): string;
}

/** The decimal separator this locale writes, read from `Intl` rather than guessed. */
function decimalSeparator(locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
  return parts.find((part) => part.type === "decimal")?.value ?? ".";
}

/** The group separator, which must be STRIPPED before a parse, not replaced. */
function groupSeparator(locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(1_000);
  return parts.find((part) => part.type === "group")?.value ?? ",";
}

export function createFormatters(locale: string, currency: string): DiscountsFormatters {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency });
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const decimal = decimalSeparator(locale);
  const group = groupSeparator(locale);

  return {
    money: (cents) => (cents === null ? EMPTY : money.format(cents / 100)),
    percent: (basisPoints) =>
      basisPoints === null ? EMPTY : `${percent.format(basisPoints / 100)}%`,
    /**
     * Read in UTC on purpose. The column holds a CALENDAR date at UTC midnight,
     * so formatting it in the browser's zone would show a store west of
     * Greenwich the day before the one they typed — a promotion that appears to
     * start yesterday.
     */
    date: (iso) => {
      if (iso === null) return EMPTY;
      const parsed = new Date(iso);
      if (Number.isNaN(parsed.getTime())) return iso;
      return parsed.toLocaleDateString(locale, { timeZone: "UTC" });
    },
    parseDecimal: (typed) => {
      const normalized = typed
        .trim()
        .split(group)
        .join("")
        .replace(decimal, ".");
      if (normalized === "") return null;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    },
    toInput: (value) => String(value).replace(".", decimal),
  };
}

/** What a rule takes off, as an operator reads it. */
export function formatDiscountValue(
  row: { type: string; percentOffBp: number | null; amountOffCents: number | null; bundlePriceCents?: number | null },
  formatters: DiscountsFormatters,
): string {
  if (row.type === "PERCENTAGE") return formatters.percent(row.percentOffBp);
  if (row.type === "BUNDLE_PRICE") return formatters.money(row.bundlePriceCents ?? null);
  if (row.type === "FREE_UNITS") return EMPTY;
  return formatters.money(row.amountOffCents);
}

/**
 * The active window as a SENTENCE, in whichever of the four shapes applies.
 *
 * All four get their own phrasing because a dash on one side would leave the
 * operator guessing whether the promotion has no start or no end — and those
 * mean very different things when it is not running yet.
 */
export function formatWindow(
  row: { startsAt: string | null; endsAt: string | null; schedule?: DiscountSchedule | null },
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): string {
  const period = formatPeriod(row, formatters, copy);
  const schedule = formatScheduleCell(row.schedule, copy);
  // Both facts in one cell (FUT-996): the campaign period answers "for how
  // long", the schedule answers "and when within that", and a cell showing only
  // the first would say a happy hour runs all day for three months.
  return schedule === null ? period : fill(copy.schedule.windowWithSchedule, { window: period, schedule });
}

function formatPeriod(
  row: { startsAt: string | null; endsAt: string | null },
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): string {
  const { startsAt, endsAt } = row;
  if (startsAt === null && endsAt === null) return copy.window.always;
  if (endsAt === null) return fill(copy.window.from, { date: formatters.date(startsAt) });
  if (startsAt === null) return fill(copy.window.until, { date: formatters.date(endsAt) });
  return fill(copy.window.between, {
    from: formatters.date(startsAt),
    to: formatters.date(endsAt),
  });
}

/** Where a rule sits relative to its window — the engine's predicate, re-exported. */
export function windowStateOf(
  row: { startsAt: string | null; endsAt: string | null },
  now: Date,
): DiscountWindowState {
  return discountWindowState(row, now);
}
