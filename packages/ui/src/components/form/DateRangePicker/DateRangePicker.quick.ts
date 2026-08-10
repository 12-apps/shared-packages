/**
 * The quick-pick column's default list, and how to relabel it.
 *
 * These are DOMAIN-FREE on purpose: every one of them is derivable from "today"
 * and the calendar, so the design system can ship them without knowing what the
 * range is for. A product's own periods (a fiscal quarter, "since the store
 * opened", the last closed month) are a `quickRanges` array the caller passes —
 * the prop exists so that list never has to be smuggled in here.
 *
 * "Last N days" INCLUDES today, which is the reading every dashboard in the
 * wild uses: on the 10th, "last 7 days" is the 4th through the 10th, not the
 * 3rd through the 9th.
 */
import {
  shiftDay,
  startOfMonthDay,
  startOfQuarterDay,
  startOfWeekDay,
  startOfYearDay,
} from './DateRangePicker.dates';
import type { QuickRange, QuickRangeContext } from './DateRangePicker.types';

/**
 * The ids the built-in list uses. Stable API: a caller keys off these to map a
 * quick pick onto something of its own (a stored preset, an event name), and
 * renaming one is a breaking change in a way that renaming a label is not.
 */
export const QUICK_RANGE_IDS = [
  'today',
  'yesterday',
  'this-week',
  'last-7-days',
  'this-month',
  'last-30-days',
  'this-quarter',
  'this-year',
  'last-365-days',
] as const;

export type QuickRangeId = (typeof QUICK_RANGE_IDS)[number];

/** English defaults. Every one is replaceable through {@link createQuickRanges}. */
export const DEFAULT_QUICK_RANGE_LABELS: Record<QuickRangeId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  'last-7-days': 'Last 7 days',
  'this-month': 'This month',
  'last-30-days': 'Last 30 days',
  'this-quarter': 'This quarter',
  'this-year': 'This year',
  'last-365-days': 'Last 365 days',
};

/** A window that ends today and reaches back `days` days, today included. */
const trailing =
  (days: number) =>
  ({ today }: QuickRangeContext) => ({ from: shiftDay(today, 1 - days), to: today });

/** A window from the start of some period through today. */
const sinceStartOf =
  (start: (context: QuickRangeContext) => string) => (context: QuickRangeContext) => ({
    from: start(context),
    to: context.today,
  });

const RESOLVERS: Record<QuickRangeId, QuickRange['resolve']> = {
  today: trailing(1),
  yesterday: ({ today }) => ({ from: shiftDay(today, -1), to: shiftDay(today, -1) }),
  'this-week': sinceStartOf(({ today, weekStartsOn }) => startOfWeekDay(today, weekStartsOn)),
  'last-7-days': trailing(7),
  'this-month': sinceStartOf(({ today }) => startOfMonthDay(today)),
  'last-30-days': trailing(30),
  'this-quarter': sinceStartOf(({ today }) => startOfQuarterDay(today)),
  'this-year': sinceStartOf(({ today }) => startOfYearDay(today)),
  'last-365-days': trailing(365),
};

/**
 * The built-in quick ranges, optionally relabelled.
 *
 * Relabelling rather than rebuilding is the point: a Portuguese host wants
 * "Este mês" over the same month-to-date arithmetic, and re-deriving the dates
 * to get the word is how two lists that claim the same thing start disagreeing.
 */
export function createQuickRanges(
  labels: Partial<Record<QuickRangeId, string>> = {},
): QuickRange[] {
  return QUICK_RANGE_IDS.map((id) => ({
    id,
    label: labels[id] ?? DEFAULT_QUICK_RANGE_LABELS[id],
    resolve: RESOLVERS[id],
  }));
}

/** The list a picker uses when the caller says nothing. */
export const DEFAULT_QUICK_RANGES: QuickRange[] = createQuickRanges();
