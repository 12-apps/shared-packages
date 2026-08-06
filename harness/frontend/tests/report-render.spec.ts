import { expect, test } from '@playwright/test';

/**
 * FUT-391: "Ver como tabela" is the accessibility fallback for a chart. An
 * aria-label summarising a twelve-point series is a sentence nobody can hold
 * in their head; the same numbers as a table are navigable cell by cell.
 *
 * So "it renders, and the toggle actually swaps it" IS the requirement, and it
 * cannot be asserted without a browser — this package's vitest runs with no
 * DOM at all.
 */

test('the published chart mounts from a real render model', async ({ page }) => {
  await page.goto('#/report-render');

  await expect(page.getByTestId('report-render-page')).toBeVisible();
  await expect(page.getByTestId('harness-render-chart')).toBeVisible();
  // The table is behind the toggle, not merely hidden beside the chart.
  await expect(page.getByTestId('harness-render-table')).toHaveCount(0);
});

test('the toggle swaps the chart for the same numbers', async ({ page }) => {
  await page.goto('#/report-render');

  await page.getByTestId('harness-render-as-table').click();

  const table = page.getByTestId('harness-render-table');
  await expect(table).toBeVisible();
  await expect(page.getByTestId('harness-render-chart')).toHaveCount(0);

  // The axis column, then the series — the chart's own reading order.
  await expect(table).toContainText('Data (dia)');
  await expect(table).toContainText('Receita');
  // Money is integer centavos: 3000 renders as R$ 30,00, not 3000.
  await expect(table).toContainText('30,00');
});

test('the toggle is reversible and says which view it offers', async ({ page }) => {
  await page.goto('#/report-render');

  const toggle = page.getByTestId('harness-render-as-table');
  await expect(toggle).toHaveText('Ver como tabela');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveText('Ver como gráfico');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await toggle.click();
  await expect(page.getByTestId('harness-render-chart')).toBeVisible();
});
