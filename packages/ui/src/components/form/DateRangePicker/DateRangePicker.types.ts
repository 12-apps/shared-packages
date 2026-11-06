/**
 * The vocabulary of a two-ended day range. Everything here is CIVIL — a day on
 * a stated clock, never an instant — because that is what a range picker picks:
 * "1 August" is the same day in every zone, and only the question "which day is
 * TODAY" needs a zone to answer.
 */
import type React from 'react';

import type { CalendarLabels } from '../../../copy/labels';
import type { CalendarTodayIndicator, DateRange } from '../Calendar';

/** One inclusive calendar day as `AAAA-MM-DD`. Sorts lexicographically. */
export type DayString = string;

/** A complete range: two INCLUSIVE calendar days, `from` on or before `to`. */
export interface DayWindow {
  from: DayString;
  to: DayString;
}

/**
 * A range being edited, which may be half-chosen, reversed or too long.
 *
 * This — not {@link DayWindow} — is the picker's `value`: a control whose value
 * could only hold a legal range would have nowhere to put a reader who typed
 * the end date first, and would have to either discard the keystrokes or lie
 * about what is on screen. {@link resolveDayRange} says whether a draft is a
 * usable window.
 */
export interface DateRangeDraft {
  from: DayString | null;
  to: DayString | null;
}

/** Why a draft is not a usable window. */
export type DateRangeProblem =
  /** One end is missing. */
  | 'incomplete'
  /** `from` is after `to`. */
  | 'reversed'
  /** Longer than `maxRangeDays`. */
  | 'over-max';

/** A draft judged against the picker's constraints. `days` is 0 when unknown. */
export type DateRangeStatus =
  | { ok: true; window: DayWindow; days: number }
  | { ok: false; problem: DateRangeProblem; days: number };

/** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getDay`. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** What a quick range resolves against. No `Date`, no zone — the day is done. */
export interface QuickRangeContext {
  /** Today, already read on the picker's stated clock. */
  today: DayString;
  /** The same week start the calendar grid renders with. */
  weekStartsOn: WeekStart;
}

/**
 * One entry in the quick-pick column.
 *
 * `resolve` is a function rather than a stored window so the list survives
 * midnight and can be defined once at module scope; `id` is stable and is what
 * a caller matches on when a particular quick range means something to it
 * (a saved preset, an analytics event) — never the label, which is copy.
 */
export interface QuickRange {
  id: string;
  label: string;
  resolve: (context: QuickRangeContext) => DayWindow;
}

/** A quick range with everything the list needs to draw it. */
export interface ResolvedQuickRange extends QuickRange {
  window: DayWindow;
  /** Inclusive day count of {@link window}. */
  days: number;
  /** Longer than the cap: offered, announced, and refused rather than clamped. */
  overMax: boolean;
}

/**
 * Every string the picker renders, so a host in another language replaces copy
 * instead of forking the component. Defaults are English.
 */
export interface DateRangePickerMessages {
  /** Label of the `from` field. */
  from: string;
  /** Label of the `to` field. */
  to: string;
  /** Accessible name of the quick-pick group. */
  quickRanges: string;
  /** Shown while only one end is chosen. */
  incomplete: string;
  /**
   * Shown, with `openEnd`, for a start with no end: a finished answer ("no end
   * date"), worded WITHOUT the date, which the field beside it already shows.
   * Optional so a full messages object written before it still type-checks.
   */
  openEnded?: string;
  /** Shown when the start is after the end. */
  reversed: string;
  /** Shown when the range — typed or quick-picked — exceeds the cap. */
  overMax: (info: { maxRangeDays: number; days: number }) => string;
  /** The chosen window, in words. */
  summary: (window: DayWindow) => string;
  /**
   * The month grid's accessible name. The grid is a `role="application"`, so
   * this is the only thing a screen reader announces for it.
   */
  calendarLabel: string;
  /**
   * The two fields' mask, which IS their placeholder — the expected ORDER is
   * on screen before the first keystroke rather than discovered by getting it
   * wrong. `dd/mm/aaaa` is one locale's order and one locale's letters.
   */
  dayMask: string;
}

