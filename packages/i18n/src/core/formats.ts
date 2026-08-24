/**
 * Numbers, money and dates as ONE locale's reader expects them — and as that
 * same reader would type them back.
 *
 * This is the SECOND axis of the same job, and it is not the copy axis. "12,5"
 * is not a translation of "12.5"; it is the same number written for a different
 * reader. A package that assumes one of them cannot be adopted by the other
 * even after every sentence it renders has moved to a pack — which is why
 * `@12-apps/discounts` had to solve this for itself before this module existed,
 * and why what it worked out is what is generalised here.
 *
 * Three things it insists on, each because the alternative was a real defect:
 *
 * - **The formatters are built ONCE per surface.** `Intl` constructors are
 *   expensive enough that building one per cell is measurable on a table of
 *   eight columns.
 * - **The decimal and group separators are READ from `Intl`, never assumed.**
 *   It is the only way `"1.234,56"` and `"1,234.56"` can both be parsed
 *   correctly, and parsing is the half that gets forgotten: a form takes what
 *   the operator typed, in their own notation, and `Number("12,5")` is `NaN`.
 * - **CURRENCY IS NOT LANGUAGE.** An English-reading admin of a Brazilian store
 *   still sees BRL. The two arrive as separate options for that reason, and the
 *   currency has no default — a wrong currency is a wrong PRICE, which is the
 *   one error here that costs money rather than clarity.
 */
import { type Locale } from './locale';

/** What a surface renders for "nothing here", shared so it stays one glyph. */
export const EMPTY = '—';

export interface FormatOptions {
  /** Which reader's notation. */
  locale: Locale;
  /**
   * ISO-4217 for {@link Formats.money}. No default: see the docstring — a
   * currency guessed from the language is a wrong price, silently.
   */
  currency: string;
  /**
   * The zone {@link Formats.dateTime} renders an instant in. Defaults to
   * whatever the runtime is set to, which is right for a browser and is the
   * thing a server must state.
   */
  timeZone?: string;
}

export interface Formats {
  /** Minor units (cents) as money, or {@link EMPTY}. */
  money(minorUnits: number | null | undefined): string;
  /** A plain number, or {@link EMPTY}. */
  number(value: number | null | undefined, fractionDigits?: number): string;
  /** Basis points as a percentage (`1250` -> `12,5%`), or {@link EMPTY}. */
  percent(basisPoints: number | null | undefined): string;
  /**
   * An ISO instant as a CALENDAR date, read in UTC.
   *
   * UTC on purpose, and this is the one default here that is not the obvious
   * one: a date column holds a calendar day at UTC midnight, so formatting it
   * in the reader's own zone shows anyone west of Greenwich the day before the
   * one that was typed. Use {@link Formats.dateTime} for a real instant.
   */
  date(iso: string | null | undefined): string;
  /** An ISO instant as a date and time, in {@link FormatOptions.timeZone}. */
  dateTime(iso: string | null | undefined): string;
  /** What the operator typed, as a number. `null` for blank or unreadable. */
  parseDecimal(typed: string): number | null;
  /** A number as the operator would type it back (`12.5` -> `12,5`). */
  toInput(value: number): string;
  /** The separator this locale writes, exposed for input masks. */
  readonly decimalSeparator: string;
}

/** One `Intl` part of a formatted sample, or a fallback when the part is absent. */
function separator(locale: Locale, sample: number, type: 'decimal' | 'group', fallback: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(sample);
  return parts.find((part) => part.type === type)?.value ?? fallback;
}

/** An ISO string as a `Date`, or `null` when it is not one. */
function parseInstant(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const PERCENT_FRACTION_DIGITS = 2;
const MINOR_UNITS_PER_MAJOR = 100;
const BASIS_POINTS_PER_PERCENT = 100;

/** Every formatter one surface needs, built once. */
export function createFormats({ locale, currency, timeZone }: FormatOptions): Formats {
  const moneyFormat = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const percentFormat = new Intl.NumberFormat(locale, {
    maximumFractionDigits: PERCENT_FRACTION_DIGITS,
  });
  const decimal = separator(locale, 1.1, 'decimal', '.');
  const group = separator(locale, 1000, 'group', ',');

  const numberFormat = (fractionDigits?: number) =>
    fractionDigits === undefined
      ? percentFormat
      : new Intl.NumberFormat(locale, {
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        });

  return {
    decimalSeparator: decimal,

    money: (minorUnits) =>
      minorUnits === null || minorUnits === undefined
        ? EMPTY
        : moneyFormat.format(minorUnits / MINOR_UNITS_PER_MAJOR),

    number: (value, fractionDigits) =>
      value === null || value === undefined ? EMPTY : numberFormat(fractionDigits).format(value),

    percent: (basisPoints) =>
      basisPoints === null || basisPoints === undefined
        ? EMPTY
        : `${percentFormat.format(basisPoints / BASIS_POINTS_PER_PERCENT)}%`,

    date: (iso) => {
      const parsed = parseInstant(iso);
      if (!parsed) return iso ?? EMPTY;
      return parsed.toLocaleDateString(locale, { timeZone: 'UTC' });
    },

    dateTime: (iso) => {
      const parsed = parseInstant(iso);
      if (!parsed) return iso ?? EMPTY;
      return parsed.toLocaleString(locale, timeZone ? { timeZone } : undefined);
    },

    parseDecimal: (typed) => {
      const normalized = typed.trim().split(group).join('').replace(decimal, '.');
      if (normalized === '') return null;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    },

    toInput: (value) => String(value).replace('.', decimal),
  };
}
