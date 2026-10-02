import { expect, test } from '@playwright/test';

import { openCase, openPage, reachPayment } from './helpers/checkout';

/**
 * A Pix the STORE confirms by hand (FUT-3232). The host marks the code
 * `confirmation: 'MANUAL'`, and the pane must say who the buyer is waiting
 * for: the store, never an automatic confirmation from the bank. The
 * sentences are this HOST's own `pix.manual` block, not the library's.
 *
 * Read at every width of the ladder, because the longer sentences are the
 * ones that wrap; with SHOT_DIR set, each width is photographed for review.
 */
const WIDTHS = [
  { name: 'xxs', width: 320, height: 568 },
  { name: 'xs', width: 390, height: 844 },
  { name: 'sm', width: 600, height: 900 },
  { name: 'md', width: 900, height: 1180 },
  { name: 'lg', width: 1280, height: 800 },
  { name: 'xlg', width: 1920, height: 1080 },
] as const;

for (const viewport of WIDTHS) {
  test(`the store-confirmed Pix waits for the store at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openPage(page, 'payments-checkout-pix');
    await openCase(page, 'manual');
    await reachPayment(page);

    const pane = page.getByTestId('pix-view');
    await expect(page.getByTestId('pix-awaiting')).toHaveText('Esperando a loja confirmar o pagamento…');
    await expect(pane).toContainText('A loja confere e confirma o seu pedido.');
    await expect(page.getByTestId('pix-expiry')).toContainText('A loja confirma o pagamento até');
    await expect(pane).not.toContainText(/automátic/i);

    const shotDir = process.env.SHOT_DIR;
    if (shotDir) {
      await pane.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shotDir}/t2-pix-manual-${viewport.name}.png`, fullPage: true });
    }
    testInfo.annotations.push({ type: 'width', description: String(viewport.width) });
  });
}

test('an automatic Pix still promises the automatic confirmation', async ({ page }) => {
  await openPage(page, 'payments-checkout-pix');
  await openCase(page, 'awaiting');
  await reachPayment(page);

  await expect(page.getByTestId('pix-awaiting')).toHaveText('Esperando o pagamento…');
  await expect(page.getByTestId('pix-expiry')).toContainText(/automática/);
  const shotDir = process.env.SHOT_DIR;
  if (shotDir) await page.screenshot({ path: `${shotDir}/t2-pix-automatic-xs.png`, fullPage: true });
});
