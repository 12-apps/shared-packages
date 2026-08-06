import { expect, test } from '@playwright/test';

/**
 * The PUBLISHED report list, in a browser.
 *
 * Its rules are unit-tested in the package, but under `environment: 'node'` —
 * no DOM. These are the assertions that need a real one: that the rules are
 * actually WIRED to the controls a person touches, and that the component
 * survives a bundler with the React entry's peers resolved.
 */

test('a card carries what distinguishes it from another report', async ({ page }) => {
  await page.goto('#/report-card-list');

  const card = page.getByTestId('reports-card-r1');
  await expect(card).toBeVisible();
  // The description is the whole reason a card beats a <select> option.
  await expect(card).toContainText('Receita diária separada por PIX');
});

test('search folds accents, so "relatorio" finds "Relatório"', async ({ page }) => {
  await page.goto('#/report-card-list');

  // The failure this guards reads as data loss: an owner types without the
  // accent, gets nothing back, and concludes the report is gone.
  await page.getByTestId('reports-search').fill('relatorio');
  await expect(page.getByTestId('reports-card-r2')).toBeVisible();
  await expect(page.getByTestId('reports-card-r1')).toHaveCount(0);
});

test('search matches the description, not only the name', async ({ page }) => {
  await page.goto('#/report-card-list');

  // "estoque" appears only in r2's description.
  await page.getByTestId('reports-search').fill('estoque');
  await expect(page.getByTestId('reports-card-r2')).toBeVisible();
  await expect(page.getByTestId('reports-card-r1')).toHaveCount(0);
});

test('a report with no description still renders', async ({ page }) => {
  await page.goto('#/report-card-list');

  // r3 is archived and has description: null — the wire type allows it, and a
  // card that crashes on one takes the whole list down.
  await page.getByTestId('reports-scope-archived').click();
  await expect(page.getByTestId('reports-card-r3')).toBeVisible();
  await expect(page.getByTestId('reports-card-r3')).toContainText('Ticket médio');
});

test('scope is exclusive: archived reports are not in the active list', async ({ page }) => {
  await page.goto('#/report-card-list');

  await expect(page.getByTestId('reports-card-r1')).toBeVisible();
  await expect(page.getByTestId('reports-card-r3')).toHaveCount(0);

  await page.getByTestId('reports-scope-archived').click();
  await expect(page.getByTestId('reports-card-r3')).toBeVisible();
  await expect(page.getByTestId('reports-card-r1')).toHaveCount(0);
});

test('the selected report survives a search that excludes it', async ({ page }) => {
  await page.goto('#/report-card-list');

  await page.getByTestId('reports-card-r1-open').click();
  await expect(page.getByTestId('list-selected')).toHaveText('r1');

  // Losing the thing you are looking at because you typed in a search box is a
  // worse surprise than an out-of-scope card staying put.
  await page.getByTestId('reports-search').fill('estoque');
  await expect(page.getByTestId('reports-card-r1')).toBeVisible();
});

test('selecting and creating reach the host', async ({ page }) => {
  await page.goto('#/report-card-list');

  await page.getByTestId('reports-card-r2-open').click();
  await expect(page.getByTestId('list-selected')).toHaveText('r2');

  await page.getByTestId('reports-new').click();
  await expect(page.getByTestId('list-created')).toHaveText('1');
});
