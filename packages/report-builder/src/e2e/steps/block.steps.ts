import { readFileSync } from 'node:fs';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  BLOCK_RENDER_TIMEOUT_MS,
  block,
  blockRows,
  NEW_BLOCK,
  templateId,
} from '../helpers/surface.js';
import { reportsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * ONE BLOCK: what it may be drawn as, how big it is, and the two other ways to
 * read it (FUT-755).
 *
 * The refusals are the reason this file exists. Every one of them is a claim
 * about the DATA — a line implies the gap between two points is a value, a
 * stack implies there is more than one thing stacked — so a builder that
 * offered them would be offering to publish a chart that says something untrue.
 * The journeys press the refused control on purpose, because a reason nobody
 * can reach is the same as no reason at all.
 */

/** Pronoun alternation, so one definition serves every scenario's author. */
const THEY = '(?:she|he|they)';

/** The block editor panel's own prefix for the block being edited. */
const PANEL = `report-block-${NEW_BLOCK}-editor`;

/** A visualisation tile in the picker. */
function vizTile(page: Page, kind: string): Locator {
  return page.getByTestId(`builder-chart-type-${kind}`);
}

/** The one reason on screen, for the tile that was asked about. */
function vizReason(page: Page, kind: string): Locator {
  return page.getByTestId(`builder-chart-type-${kind}-reason`);
}

/** Pick a field in one of the builder's selects, by its catalog label. */
async function chooseField(page: Page, testId: string, label: string): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

/** The width of a laid-out element, or a failure naming what was missing. */
async function boxOf(locator: Locator, what: string): Promise<{ width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what} is not laid out — it has no box to measure`);
  return { width: box.width, height: box.height };
}

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given(
  new RegExp(`^${THEY} is building a new block from the first block template$`),
  async ({ page }) => {
    await page.getByTestId('reports-new').click();
    await expect(page.getByTestId('page-report-editor')).toBeVisible();
    await page
      .getByTestId(`block-template-picker-${templateId(reportsWorld().fixtures.blockTemplates.first)}`)
      .click();
    await expect(page.getByTestId(`report-block-${NEW_BLOCK}-render`)).toBeVisible({
      timeout: BLOCK_RENDER_TIMEOUT_MS,
    });
  },
);

// ---------------------------------------------------------------------------
// When — the shape of a block
// ---------------------------------------------------------------------------

When(
  new RegExp(`^${THEY} groups the block by a field the catalog says is ordered$`),
  async ({ page }) => {
    await chooseField(page, 'builder-dimension-0', reportsWorld().fixtures.orderedGrouping);
  },
);

When(
  new RegExp(`^${THEY} groups the block by a field whose values have no order$`),
  async ({ page }) => {
    await chooseField(page, 'builder-dimension-0', reportsWorld().fixtures.unorderedGrouping);
  },
);

When(new RegExp(`^${THEY} takes the grouping away altogether$`), async ({ page }) => {
  await chooseField(page, 'builder-dimension-0', '(nenhuma)');
});

When(new RegExp(`^${THEY} draws the block as bars$`), async ({ page }) => {
  await vizTile(page, 'bar').click();
  await expect(vizTile(page, 'bar')).toHaveAttribute('aria-pressed', 'true');
});

// ---------------------------------------------------------------------------
// When — the size of a block
// ---------------------------------------------------------------------------

When(new RegExp(`^${THEY} sets the block to a third of the canvas$`), async ({ page }) => {
  await page.getByTestId(`${PANEL}-span-4`).click();
});

When(new RegExp(`^${THEY} sets the block to the full canvas$`), async ({ page }) => {
  await page.getByTestId(`${PANEL}-span-12`).click();
});

When(
  new RegExp(`^${THEY} sets the block's height to "Alta"$`),
  async ({ page }) => {
    await page.getByTestId(`${PANEL}-height-3`).click();
  },
);

// ---------------------------------------------------------------------------
// When — reading it another way
// ---------------------------------------------------------------------------

/** The chart block of the report the host published — the one with tools. */
function chartBlock(page: Page): Locator {
  return block(page, reportsWorld().fixtures.publishedReport.chartBlockId);
}

When(new RegExp(`^${THEY} asks to see the chart as a table$`), async ({ page, journey }) => {
  const id = reportsWorld().fixtures.publishedReport.chartBlockId;
  await chartBlock(page).getByTestId(`report-block-${id}-render-as-table`).click();
  const rows = blockRows(page, id);
  await expect(rows).not.toHaveCount(0, { timeout: BLOCK_RENDER_TIMEOUT_MS });
  journey.countedRows(await rows.count());
});

When(new RegExp(`^${THEY} downloads the chart's rows$`), async ({ page, journey }) => {
  const id = reportsWorld().fixtures.publishedReport.chartBlockId;
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    chartBlock(page).getByTestId(`report-block-${id}-export`).click(),
  ]);
  journey.downloaded(download);
});

