import type { Locator } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { narrowedRowCount, settledRowCount } from '../surface.js';

/**
 * The row-count waits, against the frames a real block actually renders.
 *
 * These are unit tests of e2e helpers, which is unusual and is the point: the
 * defect they pin is a RACE, and a race cannot be pinned by the journey that
 * suffers it. `Gherkin Journeys` went red at random on branches that had not
 * touched reports, and the run after it went green — so the suite could neither
 * demonstrate the bug nor, once fixed, demonstrate the fix. Driving the wait
 * over a scripted sequence of counts makes the losing interleaving the ordinary
 * case instead of the rare one.
 */

/**
 * A block whose row count reads as `counts` says, one frame per read, holding
 * the last frame once the script runs out — which is what a settled block does.
 */
function rowsReading(...counts: number[]): Locator {
  const frames = [...counts];
  const locator = {
    count: () => Promise.resolve(frames.length > 1 ? (frames.shift() as number) : frames[0]),
  };
  return locator as unknown as Locator;
}

describe('settledRowCount', () => {
  it('polls through the empty frame a re-fetching block renders', async () => {
    // Zero is not an answer: the period is part of the query key, so a block
    // whose period just changed holds no data and draws no rows at all.
    expect(await settledRowCount(rowsReading(0, 0, 4))).toBe(4);
  });

  it('returns the count it MATCHED, not whatever the block shows next', async () => {
    const rows = rowsReading(0, 4, 9);
    expect(await settledRowCount(rows)).toBe(4);
    // The frame a second read would have banked instead. This is the whole
    // difference between the helper and the `await rows.count()` it replaced.
    expect(await rows.count()).toBe(9);
  });

  it('takes the first real count without waiting for a block to change again', async () => {
    expect(await settledRowCount(rowsReading(7))).toBe(7);
  });
});

describe('narrowedRowCount', () => {
  it('refuses the empty frame, though zero IS fewer than before', async () => {
    // The regression. `0 < 30` holds, so the wait this replaced ended here and
    // banked nothing — leaving the next period to answer with fewer than zero.
    expect(await narrowedRowCount(rowsReading(0, 0, 4), 30)).toBe(4);
  });

  it('keeps waiting while the block still holds the OLD period’s rows', async () => {
    expect(await narrowedRowCount(rowsReading(30, 30, 4), 30)).toBe(4);
  });

  it('holds the chain together across two narrowings', async () => {
    // The scenario, frame for frame: the report opens on 30 dias, "7 dias"
    // blinks empty before answering, and "Este mês" blinks again. Under the
    // read-after-the-wait this went `30 → 0` and then asked for fewer than 0.
    const opened = await settledRowCount(rowsReading(0, 30));
    const week = await narrowedRowCount(rowsReading(0, 7), opened);
    const month = await narrowedRowCount(rowsReading(0, 0, 5), week);
    expect([opened, week, month]).toEqual([30, 7, 5]);
  });
});
