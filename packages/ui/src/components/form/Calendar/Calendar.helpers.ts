import type { CalendarProps, ResolvedCalendarProps } from './Calendar.types';

const CALENDAR_DEFAULTS = {
  selectionMode: 'single',
  value: null,
  range: { start: null, end: null },
  firstDayOfWeek: 0,
  locale: 'en-US',
  showOutsideDays: true,
  minRangeLength: 1,
  allowSameDayRange: true,
  autoFocus: false,
} as const satisfies Partial<CalendarProps>;

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: CalendarProps): Partial<CalendarProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<CalendarProps>;

// Applied as a merge rather than destructuring defaults, which would otherwise
// put nine branches into the component's own complexity budget.
export const resolveCalendarProps = (props: CalendarProps): ResolvedCalendarProps => {
  const merged = { ...CALENDAR_DEFAULTS, ...definedProps(props) } as ResolvedCalendarProps;

  // A range needs two months side by side to be picked comfortably; a single
  // date does not.
  const defaultMonths = merged.selectionMode === 'range' ? 2 : 1;

  return { ...merged, monthsToShow: merged.numberOfMonths ?? defaultMonths };
};
