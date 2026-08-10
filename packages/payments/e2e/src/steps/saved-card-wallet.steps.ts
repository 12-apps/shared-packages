import { expect } from '@playwright/test';

import { DECLINE_PAN, fillCard } from '../helpers/checkout.js';

import { paymentsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * SAVING A CARD WITHOUT BUYING (FUT-183, over FUT-478's buyer vault rows).
 *
 * A separate file from `carteira.steps.ts` on purpose: that one is the DIGITAL
 * wallets (Google Pay / Apple Pay) — a faster way to pay inside checkout.
 * These steps are the SAVED-CARD wallet: the package's manage-cards surface,
 * reached outside any purchase, where nothing is charged at all.
 *
 * Every Then reads a test id the package's own vault screens render
 * (`manage-cards*`, `add-card*`), plus the shared card form ids — so the
 * journey means the same thing in any host that mounts `screens.ManageCards`.
 * The card the buyer types decides the outcome: the shared `DECLINE_PAN` is
 * the one the stub refuses at validation.
 */

Given("the shopper opens the store's card wallet", async ({ page }) => {
  await paymentsWorld().open(page, 'wallet');
});

When('she decides to add a card', async ({ page }) => {
  await page.getByTestId('manage-cards-add').click();
  // Wait for the FORM, not merely the click: `/cards/begin` runs in between,
  // and typing into a form that has not mounted is the flake this avoids.
  await expect(page.getByTestId('add-card')).toBeVisible();
});

When('she fills in the card and saves it', async ({ page }) => {
  await fillCard(page);
  await page.getByTestId('add-card-save').click();
});

When('she tries to save a refused card', async ({ page }) => {
  await fillCard(page, DECLINE_PAN);
  await page.getByTestId('add-card-save').click();
});

Then('the card is stored and appears in the list', async ({ page }) => {
  await expect(page.getByTestId('add-card-saved')).toBeVisible();
  await expect(page.getByTestId('manage-cards-list')).toBeVisible();
  await expect(page.getByTestId('manage-cards-empty')).toHaveCount(0);
});

Then('the list shows only the brand and the last digits', async ({ page }) => {
  // Display metadata ONLY. The vault token — the thing that can charge —
  // never reaches this screen; what she reads back is brand + last4 + expiry.
  // The quoted strings are the screen's pt-BR product copy, asserted as-is.
  const list = page.getByTestId('manage-cards-list');
  await expect(list).toContainText('••••');
  await expect(list).toContainText('Validade');
});

Then('the refusal explains why and the form stays on screen', async ({ page }) => {
  // The endpoint's own reason, and the form kept editable under it — wiping
  // her input to say the card was refused would be the screen working
  // against her. The asserted word is the pt-BR product copy of the reason.
  await expect(page.getByTestId('add-card-error')).toBeVisible();
  await expect(page.getByTestId('add-card-error')).toContainText('cartão');
  await expect(page.getByTestId('card-number')).toBeVisible();
});

Then('the wallet still holds no card', async ({ page }) => {
  await expect(page.getByTestId('manage-cards-empty')).toBeVisible();
  await expect(page.getByTestId('manage-cards-list')).toHaveCount(0);
});

Then('the empty wallet invites saving the first card', async ({ page }) => {
  await expect(page.getByTestId('manage-cards-empty')).toBeVisible();
  await expect(page.getByTestId('manage-cards-add')).toBeVisible();
});
