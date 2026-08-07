import { expect, test } from '@playwright/test';

import { openPage, VALID_CPF } from './helpers/checkout';

/**
 * The method gate — FUT-740's FIRST critical, and the one the harness could not
 * see until the store learned to hold more than one payable (FUT-743).
 *
 * `POST /charge` raises a CARD charge, and a payable whose method is PIX is one
 * the buyer is holding a live QR for. Settling it with a card leaves that QR
 * scannable and still pointing at a chargeable code — two payable codes for one
 * payable, which is the double payment `checkout/reuse.ts` exists to prevent.
 *
 * The refusal is a 404 rather than a 400, deliberately: "absent", "not yours"
 * and "not card-payable" are answered identically, so nothing outside can
 * enumerate which handles exist.
 */

test('a CARD charge on a PIX payable is refused, and reaches no provider', async ({ page }) => {
  await openPage(page, 'payments-checkout-method-gate');

  await page.getByTestId('raise-pix-payable').click();

  // A real payable with a real code on it. Both halves matter: a page that
  // refused a handle naming nothing would prove only that 404 exists.
  await expect(page.getByTestId('pix-payable-ref')).toHaveText('inv_harness_0043');
  await expect(page.getByTestId('pix-payable-code')).toContainText('BR.GOV.BCB.PIX');
  await expect(page.getByTestId('provider-charge-count')).toHaveText('1');

  await page.getByTestId('charge-card-on-pix').click();

  // The gate's own answer. The charge carried a complete flat body — an
  // instrument and the CPF — so every gate that runs before this one had
  // nothing to say, and this refusal can only be the method's.
  await expect(page.getByTestId('refusal-status')).toHaveText('404');
  await expect(page.getByTestId('refusal-code')).toHaveText('PAYABLE_NOT_FOUND');

  // And the money half: no second charge exists. Delete the gate from the
  // published mount and this line goes to 2 while the QR above is still live.
  await expect(page.getByTestId('provider-charge-count')).toHaveText('1');
  await expect(page.getByTestId('provider-charges')).toContainText(`aurora:PIX:${VALID_CPF}`);
  await expect(page.getByTestId('provider-charges')).not.toContainText('aurora:CARD');
});
