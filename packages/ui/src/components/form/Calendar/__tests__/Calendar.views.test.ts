import { describe, expect, it } from 'vitest';

import { getMonthLabel } from '../Calendar.dates';
import {
  DEFAULT_MAX_YEAR,
  DEFAULT_MIN_YEAR,
  canShiftMonth,
  clampMonthToBounds,
  isMonthOutOfBounds,
  isYearOutOfBounds,
  landingDay,
  moveInGrid,
  yearOptions,
} from '../Calendar.views';

const MIN = new Date(1900, 0, 1);
// The Perfil field's ceiling on 2026-10-27: today minus 13 years.
const MAX = new Date(2013, 9, 27);
const BOUNDS = { minDate: MIN, maxDate: MAX };

describe('yearOptions', () => {
  it('lists the bounded years newest first', () => {
    const years = yearOptions(BOUNDS, 2001);
    expect(years[0]).toBe(2013);
    expect(years.at(-1)).toBe(1900);
    expect(years).toHaveLength(2013 - 1900 + 1);
  });

  it('falls back to the default window without bounds', () => {
    const years = yearOptions({}, 2026);
    expect(years[0]).toBe(DEFAULT_MAX_YEAR);
    expect(years.at(-1)).toBe(DEFAULT_MIN_YEAR);
  });

  it('keeps the shown year even when it is outside the bounds', () => {
    expect(yearOptions(BOUNDS, 2020)[0]).toBe(2020);
    expect(yearOptions(BOUNDS, 1890).at(-1)).toBe(1890);
  });
});

describe('isMonthOutOfBounds', () => {
  it('keeps the month that holds the ceiling and refuses the one after', () => {
    expect(isMonthOutOfBounds(2013, 9, BOUNDS)).toBe(false);
    expect(isMonthOutOfBounds(2013, 10, BOUNDS)).toBe(true);
  });

  it('refuses a month wholly before the floor', () => {
    expect(isMonthOutOfBounds(1899, 11, BOUNDS)).toBe(true);
    expect(isMonthOutOfBounds(1900, 0, BOUNDS)).toBe(false);
  });

  it('refuses nothing without bounds', () => {
    expect(isMonthOutOfBounds(3000, 0, {})).toBe(false);
  });
});

describe('isYearOutOfBounds', () => {
  it('refuses only years past either bound', () => {
    expect(isYearOutOfBounds(2013, BOUNDS)).toBe(false);
    expect(isYearOutOfBounds(2014, BOUNDS)).toBe(true);
    expect(isYearOutOfBounds(1899, BOUNDS)).toBe(true);
    expect(isYearOutOfBounds(1899, {})).toBe(false);
  });
});

describe('clampMonthToBounds', () => {
  it('pulls a month past the ceiling back to it in the ceiling year only', () => {
    expect(clampMonthToBounds(2013, 11, BOUNDS)).toBe(9);
    expect(clampMonthToBounds(2012, 11, BOUNDS)).toBe(11);
  });

  it('pulls a month before the floor up to it', () => {
    expect(clampMonthToBounds(1950, 0, { minDate: new Date(1950, 5, 10) })).toBe(5);
  });
});

describe('landingDay', () => {
  it('keeps the day of the month, cut to the month length', () => {
    expect(landingDay(2001, 1, 31, {}).getDate()).toBe(28);
    expect(landingDay(2000, 1, 31, {}).getDate()).toBe(29);
    expect(landingDay(1990, 2, 14, {}).getDate()).toBe(14);
  });

  it('stays inside the bounds', () => {
    const day = landingDay(2013, 9, 30, BOUNDS);
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2013, 9, 27]);
  });
});

describe('canShiftMonth', () => {
  it('stops at the ceiling month and the floor month', () => {
    expect(canShiftMonth(new Date(2013, 9, 1), 1, BOUNDS)).toBe(false);
    expect(canShiftMonth(new Date(2013, 8, 1), 1, BOUNDS)).toBe(true);
    expect(canShiftMonth(new Date(1900, 0, 1), -1, BOUNDS)).toBe(false);
    expect(canShiftMonth(new Date(1900, 1, 1), -1, BOUNDS)).toBe(true);
  });
});

describe('moveInGrid', () => {
  it('moves by one across and by a row down, held to the grid', () => {
    expect(moveInGrid('ArrowRight', 0, 4, 10)).toBe(1);
    expect(moveInGrid('ArrowDown', 1, 4, 10)).toBe(5);
    expect(moveInGrid('ArrowDown', 8, 4, 10)).toBe(9);
    expect(moveInGrid('ArrowUp', 2, 4, 10)).toBe(0);
    expect(moveInGrid('ArrowLeft', 0, 4, 10)).toBe(0);
    expect(moveInGrid('Home', 7, 4, 10)).toBe(0);
    expect(moveInGrid('End', 0, 4, 10)).toBe(9);
  });

  it('ignores a key that is not a move', () => {
    expect(moveInGrid('Enter', 3, 4, 10)).toBeNull();
    expect(moveInGrid('PageDown', 3, 4, 10)).toBeNull();
  });
});

describe('getMonthLabel', () => {
  it('names a month on its own, capitalised long and undotted short', () => {
    expect(getMonthLabel(2, 'pt-BR', 'long')).toBe('Março');
    expect(getMonthLabel(2, 'pt-BR', 'short')).toBe('mar');
    expect(getMonthLabel(2, 'en-US', 'long')).toBe('March');
  });
});