/** Which of the three views moved the range, and what it moved it to. */
export interface DateRangeChangeMeta {
  source: 'quick' | 'calendar' | 'from' | 'to';
  /** Set only when `source` is `quick`: the {@link QuickRange.id} clicked. */
  quickRangeId?: string;
  /** The new draft, already judged — so a caller needs no second validator. */
  status: DateRangeStatus;
}

export interface DateRangePickerProps {
  /** The range being edited. Controlled: the picker keeps no copy of it. */
  value: DateRangeDraft;
  onChange: (next: DateRangeDraft, meta: DateRangeChangeMeta) => void;
  /**
   * IANA zone (or offset, e.g. `-03:00`) the quick ranges read TODAY on.
   *
   * Civil days are zone-free, but "today", "this month" and "this quarter" are
   * not: at 21:30 on 31 July in São Paulo it is already 1 August in UTC, so a
   * quarter resolved on the host's clock can name a period the reader's store
   * has not reached. Defaults to the host's own zone, which is right for a
   * picker whose data belongs to whoever is looking at it and wrong for one
   * that reports on somewhere else — pass the zone in that case.
   */
  timeZone?: string;
  /**
   * The instant TODAY is read from. Defaults to the real clock; a story or a
   * test freezes it here rather than mocking `Date`.
   */
  now?: Date;
  /**
   * Longest range the picker will call usable, in inclusive days.
   *
   * A quick range longer than this is rendered `aria-disabled` with the reason,
   * never silently shortened: returning eleven months for a control labelled
   * "This year" is worse than refusing.
   */
  maxRangeDays?: number;
  /**
   * First column of the calendar grid AND the day "this week" starts on — one
   * prop, because a grid that starts on Sunday beside a "this week" that starts
   * on Monday shows a highlighted block that begins mid-row.
   *
   * Defaults to 0 (Sunday), which is what a `pt-BR` calendar renders
   * (`D S T Q Q S S`) and what Brazilian merchants read. Do not "fix" it to
   * Monday for the ISO week without changing the locale that goes with it.
   */
  weekStartsOn?: WeekStart;
  /** Replaces the built-in list wholesale. Empty array: no quick column. */
  quickRanges?: QuickRange[];
  /** BCP-47 tag for month names, weekday initials and the summary sentence. */
  locale?: string;
  /** Months side by side. Defaults to 2, the range calendar's own default. */
  numberOfMonths?: number;
  /** Copy overrides, merged over the English defaults. */
  messages?: Partial<DateRangePickerMessages>;
  /**
   * Where the typed half sits. `below` (default) is the layout this picker
   * always had. `beside` is for a picker laid out in a page rather than a
   * popover: the months sit in their own frame and the fields in a column
   * beside them when the PICKER's own width has room for both, under them when
   * it has not — and one month instead of two when two would not fit either.
   * Decided by measuring the picker, not the viewport, because a form column
   * beside a preview is narrow on the widest screen.
   */
  fieldsPlacement?: 'below' | 'beside';
  /**
   * With `fieldsPlacement="beside"`: the months' frame meets the picker's own
   * edges instead of hugging its months. Under the fields' row the frame spans
   * the picker; beside them it takes what the fields' column leaves, and that
   * column stops at 320 design px — a `dd/mm/aaaa` date and its message need
   * no more. The calendar's seven columns spread across the frame and the day
   * faces keep their size (`Calendar` `fullWidth`). For a picker laid into a
   * form section whose edges the frame must line up with. Under the fields the
   * frame trims its side padding before a column drops under 40 design px.
   * Ignored without `fieldsPlacement="beside"`: the popover's frame is as wide
   * as its months. Default: false — the frame as wide as its months, centred
   * under the fields.
   */
  fullWidth?: boolean;
  /**
   * The consumer's OWN typed fields, in place of the built-in pair and the
   * summary line under it — for a form whose fields carry its own rules (a
   * half-typed date kept until submit, its own messages), which a second line
   * would only repeat. Told where it sits, so it can lay its fields out for it.
   * The calendar follows the value when the consumer changes it, as it follows
   * a typed date.
   */
  renderFields?: (args: { placement: 'beside' | 'below'; disabled: boolean }) => React.ReactNode;
  /**
   * The period is shown but cannot be changed now — its consumer cannot place
   * its days (FUT-4482). Every day of the grid is disabled and a tap writes
   * nothing, the quick ranges are not offered, the built-in boxes are
   * disabled, `renderFields` is told (`disabled`) so the consumer's own fields
   * follow, and the root is a `group` named by `label` that carries
   * `aria-disabled`. The month arrows are disabled too and today's ring takes
   * the disabled ink (review round 6). Say WHY next to the picker; the control
   * cannot — and describe the consumer's own fields with that sentence.
   *
   * In a popover, the picker is only what opens: the consumer disables its OWN
   * trigger (the button or field that opens the popover); this prop cannot
   * reach it. Default: false.
   */
  disabled?: boolean;
  /**
   * The picker's accessible name while it is `disabled` and its root is a
   * group. Default: `messages.calendarLabel`.
   */
  label?: string;
  /**
   * A start with no end is a finished answer — "from this day on" — rather
   * than half a range: the summary says `messages.openEnded` instead of asking
   * for the end. `resolveDayRange` is unchanged; the caller decides what an
   * open end means to it.
   */
  openEnd?: boolean;
  /**
   * The calendar's display options, passed through (`Calendar`'s own):
   * whether a month shows its neighbours' days (default true), how today is
   * marked (default `'bold'`), and whether one day may be the whole range
   * (default true). With `allowSameDayRange={false}` a second tap on the start
   * day does nothing.
   */
  showOutsideDays?: boolean;
  todayIndicator?: CalendarTodayIndicator;
  allowSameDayRange?: boolean;
  /** Names for the calendar's own controls (the month arrows), in the host's language. */
  calendarLabels?: Partial<CalendarLabels>;
  /** Root test id; every part derives from it (`-from`, `-quick-today`, …). */
  dataTestId?: string;
  className?: string;
}

