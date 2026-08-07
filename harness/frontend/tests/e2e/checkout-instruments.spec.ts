import { expect, test } from '@playwright/test';

import { fillCard, openCase, openPage, payCard, reachPayment } from './helpers/checkout';

/**
 * Reusing a vaulted card, and the refusal that must not read as a decline
 * (FUT-743 / FUT-697).
 *
 * The list is SCOPED to the store being paid, so an id the caller owns can
 * legitimately be unusable here. Answering that as a decline blames the buyer's
 * card for the merchant's configuration and sends them to re-enter a card they
 * have no reason to doubt.
 */

test('a vaulted card is offered, and charging it sends its id as the token', async ({ page }) => {
  await openPage(page, 'payments-checkout-saved-cards');
  await openCase(page, 'list-present');
  await reachPayment(page);

  await expect(page.getByTestId('saved-cards')).toBeVisible();
  await payCard(page);

  await expect(page.getByTestId('payment-paid')).toBeVisible();
  // The flat body names both a fresh token and a saved id with ONE field, and
  // only the vault can tell them apart — so the id travels as `token` and the
  // mount asks the vault before deciding. This is that body.
  await expect(page.getByTestId('wire-charge-body')).toContainText('card_visa_4242');
  // Resolved to the vault's own token before it reached the provider.
  await expect(page.getByTestId('provider-charges')).toContainText('vault:vault_card_visa_4242');
});

test('an empty list renders no picker at all', async ({ page }) => {
  await openPage(page, 'payments-checkout-saved-cards');
  await openCase(page, 'list-empty');
  await reachPayment(page);

  await expect(page.getByTestId('card-view')).toBeVisible();
  // Not a one-option radiogroup: absent. The buyer goes straight to the form.
  await expect(page.getByTestId('saved-cards')).toHaveCount(0);
  await expect(page.getByTestId('card-number')).toBeVisible();
});

test('an owned card this store cannot charge is "not usable here", not declined', async ({
  page,
}) => {
  await openPage(page, 'payments-checkout-saved-cards');
  await openCase(page, 'scope-mismatch');
  await reachPayment(page);

  await expect(page.getByTestId('saved-cards')).toBeVisible();
  await payCard(page);

  // The mount's own copy for a scope mismatch: re-enter the card, not "your
  // card was refused". Nothing was ever sent to a provider.
  await expect(page.getByTestId('card-error')).toContainText('não pode ser usado');
  await expect(page.getByTestId('provider-charge-count')).toHaveText('0');

  // The remedy really is available: the new-card form is one tap away and the
  // pay bar is still live, because this failure IS the buyer's to fix.
  await expect(page.getByTestId('card-pay')).toBeVisible();
  await page.getByTestId('saved-cards').getByRole('radio', { name: 'Novo cartão' }).click();
  await fillCard(page);
  await payCard(page);
  await expect(page.getByTestId('payment-paid')).toBeVisible();
});
