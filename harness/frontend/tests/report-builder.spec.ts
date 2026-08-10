import { expect, test } from '@playwright/test';

/**
 * `@12-apps/report-builder` mounted the way a host mounts it: one call to
 * `createWebReportBuilder`, no route table, no screen imported by name.
 *
 * These drive the REAL surface from the published tarball and assert what an
 * owner sees, because the thing being proven is that the package's public
 * wiring works for a consumer — not that a component renders.
 */
test('the whole surface mounts from one factory call', async ({ page }) => {
  await page.goto('#/report-builder');

  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'report-builder');
  await expect(page.getByTestId('page-reports')).toBeVisible();
});

test('the list offers the seeded reports as a card grid, scoped', async ({ page }) => {
  await page.goto('#/report-builder');

  const grid = page.getByTestId('reports-card-list');
  const first = grid.getByTestId('reports-card-r1');
  await expect(first).toBeVisible();
  await expect(first).toContainText('Vendas por forma de pagamento');
  // The card says what the name alone never did: how big it is, who reads it.
  await expect(first).toContainText('2 blocos');
  await expect(first).toContainText('Toda a equipe');
  // The grid ENDS in the way to add one more.
  await expect(grid.getByTestId('reports-card-new')).toBeVisible();

  // Three scope pills, from the card list inside the package. The archived
  // fixture is absent under Todos and present under Arquivados — the scope is
  // doing the work, not the render.
  await expect(page.getByTestId('reports-scope-active')).toHaveAttribute('aria-pressed', 'true');
  await expect(grid.getByTestId('reports-card-r7')).toHaveCount(0);

  await page.getByTestId('reports-scope-archived').click();
  await expect(grid.getByTestId('reports-card-r7')).toBeVisible();
  await expect(grid.getByTestId('reports-card-r7')).toContainText('Arquivado');
  await expect(grid.getByTestId('reports-card-r1')).toHaveCount(0);
});

test('the Meus scope keeps only what this user authored', async ({ page }) => {
  await page.goto('#/report-builder');

  const grid = page.getByTestId('reports-card-list');
  // `r5` is seeded against another author, so `Meus` has something to drop —
  // and it is visible under Todos first, which is what makes its absence real.
  await expect(grid.getByTestId('reports-card-r5')).toBeVisible();

  await page.getByTestId('reports-scope-mine').click();

  await expect(grid.getByTestId('reports-card-r1')).toBeVisible();
  await expect(grid.getByTestId('reports-card-r5')).toHaveCount(0);
});

test('the search box narrows the grid, and says so when it matches nothing', async ({ page }) => {
  await page.goto('#/report-builder');

  const grid = page.getByTestId('reports-card-list');
  await expect(grid.getByTestId('reports-card-r3')).toBeVisible();

  await page.getByTestId('reports-search').fill('perdas');

  await expect(grid.getByTestId('reports-card-r6')).toBeVisible();
  await expect(grid.getByTestId('reports-card-r3')).toHaveCount(0);

  await page.getByTestId('reports-search').fill('zzzz');
  await expect(page.getByTestId('reports-empty')).toContainText('Tente outro termo.');
});

/**
 * The area is TWO screens (FUT-755): `/reports` is the grid, `/reports/:id` is
 * the report. Every case below that wants a canvas opens one by clicking its
 * card, which is also the navigation the user asked for.
 */
async function openFirstReport(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('#/report-builder');
  await page.getByTestId('reports-card-r1-open').click();
  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: 15_000 });
}

test('opening a report navigates to its own page, and back returns to the grid', async ({ page }) => {
  await page.goto('#/report-builder');

  // The landing screen is the grid ALONE — no report auto-selected under it.
  await expect(page.getByTestId('reports-card-list')).toBeVisible();
  await expect(page.getByTestId('page-report')).toHaveCount(0);

  await page.getByTestId('reports-card-r1-open').click();

  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('report-title')).toHaveText('Vendas por forma de pagamento');
  // The grid is gone, not merely scrolled past.
  await expect(page.getByTestId('reports-card-list')).toHaveCount(0);
  // The header the prototype puts above the blocks.
  await expect(page.getByTestId('report-export-pdf')).toBeVisible();
  await expect(page.getByTestId('report-edit')).toBeVisible();
  await expect(page.getByTestId('report-actions')).toBeVisible();

  await page.getByTestId('report-back').click();

  await expect(page.getByTestId('reports-card-list')).toBeVisible();
  await expect(page.getByTestId('page-report')).toHaveCount(0);
});

test('the selected report runs through the published pipeline', async ({ page }) => {
  await openFirstReport(page);

  const revenue = page.getByTestId('report-block-revenue');
  await expect(revenue).toBeVisible({ timeout: 15_000 });

  // Compiled, executed against the harness's in-memory adapter and rendered by
  // the package: the bar chart's own categories, not fixture text.
  await expect(revenue).toContainText('PIX');
  await expect(revenue).toContainText('CARD');
});

