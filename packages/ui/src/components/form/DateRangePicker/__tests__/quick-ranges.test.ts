/**
 * The nine built-in quick ranges, resolved against a fixed "today".
 *
 * These are the cases a picker gets wrong quietly: a quarter that starts in the
 * wrong month, a year that opens on the 1st of the CURRENT month, a "last 30
 * days" that stops at the start of the year instead of crossing it. None of
 * them throws — they just answer a different question from the one on the
 * label, which is exactly why they are pinned here day by day rather than
 * checked for "looks about right".
 */
import { describe, expect, it } from 'vitest';

import { todayIn } from '../DateRangePicker.dates';
import { createQuickRanges, type QuickRangeId } from '../DateRangePicker.quick';
import { resolveDayRange } from '../DateRangePicker.range';
import type { DayWindow, WeekStart } from '../DateRangePicker.types';

const RANGES = createQuickRanges();

/** Resolve one quick range on a stated day. Sunday start unless said otherwise. */
function resolve(id: QuickRangeId, today: string, weekStartsOn: WeekStart = 0): DayWindow {
  const range = RANGES.find((candidate) => candidate.id === id);
  if (!range) throw new Error(`no quick range ${id}`);
  return range.resolve({ today, weekStartsOn });
}

describe('the quick ranges resolve to the days they claim', () => {
  // A Monday, mid-month, mid-quarter — the ordinary case every other one is a
  // boundary of.
  const MONDAY = '2026-08-10';

  it('covers today and yesterday as single days', () => {
    expect(resolve('today', MONDAY)).toEqual({ from: MONDAY, to: MONDAY });
    expect(resolve('yesterday', MONDAY)).toEqual({ from: '2026-08-09', to: '2026-08-09' });
  });

  it('counts a trailing window INCLUDING today, not from the day before', () => {
    // Seven days ending today is the 4th through the 10th. Reading it as "seven
    // days before today" gives the 3rd through the 9th — a window that omits
    // the day the reader is looking at, which is the one they most want.
    expect(resolve('last-7-days', MONDAY)).toEqual({ from: '2026-08-04', to: MONDAY });
    expect(resolve('last-30-days', MONDAY)).toEqual({ from: '2026-07-12', to: MONDAY });
    expect(resolve('last-365-days', MONDAY)).toEqual({ from: '2025-08-11', to: MONDAY });
  });

  it('opens the week on the day the calendar grid starts on', () => {
    // The 10th is a Monday. With a Sunday-start grid — what a pt-BR calendar
    // draws — "this week" begins on the 9th; with a Monday start it begins on
    // the 10th itself. Same day, two answers, and the grid must agree with
    // whichever one is showing.
    expect(resolve('this-week', MONDAY)).toEqual({ from: '2026-08-09', to: MONDAY });
    expect(resolve('this-week', MONDAY, 1)).toEqual({ from: MONDAY, to: MONDAY });
  });

  it('opens the month, quarter and year on their own first day', () => {
    expect(resolve('this-month', MONDAY)).toEqual({ from: '2026-08-01', to: MONDAY });
    // August is in Q3, which starts in July — not "three months back".
    expect(resolve('this-quarter', MONDAY)).toEqual({ from: '2026-07-01', to: MONDAY });
    expect(resolve('this-year', MONDAY)).toEqual({ from: '2026-01-01', to: MONDAY });
  });
});

