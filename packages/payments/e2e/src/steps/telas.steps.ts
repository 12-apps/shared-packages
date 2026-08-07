import { expect } from '@playwright/test';

import { paymentsWorld } from '../world.js';

import { Given, Then } from './fixtures.js';

/**
 * WHICH SCREEN THE STORE'S PROVIDER ASKED FOR (FUT-596, packaged by FUT-561).
 *
 * These are facts about the merchant's adapter, so they sit beside
 * `loja.steps.ts`'s Givens rather than in the buyer's own file — the buyer does
 * nothing differently in any of them, which is exactly the claim: she fills the
 * same form and presses the same button, and the pane underneath is whichever
 * the provider declared.
 *
 * The store shapes are declarative, so a host satisfies them however it can:
 * the harness declares a chain in-page, a real app seeds a tenant whose adapter
 * declares the id. Either way the id is published by `GET /checkout/config` and
 * resolved by the checkout, so these fail if the field is dropped anywhere
 * along that path.
 */

Given('a loja declara que cobra na própria página', async ({ page }) => {
  await paymentsWorld().open(page, 'screen-on-page');
});

Given('a loja declara que a compradora termina no provedor', async ({ page }) => {
  await paymentsWorld().open(page, 'screen-handoff');
});

/** Stone and Stripe today: the capability default answers for them. */
Given('a loja não declara tela nenhuma', async ({ page }) => {
  await paymentsWorld().open(page, 'screen-undeclared');
});

/**
 * A newer server against an older bundle. The two packages version
 * independently, so this is an ordinary deployment state — and the one where
 * "unknown id ⇒ render nothing" would take the whole checkout down silently.
 */
Given('a loja declara uma tela que este pacote não conhece', async ({ page }) => {
  await paymentsWorld().open(page, 'screen-unknown');
});

Then('ela é avisada de que vai ser levada para o provedor', async ({ page }) => {
  await expect(page.getByTestId('checkout-handoff-pending')).toBeVisible();
});
