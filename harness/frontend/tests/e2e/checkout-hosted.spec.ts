import { expect, test } from '@playwright/test';
import { HOSTED_ORDER_STORAGE_KEY } from '@12-apps/payments-frontend';

import { openPage, reachPayment } from './helpers/checkout';

/**
 * The hosted handover, both legs (FUT-743 / FUT-556).
 *
 * Before FUT-741 this leg had no screen at all: a bare `window.location.assign`
 * inside a hook. When the navigation works nobody notices; when it does not — a
 * redirect blocker, a slow DNS, an in-app webview that refuses cross-origin
 * navigations, a buyer who taps back — the buyer is left on a page that says
 * nothing, offers nothing, and has already raised a charge.
 *
 * The ORDER is the safety property: park, then navigate. The navigation may
 * tear the SPA down at any point after it starts, and a return trip that finds
 * nothing parked drops the buyer on a blank confirmation after they have paid.
 */

test('a REDIRECT chain never shows a card form, and the departure is observable', async ({
  page,
}) => {
  await openPage(page, 'payments-checkout-redirect');
  await reachPayment(page);

  await page.getByTestId('checkout-method-CARD').click();

  // Nobody in this chain tokenizes in the browser, so the card is typed on the
  // provider's own page — asking for a PAN here would be asking for something
  // this store cannot mint an instrument from.
  await expect(page.getByTestId('card-number')).toHaveCount(0);
  await expect(page.getByTestId('card-view')).toHaveCount(0);

  // The handover happened, and it is VISIBLE. A `location.assign` buried in a
  // hook leaves nothing to assert on at all.
  await expect(page.getByTestId('panel-hosted-checkout').getByTestId('host-navigated')).toContainText(
    'infinito.example',
  );
});

test('HostedHandoff parks the order, then navigates, and offers a real link', async ({ page }) => {
  await openPage(page, 'payments-checkout-redirect');

  const panel = page.getByTestId('panel-hosted-handoff');
  await panel.getByTestId('raise-hosted-payable').click();

  // The interstitial the bare assign never had.
  await expect(panel.getByTestId('checkout-hosted-handoff')).toBeVisible();
  const link = panel.getByTestId('checkout-hosted-link');
  await expect(link).toBeVisible();
  // A REAL anchor, not a second scripted navigation: when the scripted one was
  // blocked, another one will be too.
  await expect(link).toHaveAttribute('href', /infinito\.example/);

  // Parked BEFORE the navigation, which is the whole ordering rule. Reading it
  // out of sessionStorage is the only way to see "first", and this is where the
  // return trip below gets its order from.
  // The key comes from the PACKAGE, passed into the browser context. The
  // harness installs the real tarball, so this also proves the constant is
  // exported from the published entry — and a private copy here would have kept
  // passing against the old name while the package wrote a new one, which is
  // exactly how this spec caught the rename in the first place.
  const parked = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    HOSTED_ORDER_STORAGE_KEY,
  );
  expect(parked).toContain('inv_harness_0043');
});

test('the return trip rehydrates the parked order and polls it to PAID', async ({ page }) => {
  await openPage(page, 'payments-checkout-redirect');
  await page.getByTestId('panel-hosted-handoff').getByTestId('raise-hosted-payable').click();
  await expect(page.getByTestId('checkout-hosted-handoff')).toBeVisible();

  // The buyer comes back the way a hosted provider sends them: same route, plus
  // the markers it appends. The SPA was torn down in between, so everything the
  // checkout held is gone and the parked copy is all there is.
  await page.goto('/?transaction_nsu=NSU-HARNESS&slug=inv-harness#/payments-checkout-redirect');

  await expect(page.getByTestId('panel-hosted-return')).toBeVisible();
  await expect(page.getByTestId('hosted-return-status')).toHaveText('PAID');
  // A real `GET /status` round trip against a real mount, carrying the hints
  // the provider appended.
  await expect(page.getByTestId('wire-paths')).toContainText('GET /api/checkout/status');
});
