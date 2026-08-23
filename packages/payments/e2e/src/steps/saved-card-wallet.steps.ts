import { expect } from '@playwright/test';

import { CARD_EXPIRY_SHOWN, DECLINE_PAN, fillCard } from '../helpers/checkout.js';

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
  //
  // Asserted as DIGITS, not as sentences (FUT-760). The expiry line used to be
  // matched on the word "Validade", which was the package's own hard-coded
  // label — so the assertion held only for a host that had inherited it, and
  // said nothing at all about the host under test. "Validade", "Vence em" and
  // "Expires" are one fact worded three ways; the numbers beside them are the
  // fact, and the mask is what proves the PAN is not on screen.
  const list = page.getByTestId('manage-cards-list');
  // A mask and exactly four digits after it — the shape, not which four: the
  // last4 is whatever the store's vault answered, and pinning it here would
  // make this journey a test of one host's stub.
  await expect(list).toContainText(/•••• {0,1}\d{4}/);
  await expect(list).toContainText(CARD_EXPIRY_SHOWN);
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
