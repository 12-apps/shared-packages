import { expect, test } from '@playwright/test';

/**
 * `@12-apps/report-builder` mounted the way a host mounts it: one call to
 * `createReportBuilder`, no route table, no screen imported by name.
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

test('the list offers the seeded reports, scoped', async ({ page }) => {
  await page.goto('#/report-builder');

  const list = page.getByTestId('page-reports');
  await expect(list).toContainText('Vendas por forma de pagamento');
  // Scope pills, from the card list inside the package.
  await expect(list).toContainText('Todos (1)');
  await expect(list).toContainText('Arquivados (1)');
});

test('the selected report runs through the published pipeline', async ({ page }) => {
  await page.goto('#/report-builder');

  // The area opens with a report already chosen — it is a picker AND a viewer,
  // so the canvas is reachable without a further navigation.
  const revenue = page.getByTestId('report-block-revenue');
  await expect(revenue).toBeVisible({ timeout: 15_000 });

  // Compiled, executed against the harness's in-memory adapter and rendered by
  // the package: the bar chart's own categories, not fixture text.
  await expect(revenue).toContainText('PIX');
  await expect(revenue).toContainText('CARD');
});

test('an untitled block is named by its own spec sentence', async ({ page }) => {
  await page.goto('#/report-builder');

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
  await page.goto('#/report-builder');

  const revenue = page.getByTestId('report-block-revenue');
  await expect(revenue).toBeVisible({ timeout: 15_000 });
  await expect(revenue.locator('h2')).toHaveText('Receita por forma');
  // The name does not say it is filtered to paid orders; the sentence does.
  await expect(page.getByTestId('report-block-revenue-description')).toHaveText(
    'soma de receita em pedidos por forma de pagamento, onde status é PAID',
  );
});

test('a chart offers its table fallback', async ({ page }) => {
  await page.goto('#/report-builder');

  const revenue = page.getByTestId('report-block-revenue');
  await expect(revenue).toBeVisible({ timeout: 15_000 });
  // The accessibility fallback, reachable on the real surface rather than on a
  // page the harness built to show it.
  await expect(revenue.getByText('Ver como tabela')).toBeVisible();
});
