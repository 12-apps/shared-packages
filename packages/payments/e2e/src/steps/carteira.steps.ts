import { expect } from '@playwright/test';

import { paymentsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * PAYING WITH A DIGITAL WALLET (FUT-471) — the CARD pane's fast lane.
 *
 * The wallet is not a fourth method: the buyer still walks Dados and still
 * lands on the CARD pane; what changes is that the instrument comes from the
 * wallet sheet instead of typed digits. So these steps sit beside the buyer's
 * card gestures, and the Givens name store shapes exactly like `loja.steps.ts`.
 *
 * The button element itself is rendered by the wallet's own script (brand
 * rules), inside the package's `google-pay-button` container — a host
 * satisfies the store shape by installing a `google.payments.api` stub before
 * the checkout loads, which the shipped button picks up without a network
 * request.
 */

Given('a compradora abre o checkout de uma loja com Google Pay', async ({ page }) => {
  await paymentsWorld().open(page, 'google-pay');
});

When('ela paga com o Google Pay', async ({ page }) => {
  await page.getByTestId('google-pay-button').click();
});

Then('ela vê o botão do Google Pay', async ({ page }) => {
  await expect(page.getByTestId('google-pay-button')).toBeVisible();
});

Then('nenhum botão do Google Pay é mostrado', async ({ page }) => {
  await expect(page.getByTestId('google-pay-button')).toHaveCount(0);
});

Then('a cobrança enviada ao provedor carrega a carteira do Google', async ({ page }) => {
  // What the PROVIDER received, not what the client recorded sending: hosts
  // tag a provider-charge line with `wallet:<TYPE>` when the charge's card
  // block carried a wallet instrument, the same way the card line carries
  // `tok:`. This is the line that fails if the mount stops reading the flat
  // wallet body — the sheet then produced a token the charge never carried.
  await expect(paymentsWorld().wire.providerCharges(page)).toContainText('wallet:GOOGLE_PAY');
});
