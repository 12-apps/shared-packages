import { expect, type Page } from '@playwright/test';

import { DECLINE_PAN, fillCard, fillCpf } from '../helpers/checkout.js';

import { paymentsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * ACTIVATING A PROVIDER (FUT-463, made real for every SDK provider by
 * FUT-689) — the merchant admin's side of the till.
 *
 * The package renders the switch and its lock (`payments-enabled-toggle`,
 * `payments-enable-hint`, `payments-status`); the activation step itself is
 * HOST-owned, rendered into the `renderVerification` slot. So these steps
 * read two vocabularies:
 *
 *   - the package's own test ids, which mean the same thing in any host;
 *   - the activation-step contract a host's slot must render — the shared
 *     card form (`card-number`…, `buyer-cpf`) plus `activation-pay`,
 *     `activation-result`, `activation-refunded`, `activation-error`, and the
 *     fixture probe pair `activation-enable-attempt` /
 *     `activation-enable-refusal` (a raw enable request and the refusal it
 *     gets, the same affordance the wire probe is).
 *
 * The card the owner types decides the outcome, exactly as in the wallet
 * journey: the shared `DECLINE_PAN` is refused with a named reason, any other
 * valid card pays the cent and gets it back.
 */

/** The "Recebendo vendas" switch — MUI puts the state on the inner checkbox. */
function salesSwitch(page: Page): ReturnType<Page['getByTestId']> {
  return page.getByTestId('payments-enabled-toggle').getByRole('checkbox');
}

Given('the owner opens the settings of a connected but unproven provider', async ({ page }) => {
  await paymentsWorld().open(page, 'activation');
});

Then('the sales switch is locked off until a real charge lands', async ({ page }) => {
  await expect(salesSwitch(page)).toBeDisabled();
  // The package's own lock hint — the quoted words are its pt-BR product copy.
  await expect(page.getByTestId('payments-enable-hint')).toContainText('depois dos 3 passos');
});

When('the owner tries to force the provider on anyway', async ({ page }) => {
  await page.getByTestId('activation-enable-attempt').click();
});

Then('the enable request is refused as unproven', async ({ page }) => {
  // The package's own refusal, by name: the server said no, not the screen.
  await expect(page.getByTestId('activation-enable-refusal')).toContainText('409');
  await expect(page.getByTestId('activation-enable-refusal')).toContainText('UnprovenProviderError');
});

When('the owner pays the verification charge with their card', async ({ page }) => {
  await fillCard(page);
  await fillCpf(page);
  await page.getByTestId('activation-pay').click();
});

When('the owner pays the verification charge with a refused card', async ({ page }) => {
  await fillCard(page, DECLINE_PAN);
  await fillCpf(page);
  await page.getByTestId('activation-pay').click();
});

Then('the provider is proven and receiving sales', async ({ page }) => {
  // VERIFICADO is reserved for a landed charge — the chip's one green word.
  await expect(page.getByTestId('payments-status')).toHaveText('VERIFICADO');
  await expect(salesSwitch(page)).toBeChecked();
});

Then('the screen says the cent came back', async ({ page }) => {
  // The refund fact, in the screen's own pt-BR copy.
  await expect(page.getByTestId('activation-refunded')).toContainText('estornado');
});

Then("the refusal names the provider's reason", async ({ page }) => {
  await expect(page.getByTestId('activation-error')).toContainText('recusada');
  await expect(page.getByTestId('activation-error')).toContainText('CARD_DECLINED');
});

Then('the provider received each attempt as its own charge', async ({ page }) => {
  // Two charges REACHED the provider: a retry that replayed the first
  // refusal would have left this at one.
  await expect(paymentsWorld().wire.providerChargeCount(page)).toHaveText('2');
});