describe('the boundaries', () => {
  it('puts each calendar quarter on its own first month', () => {
    expect(resolve('this-quarter', '2026-04-01').from).toBe('2026-04-01');
    expect(resolve('this-quarter', '2026-06-30').from).toBe('2026-04-01');
    expect(resolve('this-quarter', '2026-10-05').from).toBe('2026-10-01');
    expect(resolve('this-quarter', '2026-12-31').from).toBe('2026-10-01');
  });

  it('holds the year open on its last day', () => {
    expect(resolve('this-year', '2026-12-31')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('collapses month, quarter and year to one day on 1 January', () => {
    const first = '2026-01-01';
    expect(resolve('this-month', first)).toEqual({ from: first, to: first });
    expect(resolve('this-quarter', first)).toEqual({ from: first, to: first });
    expect(resolve('this-year', first)).toEqual({ from: first, to: first });
  });

  it('reaches back ACROSS the year boundary rather than stopping at it', () => {
    // The failure this pins: a trailing window clamped to 1 January, so the
    // first days of a year report on themselves and the comparison the reader
    // opened it for is missing.
    expect(resolve('yesterday', '2026-01-01').from).toBe('2025-12-31');
    expect(resolve('last-7-days', '2026-01-01').from).toBe('2025-12-26');
    expect(resolve('last-30-days', '2026-01-01').from).toBe('2025-12-03');
    expect(resolve('last-365-days', '2026-01-01').from).toBe('2025-01-02');
    expect(resolve('this-week', '2026-01-01').from).toBe('2025-12-28');
  });

  it('counts the leap day like any other day', () => {
    expect(resolve('yesterday', '2024-03-01').from).toBe('2024-02-29');
    expect(resolve('last-7-days', '2024-03-01').from).toBe('2024-02-24');
    // 365 days back from a date that has a 29 February behind it lands two days
    // into March, not one.
    expect(resolve('last-365-days', '2024-03-01').from).toBe('2023-03-03');
  });
});

describe('which day is today depends on the zone, and only that', () => {
  // 02:00 UTC on the 11th is still the 10th in São Paulo (UTC-03:00). Every
  // quick range hangs off "today", so this one instant is two different months
  // of report for two stores.
  const INSTANT = new Date('2026-08-11T02:00:00.000Z');

  it('reads today on the stated clock', () => {
    expect(todayIn('UTC', INSTANT)).toBe('2026-08-11');
    expect(todayIn('America/Sao_Paulo', INSTANT)).toBe('2026-08-10');
    expect(todayIn('Asia/Tokyo', INSTANT)).toBe('2026-08-11');
  });

  it('changes the whole window, not only its last day', () => {
    const utc = resolve('last-7-days', todayIn('UTC', INSTANT));
    const sp = resolve('last-7-days', todayIn('America/Sao_Paulo', INSTANT));
    expect(utc).toEqual({ from: '2026-08-05', to: '2026-08-11' });
    expect(sp).toEqual({ from: '2026-08-04', to: '2026-08-10' });
  });

  it('moves a month-to-date window into the previous month at the seam', () => {
    // 01:00 UTC on 1 August is 22:00 on 31 July in São Paulo: the store is
    // still serving July's dinner while UTC has already opened August.
    const seam = new Date('2026-08-01T01:00:00.000Z');
    expect(resolve('this-month', todayIn('UTC', seam)).from).toBe('2026-08-01');
    expect(resolve('this-month', todayIn('America/Sao_Paulo', seam)).from).toBe('2026-07-01');
  });
});

describe('a draft is judged, never repaired', () => {
  it('accepts a window and reports its INCLUSIVE length', () => {
    const status = resolveDayRange({ from: '2026-08-01', to: '2026-08-01' });
    expect(status).toEqual({ ok: true, window: { from: '2026-08-01', to: '2026-08-01' }, days: 1 });
    expect(resolveDayRange({ from: '2026-08-01', to: '2026-08-31' }).days).toBe(31);
  });

  it('refuses a reversed pair instead of swapping it', () => {
    // Swapping would hand back a window nobody asked for and leave the fields
    // showing something else; the caller is told, and says so.
    expect(resolveDayRange({ from: '2026-08-10', to: '2026-08-01' })).toEqual({
      ok: false,
      problem: 'reversed',
      days: 0,
    });
  });

  it('refuses a window longer than the cap instead of clipping it', () => {
    expect(resolveDayRange({ from: '2026-01-01', to: '2026-01-31' }, 30)).toEqual({
      ok: false,
      problem: 'over-max',
      days: 31,
    });
    // The cap is inclusive: exactly the maximum is allowed.
    expect(resolveDayRange({ from: '2026-01-01', to: '2026-01-30' }, 30).ok).toBe(true);
  });

  it('calls half a range incomplete rather than wrong', () => {
    const half = { ok: false, problem: 'incomplete', days: 0 };
    expect(resolveDayRange({ from: '2026-08-01', to: null })).toEqual(half);
    expect(resolveDayRange({ from: null, to: null })).toEqual(half);
  });
});
