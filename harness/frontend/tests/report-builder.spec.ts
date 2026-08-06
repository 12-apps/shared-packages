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
