import { expect, test, type Page } from '@playwright/test';

/**
 * The one list's deferred parts and its store-credit rows, in a real browser
 * against the published tarball (FUT-3711).
 *
 * - The CPF/wallet top is a chunk of its own, started at list mount; the top
 *   and the rows land TOGETHER, so the first row is never drawn and then
 *   pushed down under a finger.
 * - On a computer, "Resumo do pedido" draws the credit and "A pagar" only
 *   while an online option is chosen — the only time the button charges the
 *   amount due — and drops them when the host stops applying the credit.
 */

async function openCase(page: Page, id: string): Promise<void> {
  await page.goto('#/payments-checkout-list');
  await page.getByTestId(`harness-case-${id}`).click();
}

test.describe('the top and the rows', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('land together: the first row never moves once drawn', async ({ page }) => {
    await openCase(page, 'both');
    const row = page.getByTestId('list-option-CARD');
    await expect(row).toBeVisible();
    // The top is already there when the first row is.
    await expect(page.getByTestId('list-top')).toBeVisible();
    const first = await row.boundingBox();
    await expect(page.getByTestId('list-buyer-taxId')).toBeVisible();
    await expect(page.getByTestId('list-wallets')).toBeVisible();
    await expect.poll(async () => (await row.boundingBox())?.y).toBe(first?.y);
  });
});

test.describe('store credit in the column', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('is drawn for an online choice, and not for a door one or once the host stops applying it', async ({ page }) => {
    await openCase(page, 'credit');
    const column = page.getByTestId('list-summary-column');
    await page.getByTestId('list-option-PIX').click();
    await expect(column.getByTestId('list-summary-due-row')).toHaveText(/A pagar\s*R\$\s*22,00/);
    await expect(column.getByTestId('list-pay')).toContainText('22,00');

    await page.getByTestId('list-door-cash').click();
    await expect(column.getByTestId('list-summary-credit')).toHaveCount(0);
    await expect(column.getByTestId('list-pay')).toContainText('27,00');

    await page.getByTestId('list-option-PIX').click();
    await expect(column.getByTestId('list-summary-credit')).toBeVisible();
    await page.getByTestId('harness-store-credit').getByRole('checkbox').uncheck();
    await expect(column.getByTestId('list-summary-credit')).toHaveCount(0);
    await expect(column.getByTestId('list-pay')).toContainText('27,00');
  });
});
