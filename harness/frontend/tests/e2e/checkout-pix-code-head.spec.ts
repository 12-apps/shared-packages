import { expect, test } from '@playwright/test';

import { chooseListOption, fillCard, openCase, openPage, reachPayment, showListPixQr } from './helpers/checkout';

/**
 * A PIX-only provider that answers with a CODE for this page, ahead of a
 * provider that takes the card on its own page — the shape of a store with a
 * bank's Pix API first and a hosted card checkout second.
 *
 * The checkout used to read that store as a hand-off because every card taker
 * was hosted, and PIX was never asked about: the buyer got a "continue to the
 * provider" pane whose spinner never ended, no QR and no way to pick card. On
 * the one list (FUT-4028) the store draws both rows.
 */

test('both rows stay, and PIX paints its QR here from the code alone', async ({ page }) => {
  await openPage(page, 'payments-checkout-provider-screens');
  await openCase(page, 'screen-pix-code-head');
  await reachPayment(page);

  await expect(page.getByTestId('list-option-PIX')).toBeVisible();
  await expect(page.getByTestId('list-option-CARD')).toBeVisible();

  await chooseListOption(page, 'PIX');
  await page.getByTestId('list-pay').click();
  // Drawn in the browser from the BR Code: the provider sent no image.
  await showListPixQr(page);
  await expect(page.getByTestId('checkout-handoff-pending')).toHaveCount(0);
  await expect(page.getByTestId('provider-charges')).toContainText('cerrado');
});

test('the card still leaves for the hosted page of the provider that takes it', async ({ page }) => {
  await openPage(page, 'payments-checkout-provider-screens');
  await openCase(page, 'screen-pix-code-head');
  await reachPayment(page);

  // The card row is the hosted provider's: the bar's action takes her there.
  await chooseListOption(page, 'CARD');
  await fillCard(page);
  await page.getByTestId('list-pay').click();
  await expect(page.getByTestId('host-navigated')).toContainText('boreal.example');
});