test('an untitled block is named by its own spec sentence', async ({ page }) => {
  await openFirstReport(page);

  // The second block carries no title, so specSentence names it — computed
  // server-side and shipped on the block, which is what stops the viewer, the
  // editor and an export from drifting.
  const daily = page.getByTestId('report-block-daily');
  await expect(daily).toBeVisible({ timeout: 15_000 });
  await expect(daily.locator('h2')).toHaveText('Soma de receita em pedidos por data (dia)');

  // …and shows NO subtitle, because repeating one string as both heading and
  // caption is noise. A named block gets both; this one is the same sentence.
  await expect(page.getByTestId('report-block-daily-description')).toHaveCount(0);
});

test('a NAMED block shows its name and what it asks for', async ({ page }) => {
  await openFirstReport(page);

  const revenue = page.getByTestId('report-block-revenue');
  await expect(revenue).toBeVisible({ timeout: 15_000 });
  await expect(revenue.locator('h2')).toHaveText('Receita por forma');
  // The name does not say it is filtered to paid orders; the sentence does.
  await expect(page.getByTestId('report-block-revenue-description')).toHaveText(
    'soma de receita em pedidos por forma de pagamento, onde status é PAID',
  );
});

test('a chart offers its table fallback', async ({ page }) => {
  await openFirstReport(page);

  const revenue = page.getByTestId('report-block-revenue');
  await expect(revenue).toBeVisible({ timeout: 15_000 });
  // The accessibility fallback, reachable on the real surface rather than on a
  // page the harness built to show it. By ROLE and NAME, not by text: the
  // block's chrome renders these as icon controls, so the label is the
  // accessible name — which is the thing a screen reader reaches for anyway.
  await expect(revenue.getByRole('button', { name: 'Ver como tabela' })).toBeVisible();
});

/**
 * The write half.
 *
 * This is the case the harness could not see before: the package's screens
 * used to write with a direct `fetch`, bypassing the very transport their
 * reads went through — so a host that supplied one had its reads intercepted
 * and its writes escaping to the origin. And because nothing crossed both
 * halves, the client's `PUT` and the server's `PATCH` disagreed for as long as
 * both existed.
 *
 * Archiving is the shortest path that proves the whole chain: the viewer's own
 * menu → the transport → the package's published Hono binding → its saved-report
 * routes → the list re-reading what was actually stored.
 */
test('archiving writes through the transport and the list re-reads it', async ({ page }) => {
  await openFirstReport(page);

  await page.getByTestId('report-actions').click();
  await page.getByText('Arquivar', { exact: true }).click();
  await page.getByTestId('report-archive-confirm').getByText('Arquivar', { exact: true }).click();

  // Archiving a report you were reading is a dead end, so it returns you to
  // the list — which comes from a fresh read of the store, not from local
  // state: the published PUT landed, and the published GET saw it.
  const grid = page.getByTestId('reports-card-list');
  await expect(grid).toBeVisible();
  await expect(grid.getByTestId('reports-card-r1')).toHaveCount(0);
  // …and the grid still rendered, so its absence is the archive and not a
  // blank screen.
  await expect(grid.getByTestId('reports-card-r3')).toBeVisible();

  // …and present under Arquivados, carrying the chip that says so.
  await page.getByTestId('reports-scope-archived').click();
  await expect(grid.getByTestId('reports-card-r1')).toContainText('Arquivado');
});

/**
 * Navigating WITHIN the surface — the routes the factory owns so a host never
 * has to rediscover them.
 *
 * `new` is a static segment that `:reportId` would otherwise swallow, which is
 * the ordering rule that used to be copied into every host's route table. It
 * is asserted here, from outside, because from inside the package the order is
 * just a line whose importance is invisible.
 */
test('the editor is reachable, and “new” is not read as a report id', async ({ page }) => {
  await page.goto('#/report-builder');

  await page.getByTestId('reports-new').click();

  // The editor, not a viewer that failed to load a report called "new".
  await expect(page.getByTestId('page-report-editor')).toBeVisible();
});

/**
 * The period toggle, end to end (FUT-755).
 *
 * `runOptions` resolves the preset into a window and hands it to the HOST's
 * adapter factory; scoping the rows is the host's job. This fixture used to
 * ignore that argument and return every row for every preset, so the toggle
 * had never done anything here — and nothing said so, because every assertion
 * in this file happened to hold for the full data set.
 *
 * Counting the day-bucketed block's rows is what makes it visible: the fixture
 * is laid out so `Hoje` ⊂ `7 dias` ⊂ `30 dias`, and each step must be a strict
 * increase. Equal counts is exactly the shape of the bug.
 */
test('each period preset returns a different window of data', async ({ page }) => {
  await openFirstReport(page);

  const daily = page.getByTestId('report-block-daily');
  await expect(daily).toBeVisible({ timeout: 15_000 });
  const dayRows = daily.locator('tbody tr');

  // The report opens on 30 dias, which is the widest of the three.
  await expect(daily.locator('tbody tr')).not.toHaveCount(0);
  const wide = await dayRows.count();

  await page.getByTestId('report-range-item-7d').click();
  await expect(daily).toBeVisible({ timeout: 15_000 });
  await expect(dayRows).toHaveCount(wide - 1);
  const week = await dayRows.count();

  await page.getByTestId('report-range-item-today').click();
  await expect(daily).toBeVisible({ timeout: 15_000 });
  // One local day, and it is `o6` — the only row on 2026-07-05 in São Paulo.
  await expect(dayRows).toHaveCount(1);

  expect(week).toBeGreaterThan(1);
  expect(wide).toBeGreaterThan(week);
});
