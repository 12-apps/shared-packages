import { expect, test } from '@playwright/test';

import { openCase, openPage } from './helpers/checkout';

/**
 * When a store cannot charge, and who gets to say so (FUT-743).
 *
 * `storeCannotCharge` is an OR of two different facts, and narrowing it to
 * either one is a live regression rather than a hypothetical:
 *
 *   - keep only the chain, and a store that has switched online payments off
 *     starts offering a checkout it will not honour;
 *   - keep only the host, and a store that simply never connected a provider
 *     gets a payment step it cannot serve.
 */

test('an empty chain renders the unavailable screen and never touches the wire', async ({
  page,
}) => {
  await openPage(page, 'payments-checkout-no-provider');
  await openCase(page, 'empty-chain');

  await expect(page.getByTestId('checkout-payments-disabled')).toBeVisible();

  // Nothing that could take money is on screen at all — not disabled, absent.
  await expect(page.getByTestId('checkout-method')).toHaveCount(0);
  await expect(page.getByTestId('card-view')).toHaveCount(0);
  await expect(page.getByTestId('pix-view')).toHaveCount(0);

  // And nothing was raised. The config read is the ONLY request on the wire —
  // a store that cannot charge must not have a payable brought into existence.
  await expect(page.getByTestId('wire-paths')).toHaveText('GET /api/checkout/config');
});

test('a host remedy is a different sentence, with something to do', async ({ page }) => {
  await openPage(page, 'payments-checkout-no-provider');
  await openCase(page, 'empty-chain-remedy');

  // The other screen entirely: the remedy exists, so the buyer is offered it
  // rather than told to arrange payment with the store.
  await expect(page.getByTestId('checkout-payments-remedy')).toBeVisible();
  await expect(page.getByTestId('checkout-payments-disabled')).toHaveCount(0);
  await expect(page.getByTestId('checkout-payments-remedy-action')).toBeVisible();
});

test('the host veto beats a chain that would otherwise charge', async ({ page }) => {
  await openPage(page, 'payments-checkout-no-provider');
  await openCase(page, 'host-veto');

  // The chain is live and the config read succeeds — the store still cannot
  // charge, because online payments are switched off and only the host knows.
  await expect(page.getByTestId('wire-paths')).toHaveText('GET /api/checkout/config');
  await expect(page.getByTestId('checkout-payments-disabled')).toBeVisible();
  await expect(page.getByTestId('checkout-method')).toHaveCount(0);
});