/**
 * What `useDateRangePicker` reads — the picker's own props, minus the ones that
 * only decide how it LOOKS (locale, month count, test id, class name).
 */
export interface UseDateRangePickerArgs {
  value: DateRangeDraft;
  onChange: DateRangePickerProps['onChange'];
  timeZone: string | undefined;
  now: Date | undefined;
  maxRangeDays: number | undefined;
  weekStartsOn: WeekStart;
  quickRanges: QuickRange[];
  messages: Partial<DateRangePickerMessages> | undefined;
  /**
   * Remount the calendar onto the range whenever the CONSUMER moves it, not
   * only when a typed field or a quick pick does — true when the consumer owns
   * the fields (`renderFields`), whose edits never pass through the picker.
   */
  followValue?: boolean;
}

/** Everything the component renders from, and every way the range can move. */
export interface DateRangePickerState {
  /** Copy with the caller's overrides already merged over the defaults. */
  copy: DateRangePickerMessages;
  /** Every quick range resolved against today, with its length and verdict. */
  options: ResolvedQuickRange[];
  /** The quick range the draft currently IS, if it is exactly one of them. */
  activeId: string | undefined;
  /** The current draft, judged. */
  status: DateRangeStatus;
  /** Id of the status line; the two fields point at it. */
  statusId: string;
  /** Changes only when the calendar should FOLLOW the range. */
  viewNonce: number;
  pickQuick: (option: ResolvedQuickRange) => void;
  editBound: (which: 'from' | 'to', bound: DayString | null) => void;
  pickOnCalendar: (range: DateRange) => void;
}
