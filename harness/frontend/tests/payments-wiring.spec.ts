import { expect, test } from '@playwright/test';

/**
 * Both `@12-apps/payments-frontend` web manifests, driven from the ADOPTION.
 *
 * This app used every component behind those manifests across twenty-two pages
 * and bound NEITHER of them: the settings pages reach for the
 * `PaymentProviderSettings` component rather than `createWebPaymentsSettings`,
 * and every checkout page calls `createPaymentFlows` itself. So the most
 * heavily-used package here was also the one whose declaration nothing
 * answered — invisible rather than red, because `assemble()` reports on the
 * packages a host ADOPTED.
 *
 * The twenty-two scenario pages are not replaced and should not be: they are a
 * matrix of host WIRINGS of the same surface, which is a test fixture rather
 * than a host's architecture. What this page adds is the canonical adoption —
 * one settings screen, one checkout, both bound through the consumer — and
 * these cases are what stop that adoption from being decorative. Binding a
 * manifest and never rendering what it returns would put the package in the
 * report while proving nothing about the surface the report calls bound.
 */

test('the OWNER surface renders from the adopted factory', async ({ page }) => {
  await page.goto('#/payments-wiring');
  await expect(page.getByTestId('page-payments-wiring')).toBeVisible();

  // The package's own screen, built by `createWebPaymentsSettings` rather than
  // by the host reaching past it for the component.
  const settings = page.getByTestId('adopted-settings');
  await expect(settings.getByTestId('payments-provider-settings')).toBeVisible();

  // The catalog the host's client actually served — two of the harness's
  // fictional providers, through the same builders the scenario pages use.
  await expect(settings.getByTestId('payments-provider-card-aurora')).toBeVisible();
  await expect(settings.getByTestId('payments-provider-card-boreal')).toBeVisible();
});

test('the SHOPPER surface renders from the adopted factory', async ({ page }) => {
  await page.goto('#/payments-wiring');

  // `createPaymentFlows` bound once, with this host's cart, scope and ports —
  // the same config object `harnessFlowsConfig` gives the scenario pages, so
  // the adoption cannot drift from what is under test.
  await expect(page.getByTestId('adopted-checkout').getByTestId('checkout-back')).toBeVisible();
});

test('the settings screen has no error banner — the client is really wired', async ({ page }) => {
  await page.goto('#/payments-wiring');
  await expect(page.getByTestId('adopted-settings').getByTestId('payments-provider-settings')).toBeVisible();

  // Worth its own case because of how this failed while being written.
  // `createAdminStore` takes a REQUIRED `baseUrl` — the client's origin and the
  // localStorage ack scope — and omitting it built `undefined/…` URLs. The
  // screen caught the 404 and rendered its generic error alert, so the page
  // looked mounted, the surface looked bound, and the only symptom was a
  // sentence that named nothing. A case asserting the screen renders would have
  // passed on the alert; this one is why it does not.
  await expect(page.getByTestId('adopted-settings').getByRole('alert')).toHaveCount(0);
});
