import { expect, test } from '@playwright/test';

import { fillCard, openPage, payCard, reachPayment } from './helpers/checkout';

/**
 * The two portability claims, in a browser (FUT-743).
 *
 * `@12-apps/payments-frontend` says two things about being adoptable, and
 * neither has ever been tested outside this repo's own assumptions:
 *
 *   1. the pixels are the HOST's, behind nine primitive slots. Both the
 *      fallbacks and this repo's one real filling are MUI, so a screen that
 *      reached for MUI directly would look identical either way.
 *   2. the FLAT exports are still the escape hatch. A factory that made
 *      mounting one line is exactly the change that lets the surface it was
 *      built on rot unnoticed.
 */

test('the same flow renders through a foreign design system, with the same test ids', async ({
  page,
}) => {
  await openPage(page, 'payments-checkout-slots');

  const mui = page.getByTestId('panel-slots-default');
  const foreign = page.getByTestId('panel-slots-foreign');

  // The same hook exists on both sides of the seam. That is the contract: an
  // e2e selector must find it whichever system drew the pixels, or every
  // existing spec silently becomes a spec about MUI.
  await expect(mui.getByTestId('checkout-continue')).toBeVisible();
  await expect(foreign.getByTestId('checkout-continue')).toBeVisible();

  // …and they really are different systems.
  await expect(foreign.getByTestId('checkout-continue')).toHaveAttribute('data-ds', 'foreign');
  await expect(mui.getByTestId('checkout-continue')).not.toHaveAttribute('data-ds', 'foreign');

  // The flow WORKS through the foreign table, not merely renders: the buyer
  // gets past the gate and reaches a picker built from foreign primitives.
  await foreign.getByTestId('buyer-cpf').fill('529.982.247-25');
  await foreign.getByTestId('checkout-continue').click();
  await expect(foreign.getByTestId('checkout-method-PIX')).toBeVisible();
  await expect(foreign.getByTestId('checkout-method-CARD')).toBeVisible();
});

test('the flat exports still compose a working checkout with no factory', async ({ page }) => {
  await openPage(page, 'payments-checkout-headless');

  // Read by hand through `createCheckoutClient`, not by any factory.
  await expect(page.getByTestId('headless-chain')).toHaveText('aurora');
  // …and the chain's own declaration, resolved by the exported helper.
  await expect(page.getByTestId('headless-required-fields')).toHaveText('taxId');

  await fillCard(page);
  await payCard(page);

  await expect(page.getByTestId('headless-outcome')).toHaveText('PAID');

  // The hand-composed charge is the SAME body the mounted pages send. If the
  // factory ever started sending something the flat client does not, these two
  // pages disagree — which is the only way to notice.
  const keys = page.getByTestId('wire-charge-keys');
  await expect(keys).toContainText('orderId');
  await expect(keys).toContainText('token');
  await expect(keys).toContainText('taxId');
  // …and what the provider RECEIVED, instrument included. The keys above are
  // the client's own record of what it sent; only this line fails if the mount
  // stops reading the flat body it sent them in.
  await expect(page.getByTestId('provider-charges')).toContainText('aurora:CARD:529.982.247-25:tok:');
});
