import { expect } from '@playwright/test';

import { openCase } from '../helpers/checkout';

import { Given, Then } from './fixtures';

/**
 * WHICH SCREEN THE STORE'S PROVIDER ASKED FOR (FUT-596).
 *
 * These are facts about the merchant's adapter, so they live beside
 * `loja.steps.ts`'s Givens rather than in the buyer's own file — the buyer does
 * nothing differently in any of them, which is exactly the claim: she fills the
 * same form and presses the same button, and the pane underneath is whichever
 * the provider declared.
 *
 * Each maps to a case on `payments-checkout-provider-screens`, and every case
 * there is a real `createPaymentFlowsBE` mount whose chain declares a screen id
 * the way a shipped adapter does. Nothing is stubbed at the component level:
 * the id is published by `GET /checkout/config` and resolved by the checkout,
 * so these scenarios fail if the field is dropped anywhere along that path.
 *
 * The store names are invented on purpose. A screen id names the SHAPE of the
 * flow rather than a vendor, so a fictional store reaches the same component a
 * real acquirer would — and a vendor name in this file would be a hard error
 * (`payments/no-provider-name-literal`) anyway.
 */

Given('a loja declara que cobra na própria página', async ({ page }) => {
  await openCase(page, 'screen-on-page');
});

Given('a loja declara que a compradora termina no provedor', async ({ page }) => {
  await openCase(page, 'screen-handoff');
});

/** Stone and Stripe today: the capability default answers for them. */
Given('a loja não declara tela nenhuma', async ({ page }) => {
  await openCase(page, 'screen-undeclared');
});

/**
 * A newer server against an older bundle. The two packages version
 * independently, so this is an ordinary deployment state — and the one where
 * "unknown id ⇒ render nothing" would take the whole checkout down silently.
 */
Given('a loja declara uma tela que este pacote não conhece', async ({ page }) => {
  await openCase(page, 'screen-unknown');
});

Then('ela é avisada de que vai ser levada para o provedor', async ({ page }) => {
  await expect(page.getByTestId('checkout-handoff-pending')).toBeVisible();
});
