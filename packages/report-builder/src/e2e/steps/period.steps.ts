import { expect, type Page } from '@playwright/test';

import {
  BLOCK_RENDER_TIMEOUT_MS,
  blockRows,
  quickRangeId,
  rangeId,
} from '../helpers/surface.js';
import { reportsWorld } from '../world.js';

import { Then, When } from './fixtures.js';

/**
 * The PERIOD a report answers for (FUT-755).
 *
 * Every assertion here is about a count of rows rather than about the pill that
 * was pressed, and that is deliberate: a period control is trivially easy to
 * wire so that it lights up correctly and changes nothing, and a suite that
 * only reads the control cannot tell the two apart. So each step presses a
 * period and then counts what came back, and the scenarios chain those counts
 * — "fewer than before" — because two presets resolving to the SAME window is
 * exactly the shape of the bug.
 */

/** Pronoun alternation, so one definition serves every scenario's author. */
const THEY = '(?:she|he|they)';

/** The block whose rows a period narrows — the host names it. */
function periodRows(page: Page): ReturnType<Page['locator']> {
  return blockRows(page, reportsWorld().fixtures.publishedReport.tableBlockId);
}

/** One period pill, by the word printed on it. */
function periodPill(page: Page, label: string): ReturnType<Page['getByTestId']> {
  return page.getByTestId(`report-range-item-${rangeId(label)}`);
}

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When(new RegExp(`^${THEY} asks for "(.+)"$`), async ({ page }, label: string) => {
  await periodPill(page, label).click();
});

/**
 * Two dates out of the calendar, taken from the host's own fixture.
 *
 * The picker opens on the window already on screen, so the days are read off
 * the FIRST month it shows — which is how a host states them against its own
 * clock rather than against the machine running the suite.
 */
When(new RegExp(`^${THEY} picks (?:her|his|their) own two dates out of the calendar$`), async ({
  page,
}) => {
  const { fromDay, toDay } = reportsWorld().fixtures.customWindow;
  await page.getByTestId('report-range-item-custom').click();
  await expect(page.getByTestId('report-range-custom')).toBeVisible();
  const month = page.getByTestId('calendar-month-0');
  await month.getByTestId(`calendar-date-${fromDay}`).click();
  await month.getByTestId(`calendar-date-${toDay}`).click();
  await page.getByTestId('report-range-custom-apply').click();
});

When(
  new RegExp(`^${THEY} takes "(.+)" from the picker's quick ranges$`),
  async ({ page }, label: string) => {
    await page.getByTestId('report-range-item-custom').click();
    await expect(page.getByTestId('report-range-custom')).toBeVisible();
    // The quick column's own entries, four of which are word-for-word the
    // period pills — which is the whole point of this scenario.
    await page.getByTestId(`report-range-picker-quick-${quickRangeId(label)}`).click();
    await page.getByTestId('report-range-custom-apply').click();
  },
);

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the report opens on {string}', async ({ page, journey }, label: string) => {
  await expect(periodPill(page, label)).toHaveAttribute('aria-pressed', 'true');
  const rows = periodRows(page);
  await expect(rows).not.toHaveCount(0, { timeout: BLOCK_RENDER_TIMEOUT_MS });
  journey.countedRows(await rows.count());
});

Then('the report covers fewer days than before', async ({ page, journey }) => {
  const rows = periodRows(page);
  // Polled rather than read once: the period is a round trip, and the count
  // between the click and the answer is legitimately the OLD one.
  await expect.poll(() => rows.count()).toBeLessThan(journey.rows);
  journey.countedRows(await rows.count());
});

Then('the report covers a single day', async ({ page, journey }) => {
  const rows = periodRows(page);
  await expect(rows).toHaveCount(1, { timeout: BLOCK_RENDER_TIMEOUT_MS });
  journey.countedRows(1);
});

Then('the report says which window it ran', async ({ page }) => {
  // The half of this that comes from the SERVER rather than from the control
  // that set it: the resolved window, read back.
  await expect(page.getByTestId('report-window')).toHaveText(
    reportsWorld().fixtures.customWindow.reads,
  );
});

Then('it holds only what happened inside those days', async ({ page }) => {
  await expect(periodRows(page)).toHaveCount(reportsWorld().fixtures.customWindow.rows, {
    timeout: BLOCK_RENDER_TIMEOUT_MS,
  });
});

Then('the period reads {string}, not the custom one', async ({ page }, applied: string) => {
  await expect(periodPill(page, applied)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('report-range-item-custom')).not.toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
