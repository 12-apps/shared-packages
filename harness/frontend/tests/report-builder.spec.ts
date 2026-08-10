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

/**
 * The ADDRESS BAR — the half of "two screens" that the screens alone cannot
 * prove.
 *
 * The surface has always had routes; what it lacked here was a router that
 * writes them anywhere a browser can see. `standalone: true` gave it a
 * `MemoryRouter`, whose location is a variable: every screen worked and none of
 * them had a URL, so a report could not be linked to, reloaded or backed out
 * of. The page now mounts the surface under a real `HashRouter` whose
 * `basename` is the harness slug, and the shell reads only the FIRST hash
 * segment so a four-segment hash still resolves to this page.
 *
 * Both halves have to be true at once, and only a RELOAD says so: a surface
 * that writes a URL nothing can read back passes any assertion that the URL
 * changed. So each case below ends by loading the URL it just produced.
 */
const LIST_URL = /#\/report-builder\/harness\/reports$/;
const REPORT_URL = /#\/report-builder\/harness\/reports\/r1$/;
const EDITOR_URL = /#\/report-builder\/harness\/reports\/r1\/edit$/;

test('opening a report puts that report’s id in the address bar', async ({ page }) => {
  await page.goto('#/report-builder');

  // The grid has a URL of its own: the page slug alone is not one of the
  // surface's screens, so `#/report-builder` resolves onto the surface's root.
  await expect(page.getByTestId('reports-card-list')).toBeVisible();
  await expect(page).toHaveURL(LIST_URL);

  await page.getByTestId('reports-card-r1-open').click();

  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: 15_000 });
  // A different URL from the grid's, and the difference is the report's id.
  await expect(page).toHaveURL(REPORT_URL);
});

test('the report’s URL reloads onto the report, not the grid', async ({ page }) => {
  await page.goto('#/report-builder');
  await page.getByTestId('reports-card-r1-open').click();
  await expect(page).toHaveURL(REPORT_URL);

  await page.reload();

  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('report-title')).toHaveText('Vendas por forma de pagamento');
  await expect(page.getByTestId('reports-card-list')).toHaveCount(0);
  await expect(page).toHaveURL(REPORT_URL);
  // The SHELL's half, from a cold load: it found `report-builder` at the front
  // of a four-segment hash. Reading the whole path looked up a page named
  // `report-builder/harness/reports/r1`, found none, and drew the not-a-page
  // message over a surface that had routed correctly.
  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'report-builder');
});

test('the browser’s Back returns from the report to the grid', async ({ page }) => {
  await page.goto('#/report-builder');
  await expect(page).toHaveURL(LIST_URL);

  await page.getByTestId('reports-card-r1-open').click();
  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: 15_000 });

  await page.goBack();

  await expect(page.getByTestId('reports-card-list')).toBeVisible();
  await expect(page.getByTestId('page-report')).toHaveCount(0);
  await expect(page).toHaveURL(LIST_URL);
});

test('the editor has a URL of its own, and reloading it opens the editor', async ({ page }) => {
  await openFirstReport(page);

  await page.getByTestId('report-edit').click();

  await expect(page.getByTestId('page-report-editor')).toBeVisible({ timeout: 15_000 });
  // Distinguishable from the report's own URL by more than a query string —
  // `/edit` is a route, which is what makes the reload below land here.
  await expect(page).toHaveURL(EDITOR_URL);

  await page.reload();

  await expect(page.getByTestId('page-report-editor')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('page-report')).toHaveCount(0);
  await expect(page).toHaveURL(EDITOR_URL);
});

/**
 * The shell and the surface, agreeing about one hash.
 *
 * react-router's hash history listens on `popstate` alone and writes its own
 * navigations with `pushState`, which fires no `hashchange` — so a hash the
 * SHELL changed never reaches it. The sidebar's rows are plain `<a href="#/…">`
 * anchors, and its "Report builder" row points at the bare slug; without the
 * page following that change, clicking it while reading a report moved the
 * address bar and left the report on screen. That is the same URL-versus-screen
 * disagreement this block exists to close, reached from the other side.
 */
