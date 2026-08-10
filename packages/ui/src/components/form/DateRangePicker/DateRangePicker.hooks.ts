/**
 * Everything the picker derives and every way its range can move, kept out of
 * the component so that file is a layout and this one is the behaviour — the
 * same split `Calendar.hooks.ts` uses next door.
 */
import { useId, useMemo, useState } from 'react';

import { toDayString, todayIn } from './DateRangePicker.dates';
import {
  activeQuickRangeId,
  defaultMessages,
  resolveDayRange,
  resolveQuickRanges,
} from './DateRangePicker.range';
import type {
  DateRangeChangeMeta,
  DateRangeDraft,
  DateRangePickerState,
  UseDateRangePickerArgs,
} from './DateRangePicker.types';

export function useDateRangePicker({
  value,
  onChange,
  timeZone,
  now,
  maxRangeDays,
  weekStartsOn,
  quickRanges,
  messages,
}: UseDateRangePickerArgs): DateRangePickerState {
  const statusId = useId();
  // `Calendar` reads which month to open on from the range it is handed, and
  // only when it MOUNTS. Bumping this key remounts it, which is how the other
  // two views move it. It changes for a quick pick and for a typed date and
  // NEVER for a click inside the grid — a calendar that jumped under the
  // pointer picking in it would be unusable.
  const [viewNonce, setViewNonce] = useState(0);

  const copy = useMemo(() => ({ ...defaultMessages(), ...messages }), [messages]);
  const today = useMemo(() => todayIn(timeZone, now ?? new Date()), [timeZone, now]);
  const options = useMemo(
    () => resolveQuickRanges(quickRanges, { today, weekStartsOn }, maxRangeDays),
    [quickRanges, today, weekStartsOn, maxRangeDays],
  );
  const status = useMemo(() => resolveDayRange(value, maxRangeDays), [value, maxRangeDays]);

  const emit = (
    next: DateRangeDraft,
    source: DateRangeChangeMeta['source'],
    quickRangeId?: string,
  ): void => {
    onChange(next, {
      source,
      ...(quickRangeId ? { quickRangeId } : {}),
      // Judged here, once. A caller left to re-derive "is this usable" is a
      // second opinion able to disagree with the message on screen.
      status: resolveDayRange(next, maxRangeDays),
    });
  };

  return {
    copy,
    options,
    activeId: activeQuickRangeId(options, value),
    status,
    statusId,
    viewNonce,
    pickQuick: (option) => {
      setViewNonce((nonce) => nonce + 1);
      emit({ from: option.window.from, to: option.window.to }, 'quick', option.id);
    },
    editBound: (which, bound) => {
      setViewNonce((nonce) => nonce + 1);
      emit({ ...value, [which]: bound }, which);
    },
    pickOnCalendar: (range) => {
      emit(
        {
          from: range.start ? toDayString(range.start) : null,
          to: range.end ? toDayString(range.end) : null,
        },
        'calendar',
      );
    },
  };
}
