/**
 * Everything the picker derives and every way its range can move, kept out of
 * the component so that file is a layout and this one is the behaviour — the
 * same split `Calendar.hooks.ts` uses next door.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

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

/**
 * Whether `value` is what the picker last handed out — or that tap's draft
 * carried on by the consumer: every bound the tap chose kept, a bound it left
 * open filled in (a consumer that keeps an end the tap would have dropped).
 * Either way the grid under the pointer must not move, nor lose its focus.
 */
function cameFromPicker(value: DateRangeDraft, emitted: DateRangeDraft | null): boolean {
  if (emitted === null) return false;
  const kept = (bound: 'from' | 'to'): boolean => emitted[bound] === null || emitted[bound] === value[bound];
  return kept('from') && kept('to');
}

/**
 * Bump the view nonce when the value moves and the picker did not move it —
 * a consumer's own field committed a day. Skips the mount and the picker's own
 * emissions, so a click in the grid never remounts the grid under it. An
 * emission is read once: the change after it is the consumer's own.
 */
function useFollowValue(
  enabled: boolean,
  value: DateRangeDraft,
  lastEmitted: { current: DateRangeDraft | null },
  setViewNonce: (update: (nonce: number) => number) => void,
): void {
  const previous = useRef(value);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (!enabled || (before.from === value.from && before.to === value.to)) return;
    const emitted = lastEmitted.current;
    lastEmitted.current = null;
    if (cameFromPicker(value, emitted)) return;
    setViewNonce((nonce) => nonce + 1);
  }, [enabled, value, lastEmitted, setViewNonce]);
}

export function useDateRangePicker({
  value,
  onChange,
  timeZone,
  now,
  maxRangeDays,
  weekStartsOn,
  quickRanges,
  messages,
  followValue = false,
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
  // What the picker itself last handed out: a value equal to it came FROM here
  // (a click in the grid), and must not move the grid under the pointer.
  const lastEmitted = useRef<DateRangeDraft | null>(null);
  useFollowValue(followValue, value, lastEmitted, setViewNonce);

  const emit = (
    next: DateRangeDraft,
    source: DateRangeChangeMeta['source'],
    quickRangeId?: string,
  ): void => {
    lastEmitted.current = next;
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
