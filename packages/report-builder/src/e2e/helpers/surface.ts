import { expect, type Locator, type Page } from '@playwright/test';

import { reportsWorld, type ReportsBlockTemplate } from '../world.js';

/**
 * The gestures the packaged report journeys are built from — every one of them
 * driving a test id `@12-apps/report-builder` renders itself (FUT-755).
 *
 * They live outside `steps/` on purpose: that directory IS the `steps` glob, so
 * bddgen loads every file in it looking for definitions, and a helper module
 * sitting there would be imported for its (absent) side effects. This is the
 * same split `@12-apps/payments-e2e` keeps between `src/steps` and
 * `src/helpers`.
 *
 * Exported from the package as well, so a host can write its OWN specs in the
 * same vocabulary as the journeys.
 */

/**
 * How long a block may take to draw.
 *
 * A block is not markup: it compiles a spec, runs it against the host's data
 * and renders the result, so first paint legitimately outlives Playwright's
 * default. Stated once here rather than as a number typed into each assertion,
 * which is the shape a reviewer cannot argue with later.
 */
export const BLOCK_RENDER_TIMEOUT_MS = 15_000;

/** The id the editor gives the first block of a brand-new report. */
export const NEW_BLOCK = 'bloco-1';

/**
 * Take one template out of the picker, and wait until the block it creates is
 * on the canvas AND carries the template's own name.
 *
 * The host supplies the template — its `id` addresses the tile, its `title` is
 * what the editor titles the new block with — because a picker's entries are
 * the host's product. This used to go through a title → id map inside the
 * package holding seven slugs of the application it was extracted from, which
 * threw for any title that map had never heard of: the features had stopped
 * naming a template out loud, and the journeys still could not run anywhere
 * else.
 *
 * The title assertion is what makes this a wait rather than a sleep: a block
 * frame appears before its template has been applied, so waiting on the frame
 * alone would let the next step type into an editor that is still settling.
 */
export async function pickBlockTemplate(
  page: Page,
  template: ReportsBlockTemplate,
  position = 1,
): Promise<void> {
  await page.getByTestId(`block-template-picker-${template.id}`).click();
  const created = page.getByTestId(`report-block-bloco-${position}`);
  await expect(created).toBeVisible({ timeout: BLOCK_RENDER_TIMEOUT_MS });
  await expect(page.getByTestId(`report-block-bloco-${position}-title`)).toHaveValue(
    template.title,
  );
}

/** The rolling periods, by the word on their pill. */
const RANGE_IDS: Record<string, string> = {
  Hoje: 'today',
  '7 dias': '7d',
  '30 dias': '30d',
  'Este mês': 'month',
};

/** The preset behind a period's printed name. */
export function rangeId(label: string): string {
  const id = RANGE_IDS[label];
  if (!id) throw new Error(`unknown period "${label}"`);
  return id;
}

/**
 * The picker's QUICK column, by the same printed names.
 *
 * Deliberately a second map rather than a reuse of the one above: four of the
 * quick entries read word-for-word like the pills and mean the same window,
 * which is exactly the coincidence one journey is about — and the other five
 * are periods the pills do not offer at all.
 */
const QUICK_RANGE_IDS: Record<string, string> = {
  Hoje: 'today',
  '7 dias': 'last-7-days',
  '30 dias': 'last-30-days',
  'Este mês': 'this-month',
};

/** The quick entry behind a period's printed name. */
export function quickRangeId(label: string): string {
  const id = QUICK_RANGE_IDS[label];
  if (!id) throw new Error(`no quick range named "${label}"`);
  return id;
}

/** The grid of saved reports. */
export function reportsList(page: Page): Locator {
  return page.getByTestId('reports-card-list');
}

/** One block on whichever canvas is on screen — the viewer's or the editor's. */
export function block(page: Page, id: string): Locator {
  return page.getByTestId(`report-block-${id}`);
}

/**
 * The rows a block is showing.
 *
 * Every rendering this is asked about draws a `<tbody>` — a table block, and a
 * chart block switched to its table view — so counting rows is the one measure
 * that means the same thing before and after the toggle.
 */
export function blockRows(page: Page, id: string): Locator {
  return block(page, id).locator('tbody tr');
}

/**
 * The count a block has SETTLED on, and the number a caller may bank.
 *
 * An EMPTY table is not an answer, and that is the harder half of every wait in
 * these journeys. A block re-rendering its new window momentarily shows ZERO
 * rows — the period is part of the query's key, so the moment one is pressed the
 * new key holds no data — and zero satisfies "fewer than before" against any
 * count at all. A poll that accepts it succeeds on the loading state and records
 * 0 as that period's size. Nothing is fewer than none, so the NEXT narrowing in
 * the scenario can then never pass: it burns its timeout and reports the count
 * that did eventually render, against an expectation of "< 0".
 *
 * So the answer has to be a count that is both real and what was asked for, and
 * the value RETURNED is the one that actually satisfied it — re-reading after
 * the wait is a second read that another render can land in between.
 *
 * Stated once, here, because three steps bank a count and each of them is one
 * plausible-looking `await rows.count()` away from the same bug.
 */
async function countWhenSettled(
  rows: Locator,
  expectation: string,
  holds: (count: number) => boolean,
): Promise<number> {
  let settled = 0;
  await expect
    .poll(
      async () => {
        const count = await rows.count();
        // Said out loud rather than swallowed, so a block that never refills
        // fails reading "no rows at all" instead of timing out on a bare number.
        if (count === 0) return 'no rows at all';
        settled = count;
        return holds(count) ? expectation : `${count} rows`;
      },
      { timeout: BLOCK_RENDER_TIMEOUT_MS },
    )
    .toBe(expectation);
  return settled;
}

/** How many rows the block holds, once it holds any. */
export function settledRowCount(rows: Locator): Promise<number> {
  return countWhenSettled(rows, 'some rows', () => true);
}

/**
 * The same, once the block has settled on FEWER rows than `before` — the shape
 * every "a narrower period answers with less" assertion needs.
 *
 * Both halves matter. Without the ceiling the step proves nothing about the
 * period that was pressed; without the floor an empty frame proves it, which is
 * worse than nothing because the scenario goes green.
 */
export function narrowedRowCount(rows: Locator, before: number): Promise<number> {
  return countWhenSettled(rows, `fewer than ${before} rows`, (count) => count < before);
}

/** Open the report the host published to the team, from the list. */
export async function openPublishedReport(page: Page): Promise<void> {
  const { id } = reportsWorld().fixtures.publishedReport;
  await page.getByTestId(`reports-card-${id}-open`).click();
  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: BLOCK_RENDER_TIMEOUT_MS });
}

/** The same report, opened straight into its editor. */
export async function openEditorOfPublishedReport(page: Page): Promise<void> {
  await openPublishedReport(page);
  await page.getByTestId('report-edit').click();
  await expect(page.getByTestId('page-report-editor')).toBeVisible({
    timeout: BLOCK_RENDER_TIMEOUT_MS,
  });
}

/**
 * The id of the report the address bar is currently on.
 *
 * Every screen in the surface routes to `…/reports/<id>`, whatever the host
 * mounted it under and whether or not that host uses a hash — so this is the
 * one way to learn the id of a report the author has just CREATED without the
 * scenario guessing at it or matching a card by its text.
 */
export function openReportId(page: Page): string {
  const match = /\/reports\/([^/?#]+)/.exec(page.url());
  if (!match?.[1]) throw new Error(`no report id in the address bar: ${page.url()}`);
  return match[1];
}
