import { expect, test, type Page } from '@playwright/test';
import { listPixCode, showListPixQr } from '@12-apps/payments-e2e';

import { openCase, openPage, reachPayment } from './helpers/checkout';

/**
 * The ONE list's Pix, on both of its faces (FUT-4028).
 *
 * Without the host's bank flow, "Gerar Pix" raises the code and shows it with
 * its QR. With it (`pixBank`, FUT-3612), the button generates AND copies, and
 * the Pix opens on its after-copy face — "Código Pix copiado", what to do in
 * the bank app — whose QR is one tap away. The packaged journey "O PIX já vem
 * marcado" runs on the second (its `awaiting` store is the bank-flow case);
 * this spec keeps both, and says which face each one is.
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('without the bank flow, the code and its QR are on the face', async ({ page }) => {
  await openPage(page, 'payments-checkout-pix', { checkout: 'list' });
  await openCase(page, 'awaiting');
  await reachPayment(page);

  await expect(page.getByTestId('list-pix')).toBeVisible();
  await expect(page.getByTestId('list-pix-code')).toContainText(/br\.gov\.bcb\.pix/i);
  await showListPixQr(page);
  await expect(page.getByTestId('list-pix-qr').locator('svg')).toBeVisible();
});

/** Open the bank-flow store and land on its after-copy face; returns the code copied. */
async function copiedByTheBankFlow(page: Page): Promise<string> {
  await openPage(page, 'payments-checkout-pix', { checkout: 'list' });
  await openCase(page, 'awaiting-bank');
  await reachPayment(page);
  // Copied as it was generated: the after-copy face, which draws no code.
  await expect(page.getByTestId('pix-after-copy')).toBeVisible();
  await expect(page.getByTestId('list-pix-code')).toHaveCount(0);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/br\.gov\.bcb\.pix/i);
  return copied;
}

test('with the bank flow on a computer, the QR stands beside the steps', async ({ page }) => {
  const copied = await copiedByTheBankFlow(page);
  await expect(page.getByTestId('pix-show-qr')).toBeHidden();
  await showListPixQr(page);
  await expect(page.getByTestId('pix-after-copy').locator('[role="img"]')).toBeVisible();
  expect(await listPixCode(page)).toBe(copied);
});

test('with the bank flow on a phone, "Ver QR code" brings the code and its QR back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const copied = await copiedByTheBankFlow(page);
  await showListPixQr(page);
  await expect(page.getByTestId('pix-after-copy')).toHaveCount(0);
  await expect(page.getByTestId('list-pix-qr').locator('svg')).toBeVisible();
  await expect(page.getByTestId('list-pix-code')).toHaveText(copied);
  expect(await listPixCode(page)).toBe(copied);
});
