import { expect, test } from '@playwright/test';

/**
 * The published report-builder, driven in a browser: a catalog and a spec go
 * in, a rendered table and a spec sentence come out.
 *
 * The backend harness proves the same pipeline server-side. This one proves it
 * survives a bundler and a browser — the package ships its compiler, executor
 * and render model as isomorphic code, and "isomorphic" is a claim until
 * something runs it on both sides.
 */
test('the published pipeline compiles, executes and renders in a browser', async ({ page }) => {
  await page.goto('#/report-builder');

  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'report-builder');
  await expect(page.getByTestId('report-builder')).toBeVisible();

  // Grouped by payment method: PIX 1000 + 3000, CARD 2000.
  const byMethod = page.getByTestId('report-block-by-method-table');
  await expect(byMethod).toBeVisible();
  await expect(page.getByTestId('report-block-by-method-row')).toHaveCount(2);
  await expect(byMethod).toContainText('PIX');
  await expect(byMethod).toContainText('CARD');
});

test('every block states its spec in Portuguese', async ({ page }) => {
  await page.goto('#/report-builder');

  await expect(page.getByTestId('report-block-by-method-sentence')).toHaveText(
    'soma de receita em pedidos por forma de pagamento',
  );

  // The sentence tracks the spec — a filtered, date-bucketed block says so.
  await expect(page.getByTestId('report-block-by-day-pix-sentence')).toHaveText(
    'soma de receita em pedidos por data (dia), onde forma de pagamento é PIX',
  );
});

test('an untitled block is named after its spec', async ({ page }) => {
  await page.goto('#/report-builder');

  await expect(page.getByTestId('report-block-by-method-title')).toHaveText(
    'Soma de receita em pedidos por forma de pagamento',
  );
});

/**
 * FUT-391: a closed-set field is filtered by PICKING. The failure this guards
 * is invisible at runtime — a mistyped code compiles and matches no rows, so
 * the block reads as "no data" rather than as the typo it is.
 */
test('a closed-set field offers a picker, not a text box', async ({ page }) => {
  await page.goto('#/report-builder');

  const picker = page.getByTestId('filter-value-select');
  await expect(picker).toBeVisible();
  // There is no text box to mistype a code into.
  await expect(page.getByTestId('filter-value-input')).toHaveCount(0);

  // Labels are shown; the SPEC carries the code.
  await expect(picker).toContainText('Cartão');
  await expect(page.getByTestId('filter-spec-value')).toHaveText('PIX');

  await picker.selectOption('CARD');
  await expect(page.getByTestId('filter-spec-value')).toHaveText('CARD');
});

test('an open-ended field falls back to a text box', async ({ page }) => {
  await page.goto('#/report-builder');

  await page.getByTestId('filter-field').selectOption('totalCents');
  await expect(page.getByTestId('filter-value-input')).toBeVisible();
  await expect(page.getByTestId('filter-value-select')).toHaveCount(0);
});

test('changing the field resets the value, so no stale code survives', async ({ page }) => {
  await page.goto('#/report-builder');

  await page.getByTestId('filter-value-select').selectOption('CARD');
  await expect(page.getByTestId('filter-spec-value')).toHaveText('CARD');

  // money → the previous enum code must not survive as `totalCents eq CARD`.
  await page.getByTestId('filter-field').selectOption('totalCents');
  await expect(page.getByTestId('filter-spec-value')).toHaveText('(vazio)');

  // …and back: a legal first value, not the blank left behind.
  await page.getByTestId('filter-field').selectOption('method');
  await expect(page.getByTestId('filter-spec-value')).toHaveText('PIX');
});

test('operators come from the field, not one global list', async ({ page }) => {
  await page.goto('#/report-builder');

  // A closed set is never ordered: no gte/lte on an enum.
  const operators = page.getByTestId('filter-operator');
  await expect(operators).toContainText('eq');
  await expect(operators).not.toContainText('gte');

  await page.getByTestId('filter-field').selectOption('totalCents');
  await expect(operators).toContainText('gte');
});