test('the shell’s own nav row leaves the report it is standing in', async ({ page }) => {
  await openFirstReport(page);

  await page.getByTestId('harness-nav-report-builder').click();

  await expect(page.getByTestId('reports-card-list')).toBeVisible();
  await expect(page.getByTestId('page-report')).toHaveCount(0);
  await expect(page).toHaveURL(LIST_URL);
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
 * The block picker's eight templates, and the catalog they need behind them.
 *
 * The picker is served from the PACKAGE and lists every template whose starter
 * exists — it never asks the host's catalog what it can actually run. So a
 * harness with one entity offered all eight and five of them created a block
 * that answered *Acesso negado*, because an entity absent from the catalog is
 * an entity nobody holds the permission for. The failure was silent from the
 * package's side and looked, from the browser, exactly like a broken template.
 *
 * These are the cases that make the catalog the acceptance surface it is meant
 * to be: every template runs, and each one draws ITS OWN entity.
 */
const NEW_REPORT_BLOCK = 'bloco-1';

/** Open a blank report and add one template from the picker. */
async function addTemplate(page: import('@playwright/test').Page, template: string): Promise<void> {
  await page.goto('#/report-builder');
  await page.getByTestId('reports-new').click();
  await expect(page.getByTestId('page-report-editor')).toBeVisible();
  await page.getByTestId(`block-template-picker-${template}`).click();
  await expect(page.getByTestId(`report-block-${NEW_REPORT_BLOCK}`)).toBeVisible({
    timeout: 15_000,
  });
}

test('“Coleção” offers the product’s real collections, with the product’s labels', async ({
  page,
}) => {
  await addTemplate(page, 'receita-por-dia');

  await page.getByTestId(`report-block-${NEW_REPORT_BLOCK}-editor-entity`).click();

  // Seven, in catalog order, labelled the way `server/catalog.ts` labels them.
  // A harness that models a different world tests nothing, and for as long as
  // this dropdown held only “Pedidos” most of the builder could not be driven
  // at all — a split had `id` to reach for and nothing else.
  await expect(page.getByRole('option')).toHaveText([
    'Pedidos',
    'Itens vendidos',
    'Pagamentos',
    'Movimentações de estoque',
    'Perdas',
    'Cozinha — linhas',
    'Cozinha — turnos',
  ]);
});

test('every template in the picker resolves and runs', async ({ page }) => {
  await page.goto('#/report-builder');
  await page.getByTestId('reports-new').click();
  await expect(page.getByTestId('block-template-picker')).toBeVisible();

  const templates = [
    'receita-por-dia',
    'produtos-mais-vendidos',
    'preparo-por-estacao',
    'horas-por-estacao',
    'formas-de-pagamento',
    'perdas-por-motivo',
    'movimentacoes-de-estoque',
  ];

  for (const [index, template] of templates.entries()) {
    if (index > 0) await page.getByTestId('report-editor-add-block').click();
    await page.getByTestId(`block-template-picker-${template}`).click();
    await expect(page.getByTestId(`report-block-bloco-${index + 1}`)).toBeVisible({
      timeout: 15_000,
    });
  }

  // Every block RAN. A spec the catalog cannot serve surfaces as the block's
  // own error alert, which is how all five non-orders templates used to end up.
  await expect(page.locator('[data-report-block-id] [data-testid$="-render"]')).toHaveCount(
    templates.length,
  );
  await expect(page.locator('[data-report-block-id] [data-testid$="-error"]')).toHaveCount(0);
});

test('a kitchen template draws the kitchen, not the fallback', async ({ page }) => {
  await addTemplate(page, 'horas-por-estacao');

  const block = page.getByTestId(`report-block-${NEW_REPORT_BLOCK}`);
  // The stations, the hours they cost and the lines they produced — the
  // starter's own three columns, over `kitchen_shifts`.
  await expect(block).toContainText('Chapa');
  await expect(block).toContainText('Fritadeira');
  await expect(block).toContainText('45h 30m');
  // …and NOT the sales vocabulary. A block drawing the wrong entity's data is
  // worse than one drawing none, and "money over CARD/PIX" is precisely what
  // this template looked like it was doing before the catalog grew.
  await expect(block).not.toContainText('PIX');
});

test('a preparo template withholds the p90 below the sample floor', async ({ page }) => {
  await addTemplate(page, 'preparo-por-estacao');

  const block = page.getByTestId(`report-block-${NEW_REPORT_BLOCK}`);
  const montagem = block.locator('tbody tr').filter({ hasText: 'Montagem' });
  await expect(montagem).toBeVisible();
  // 6 lines against a floor of 20, so the timing is withheld and the counting
  // measure beside it is not — the catalog's `identityMinSample`, demonstrated.
  await expect(montagem).toContainText('—');
  await expect(montagem).toContainText('6');
  await expect(block.locator('tbody tr').filter({ hasText: 'Chapa' })).not.toContainText('—');
});

/**
 * The period toggle over a NEW entity.
 *
 * The window filter is the host's, applied per entity on that entity's own
 * date field — `readyAt` here, because a cozinha line belongs to the period in
 * which the work FINISHED. Six new entities is six new chances to wire that to
 * the wrong column, or to no column at all, and a report that ignores the
 * period looks identical to one that honours it until the counts are read.
 */
test('the period presets narrow the kitchen as well as the orders', async ({ page }) => {
  await addTemplate(page, 'preparo-por-estacao');

  const chapa = page
    .getByTestId(`report-block-${NEW_REPORT_BLOCK}`)
    .locator('tbody tr')
    .filter({ hasText: 'Chapa' });

  // 30 dias — every day the station worked.
  await expect(chapa).toContainText('31');

  await page.getByTestId('report-editor-range-item-7d').click();
  await expect(chapa).toContainText('28');

  await page.getByTestId('report-editor-range-item-today').click();
  // Four lines, and with them the p90 falls under the sample floor.
  await expect(chapa).toContainText('4');
  await expect(chapa).toContainText('—');
});

test('a losses template draws the ledger’s own reasons', async ({ page }) => {
  await addTemplate(page, 'perdas-por-motivo');

  const block = page.getByTestId(`report-block-${NEW_REPORT_BLOCK}`);
  await expect(block).toContainText('Quebra');
  await expect(block).toContainText('Vencimento');
});

/**
 * The ordered-axis rule (FUT-755), both ways round.
 *
 * A line draws the space BETWEEN two points as though it were data. Half-way
 * between 09:00 and 10:00 is 09:30; half-way between CARD and PIX is nothing.
 * So `hourOfDay` — a STRING, offerable as a line only because the catalog
 * declares `ordered` — must keep the line tile live, and `method` must refuse
 * it with a reason.
 *
 * Neither half was reachable while the harness catalog had no ordered string
 * dimension at all.
 */
test('line is offered on an ordered axis and refused on an unordered one', async ({ page }) => {
  await addTemplate(page, 'receita-por-dia');

  const axis = page.getByTestId('builder-dimension-0');
  const line = page.getByTestId('builder-chart-type-line');

  // The starter groups by date, which is ordered by TYPE.
  await expect(line).not.toHaveAttribute('aria-disabled', 'true');

  // An ordered STRING: only the catalog's flag says so.
  await axis.click();
  await page.getByRole('option', { name: 'Hora do dia' }).click();
  await expect(line).not.toHaveAttribute('aria-disabled', 'true');

  // An unordered one, and the picker says which control to change.
  await axis.click();
  await page.getByRole('option', { name: 'Forma de pagamento' }).click();
  await expect(line).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('builder-chart-type-area')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
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
 * is laid out so `Hoje` ⊂ `Este mês` ⊂ `7 dias` ⊂ `30 dias`, and each step must
 * be a strict change. Equal counts is exactly the shape of the bug.
 */
test('each period preset returns a different window of data', async ({ page }) => {
  await openFirstReport(page);

  const daily = page.getByTestId('report-block-daily');
  await expect(daily).toBeVisible({ timeout: 15_000 });
  const dayRows = daily.locator('tbody tr');

  // The report opens on 30 dias, the widest of the presets.
  await expect(daily.locator('tbody tr')).not.toHaveCount(0);
  const wide = await dayRows.count();

  await page.getByTestId('report-range-item-7d').click();
  await expect(daily).toBeVisible({ timeout: 15_000 });
  await expect(dayRows).toHaveCount(wide - 1);
  const week = await dayRows.count();

  // `Este mês` is month-TO-DATE (FUT-755), so on the 5th it is NARROWER than
  // seven days — one fewer bucket, because `o8` fell on 30 June. Asserted as a
  // distinct count and not merely "some rows": the whole risk in adding a
  // fourth preset is that it silently resolves to one of the three already
  // here, and equal counts is exactly the shape of that bug.
  await page.getByTestId('report-range-item-month').click();
  await expect(daily).toBeVisible({ timeout: 15_000 });
  await expect(dayRows).toHaveCount(week - 1);
  const month = await dayRows.count();

  await page.getByTestId('report-range-item-today').click();
  await expect(daily).toBeVisible({ timeout: 15_000 });
  // One local day, and it is `o6` — the only row on 2026-07-05 in São Paulo.
  await expect(dayRows).toHaveCount(1);

  expect(month).toBeGreaterThan(1);
  expect(week).toBeGreaterThan(month);
  expect(wide).toBeGreaterThan(week);
});

/**
 * "Personalizado…" end to end (FUT-755).
 *
 * The one preset whose meaning is not in its own name, so this is the case that
 * proves the two dates SURVIVE the trip: the picker → the transport →
 * `?preset=custom&from=…&to=…` → the package's own range resolver → the host
 * adapter's window → the rows. Any link that drops them leaves a window
 * resolved as something else, with nothing on screen saying so.
 *
 * The calendar opens on the window ALREADY on screen — 30 dias, which the
 * frozen clock puts at 06/06 – 05/07 — so it lands on June with no reference to
 * the machine's own date, and 20 and 25 each appear once in that grid.
 */
test('a custom period runs the window the picker asked for', async ({ page }) => {
  await openFirstReport(page);

  const daily = page.getByTestId('report-block-daily');
  await expect(daily).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('report-range-item-custom').click();
  await expect(page.getByTestId('report-range-custom')).toBeVisible();

  await page.getByTestId('calendar-month-0').getByTestId('calendar-date-20').click();
  await page.getByTestId('calendar-month-0').getByTestId('calendar-date-25').click();
  await page.getByTestId('report-range-custom-apply').click();

  await expect(daily).toBeVisible({ timeout: 15_000 });
  // 20–25 June holds exactly one order: `o7`, on the 20th.
  await expect(daily.locator('tbody tr')).toHaveCount(1);
  // …and the resolved-window line reads back the window that was asked for,
  // which is the half of this that comes from the SERVER rather than from the
  // control that set it.
  await expect(page.getByTestId('report-window')).toHaveText('20/06 – 25/06');
});

/**
 * The picker's two months sit BESIDE each other, and `Aplicar` stays reachable.
 *
 * This is a layout claim, so it is asserted here rather than in a unit test:
 * jsdom computes no geometry, and the emotion class that carries the dialog's
 * width means nothing there — a unit test could only re-state the prop, which
 * is the very thing that was wrong.
 *
 * What it caught: the dialog gained a quick-range column and kept the `md`
 * width it had as a bare calendar. The row no longer fit, so the second month
 * wrapped UNDER the first, doubling the dialog's height and pushing the
 * confirm button off a 900px screen — a period you could pick but not apply.
 */
test('the custom-period dialog fits its two months on one row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFirstReport(page);

  await page.getByTestId('report-range-item-custom').click();
  await expect(page.getByTestId('report-range-custom')).toBeVisible();

  const first = await page.getByTestId('calendar-month-0').boundingBox();
  const second = await page.getByTestId('calendar-month-1').boundingBox();
  if (!first || !second) throw new Error('both months should be rendered');

  // Same row, second to the right of the first. Comparing tops rather than
  // asserting an exact x keeps this about the WRAP, not about the gap.
  expect(Math.abs(first.y - second.y)).toBeLessThan(4);
  expect(second.x).toBeGreaterThan(first.x);

  // And the way out is on screen without scrolling the dialog.
  const apply = await page.getByTestId('report-range-custom-apply').boundingBox();
  if (!apply) throw new Error('Aplicar should be rendered');
  expect(apply.y + apply.height).toBeLessThanOrEqual(900);
});
