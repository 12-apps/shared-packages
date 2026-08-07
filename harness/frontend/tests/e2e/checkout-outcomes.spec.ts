import { expect, test } from '@playwright/test';

import {
  chooseCard,
  DECLINE_PAN,
  fillCard,
  openCase,
  openPage,
  payCard,
  reachPayment,
} from './helpers/checkout';

/**
 * The four ways a card charge ends, and why each gets a different screen
 * (FUT-743).
 *
 * They are not shades of "it failed". The shipped failure pipeline puts them in
 * a fixed order because each wrong answer causes a different harm, and every
 * one of them below is raised by that pipeline against a provider scripted to
 * fail that way — never by a page rendering an alert from local state.
 */

test('an issuer decline says nothing was charged, and offers the retry', async ({ page }) => {
  await openPage(page, 'payments-checkout-failures');
  await openCase(page, 'declined');
  await reachPayment(page);
  await chooseCard(page);

  await fillCard(page, DECLINE_PAN);
  await payCard(page);

  await expect(page.getByTestId('payment-failed')).toBeVisible();
  // A decline is recoverable by the buyer, so the retry is the whole point.
  await expect(page.getByTestId('payment-retry')).toBeVisible();
});

test('an UNRESOLVED charge removes the pay bar and offers no retry anywhere', async ({ page }) => {
  await openPage(page, 'payments-checkout-failures');
  await openCase(page, 'unresolved');
  await reachPayment(page);
  await chooseCard(page);

  await fillCard(page);
  await payCard(page);

  // Warning tone, not danger: some provider may be holding the buyer's money,
  // and heading it "não foi possível pagar" above a body that says "não pague
  // de novo" pushes them toward exactly the second payment it forbids.
  await expect(page.getByTestId('card-unresolved')).toBeVisible();

  // REMOVED, not disabled. A live "Pagar R$ …" under that message is what a
  // thumb reaches for, and a disabled one becomes live again on any re-render.
  await expect(page.getByTestId('card-pay-bar')).toHaveCount(0);
  await expect(page.getByTestId('card-pay')).toHaveCount(0);
  await expect(page.getByTestId('payment-retry')).toHaveCount(0);
  await expect(page.getByTestId('checkout-retry-payment')).toHaveCount(0);
});

test('an exhausted chain is worded by METHOD and leaves PIX on the table', async ({ page }) => {
  await openPage(page, 'payments-checkout-failures');
  await openCase(page, 'unavailable');
  await reachPayment(page);

  await chooseCard(page);
  await fillCard(page);
  await payCard(page);

  // 502, and nothing about the buyer's data was wrong — so the sentence names
  // the method that failed and points at the one that still works.
  await expect(page.getByTestId('card-error')).toContainText('cartão');
  await expect(page.getByTestId('card-error')).toContainText('PIX');
  // …and the PIX tile really is still there to take.
  await expect(page.getByTestId('checkout-method-PIX')).toBeVisible();
  // The pay bar survives: this failure IS retryable, unlike the one above.
  await expect(page.getByTestId('card-pay')).toBeVisible();
});

test('a charge with no CPF is refused by name, on the input that is missing', async ({ page }) => {
  await openPage(page, 'payments-checkout-buyer-fields');
  await openCase(page, 'server-refusal');

  await page.getByTestId('charge-without-cpf').click();

  // The refusal is the mount's own, off the wire — 400 before anything is sent
  // anywhere, naming the field rather than blaming the provider.
  await expect(page.getByTestId('refusal-code')).toHaveText('MISSING_BUYER_FIELD');
  await expect(page.getByTestId('refusal-field')).toHaveText('cpf');

  // And the name lands on that exact input, which is the half FUT-740's third
  // critical was missing: a buyer told "informe: taxId" at the top of a form
  // with no such box has been told nothing.
  await expect(page.getByTestId('buyer-cpf')).toHaveAttribute('aria-invalid', 'true');
});