// ---------------------------------------------------------------------------
// Then — the shape of a block
// ---------------------------------------------------------------------------

/**
 * A refused control, and the two ways its reason has to be reachable.
 *
 * The tile is `aria-disabled` rather than `disabled` on purpose — a genuinely
 * disabled button leaves the tab order and swallows pointer events, which would
 * put the explanation behind an interaction the very people who need it cannot
 * perform. So the reason is asserted twice: once as the control's accessible
 * DESCRIPTION, which needs no event at all, and once in the callout a person
 * gets by pointing at it.
 *
 * `hover`, not `click`: Playwright treats `aria-disabled="true"` as disabled
 * and waits out a click the browser would have delivered happily.
 */
async function assertRefusal(control: Locator, reason: Locator, names: RegExp): Promise<void> {
  await expect(control).toHaveAttribute('aria-disabled', 'true');
  await expect(control).toHaveAttribute('title', names);
  await control.hover();
  await expect(reason).toContainText(names);
}

Then('a line is offered, because the block is grouped by date', async ({ page }) => {
  await expect(vizTile(page, 'line')).not.toHaveAttribute('aria-disabled', 'true');
});

Then('a line is still offered', async ({ page }) => {
  await expect(vizTile(page, 'line')).not.toHaveAttribute('aria-disabled', 'true');
});

Then('a line is refused, and the refusal names what to change', async ({ page }) => {
  await assertRefusal(vizTile(page, 'line'), vizReason(page, 'line'), /Troque o agrupamento/);
});

Then('bars are still offered, because bars claim nothing about the gap', async ({ page }) => {
  await expect(vizTile(page, 'bar')).not.toHaveAttribute('aria-disabled', 'true');
});

Then('stacking is refused, and the refusal names what to change', async ({ page }) => {
  await assertRefusal(
    page.getByTestId('builder-chart-stacked'),
    page.getByTestId('builder-chart-stacked-reason'),
    /adicione outra medida/,
  );
});

Then('a table is refused, and the refusal names what to change', async ({ page }) => {
  await assertRefusal(vizTile(page, 'table'), vizReason(page, 'table'), /Escolha um/);
});

// ---------------------------------------------------------------------------
// Then — the size of a block
// ---------------------------------------------------------------------------

/** How much of the canvas the block occupies, as a fraction of its width. */
async function shareOfCanvas(page: Page): Promise<number> {
  const canvas = await boxOf(page.getByTestId('report-editor-grid'), 'the canvas');
  const cell = await boxOf(block(page, NEW_BLOCK), 'the block');
  return cell.width / canvas.width;
}

Then('the block takes about a third of the canvas', async ({ page }) => {
  // A band rather than a number: the canvas puts a gap between columns, so a
  // four-of-twelve block is a third of the COLUMNS and slightly less than a
  // third of the pixels. Asserting the exact figure would be asserting the gap.
  //
  // The narrowing is polled FIRST and the floor checked after, deliberately.
  // A new report's first block fills the canvas, so a poll on the lower bound
  // would be satisfied by the width the block already had — the shape of the
  // bug this scenario is here to catch.
  await expect.poll(() => shareOfCanvas(page)).toBeLessThan(0.38);
  expect(await shareOfCanvas(page)).toBeGreaterThan(0.28);
});

Then('the block takes the whole canvas', async ({ page }) => {
  await expect.poll(() => shareOfCanvas(page)).toBeGreaterThan(0.98);
});

Then('the block is as tall as its own contents', async ({ page, journey }) => {
  await expect(page.getByTestId(`${PANEL}-height-auto`)).toHaveAttribute('aria-pressed', 'true');
  const cell = await boxOf(block(page, NEW_BLOCK), 'the block');
  journey.measuredHeight(cell.height);
});

Then('the block is taller than it was', async ({ page, journey }) => {
  await expect
    .poll(async () => (await boxOf(block(page, NEW_BLOCK), 'the block')).height)
    .toBeGreaterThan(journey.height);
});

// ---------------------------------------------------------------------------
// Then — reading it another way
// ---------------------------------------------------------------------------

Then("the chart's figures are on screen as rows", async ({ page, journey }) => {
  const rows = blockRows(page, reportsWorld().fixtures.publishedReport.chartBlockId);
  await expect(rows).toHaveCount(journey.rows);
});

Then('the control now offers to put the chart back', async ({ page }) => {
  await expect(chartBlock(page).getByRole('button', { name: 'Ver como gráfico' })).toBeVisible();
});

Then('the file is named after the block', async ({ journey }) => {
  const id = reportsWorld().fixtures.publishedReport.chartBlockId;
  expect(journey.download.suggestedFilename()).toBe(`bloco-${id}.csv`);
});

Then('it holds exactly the rows she was looking at', async ({ journey }) => {
  const path = await journey.download.path();
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  // One header plus a line per row — the rows the block is SHOWING, not a
  // second trip to the server that could disagree with the screen.
  expect(lines.length - 1).toBe(journey.rows);
});
