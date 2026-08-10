/**
 * Judging a draft, and saying so in words.
 *
 * The picker never repairs what it is given. A reversed pair is not silently
 * swapped and an over-long one is not clipped to the cap: both are reported,
 * because a control that returns a different range from the one on screen is
 * indistinguishable from one that ignored you. The caller reads
 * {@link DateRangeStatus} and keeps its own confirm button shut.
 */
import { isoToBr } from '../../data-display/DataViews/data-views-day-input';

import { dayCount, isAfterDay } from './DateRangePicker.dates';
import type {
  DateRangePickerMessages,
  DateRangeDraft,
  DateRangeStatus,
  QuickRange,
  QuickRangeContext,
  ResolvedQuickRange,
} from './DateRangePicker.types';

/**
 * Whether a draft is a window this picker will hand over.
 *
 * Exported because the caller needs the same verdict the picker shows: a dialog
 * disabling its "Apply" button must not re-derive "is this legal" from the two
 * strings, or the two answers drift and the button ends up enabled over a
 * message saying the range is impossible.
 */
export function resolveDayRange(
  draft: DateRangeDraft,
  maxRangeDays?: number,
): DateRangeStatus {
  const { from, to } = draft;
  if (!from || !to) return { ok: false, problem: 'incomplete', days: 0 };
  if (isAfterDay(from, to)) return { ok: false, problem: 'reversed', days: 0 };

  const days = dayCount(from, to);
  if (maxRangeDays !== undefined && days > maxRangeDays) {
    return { ok: false, problem: 'over-max', days };
  }
  return { ok: true, window: { from, to }, days };
}

/**
 * The English defaults.
 *
 * The summary prints the days in the SAME `dd/mm/aaaa` the two fields are
 * masked to, rather than in the host locale's order. One control cannot show
 * the same date two ways: an `en-US` host formatting the summary as `08/05`
 * over a field reading `05/08` leaves the reader to work out which of the two
 * is lying. A host that wants its own order replaces `messages.summary`, which
 * moves both halves of the decision to the same place.
 */
export function defaultMessages(): DateRangePickerMessages {
  return {
    from: 'Start date',
    to: 'End date',
    quickRanges: 'Quick ranges',
    incomplete: 'Choose both dates.',
    reversed: 'The end date must be on or after the start date.',
    overMax: ({ maxRangeDays }) => `Choose a range of at most ${maxRangeDays} days.`,
    summary: ({ from, to }) => `${isoToBr(from)} – ${isoToBr(to)}`,
  };
}

/** The line under the fields: the chosen window, or why there isn't one. */
export function statusMessage(
  status: DateRangeStatus,
  messages: DateRangePickerMessages,
  maxRangeDays: number | undefined,
): string {
  if (status.ok) return messages.summary(status.window);
  if (status.problem === 'incomplete') return messages.incomplete;
  if (status.problem === 'reversed') return messages.reversed;
  return messages.overMax({ maxRangeDays: maxRangeDays ?? status.days, days: status.days });
}

/** Every quick range with its window, its length, and whether it is over cap. */
export function resolveQuickRanges(
  quickRanges: QuickRange[],
  context: QuickRangeContext,
  maxRangeDays: number | undefined,
): ResolvedQuickRange[] {
  return quickRanges.map((quickRange) => {
    const window = quickRange.resolve(context);
    const days = dayCount(window.from, window.to);
    return {
      ...quickRange,
      window,
      days,
      overMax: maxRangeDays !== undefined && days > maxRangeDays,
    };
  });
}

/** The quick range the draft currently IS, if it is exactly one of them. */
export function activeQuickRangeId(
  options: ResolvedQuickRange[],
  draft: DateRangeDraft,
): string | undefined {
  return options.find(
    (option) => option.window.from === draft.from && option.window.to === draft.to,
  )?.id;
}
