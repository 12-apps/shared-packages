export { DateRangePicker, DateRangePicker as default } from './DateRangePicker';
export {
  createQuickRanges,
  DEFAULT_QUICK_RANGE_LABELS,
  DEFAULT_QUICK_RANGES,
  QUICK_RANGE_IDS,
  type QuickRangeId,
} from './DateRangePicker.quick';
// The verdict the picker shows, exported so a caller's confirm button reads the
// SAME answer instead of re-deriving it from the two strings.
export { resolveDayRange } from './DateRangePicker.range';
export type {
  DateRangeChangeMeta,
  DateRangeDraft,
  DateRangePickerMessages,
  DateRangePickerProps,
  DateRangeProblem,
  DateRangeStatus,
  DayString,
  DayWindow,
  QuickRange,
  QuickRangeContext,
  ResolvedQuickRange,
  WeekStart,
} from './DateRangePicker.types';
