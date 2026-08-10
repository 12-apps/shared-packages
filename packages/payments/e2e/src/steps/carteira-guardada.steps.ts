import { expect } from '@playwright/test';

import { DECLINE_PAN, fillCard } from '../helpers/checkout.js';

import { paymentsWorld } from '../world.js';

import { Given, Then, When } from './fixtures.js';

/**
 * GUARDING A CARD WITHOUT BUYING (FUT-183, over FUT-478's buyer vault rows).
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

Given('a compradora abre a carteira de cartões da loja', async ({ page }) => {
  await paymentsWorld().open(page, 'wallet');
});

When('ela decide adicionar um cartão', async ({ page }) => {
  await page.getByTestId('manage-cards-add').click();
  // Wait for the FORM, not merely the click: `/cards/begin` runs in between,
  // and typing into a form that has not mounted is the flake this avoids.
  await expect(page.getByTestId('add-card')).toBeVisible();
});

When('ela preenche o cartão e salva', async ({ page }) => {
  await fillCard(page);
  await page.getByTestId('add-card-save').click();
});

When('ela tenta guardar um cartão recusado', async ({ page }) => {
  await fillCard(page, DECLINE_PAN);
  await page.getByTestId('add-card-save').click();
});

Then('o cartão fica guardado e aparece na lista', async ({ page }) => {
  await expect(page.getByTestId('add-card-saved')).toBeVisible();
  await expect(page.getByTestId('manage-cards-list')).toBeVisible();
  await expect(page.getByTestId('manage-cards-empty')).toHaveCount(0);
});

Then('a lista mostra só a bandeira e o final do cartão', async ({ page }) => {
  // Display metadata ONLY. The vault token — the thing that can charge —
  // never reaches this screen; what she reads back is brand + last4 + expiry.
  const list = page.getByTestId('manage-cards-list');
  await expect(list).toContainText('••••');
  await expect(list).toContainText('Validade');
});

Then('a recusa explica o motivo e o formulário continua na tela', async ({ page }) => {
  // The endpoint's own reason, and the form kept editable under it — wiping
  // her input to say "recusado" would be the screen working against her.
  await expect(page.getByTestId('add-card-error')).toBeVisible();
  await expect(page.getByTestId('add-card-error')).toContainText('cartão');
  await expect(page.getByTestId('card-number')).toBeVisible();
});

Then('a carteira continua sem nenhum cartão', async ({ page }) => {
  await expect(page.getByTestId('manage-cards-empty')).toBeVisible();
  await expect(page.getByTestId('manage-cards-list')).toHaveCount(0);
});

Then('a carteira vazia convida a guardar o primeiro cartão', async ({ page }) => {
  await expect(page.getByTestId('manage-cards-empty')).toBeVisible();
  await expect(page.getByTestId('manage-cards-add')).toBeVisible();
});
