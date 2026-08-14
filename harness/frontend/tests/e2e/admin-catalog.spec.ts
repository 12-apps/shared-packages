import { expect, test } from '@playwright/test';

import { expectWireOrder, openAdminCase, openProvider } from './helpers/admin';
import { openPage } from './helpers/checkout';

/**
 * The Catalog page: the four PUBLISHED vendor adapters, projected by the real
 * settings service into the real settings screen (FUT-557 / FUT-743).
 *
 * This is the one page (and the one spec) that names vendors: the page path is
 * the portability gate's hard-coded exemption, and specs are exempt via
 * TEST_GLOBS. The mount is read-only BY CONSTRUCTION — every intent except
 * `getSettings`/`getSetupGuide` is excluded — and `admin-probe-write` is that
 * exclusion's live proof, so a spec asserts the refusal rather than trusting
 * the comment.
 */

test('the published adapters render as cards, and the mount is read-only by construction', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'catalog');

  // Every published adapter gets a card and an unconnected badge — the real
  // descriptor projection, not a hand-written list.
  for (const name of ['pagbank', 'stone', 'infinitepay', 'stripe']) {
    await expect(page.getByTestId(`payments-provider-card-${name}`)).toBeVisible();
    await expect(page.getByTestId(`payments-provider-badge-${name}`)).toHaveText('Não conectado');
  }

  // The card shows the adapter's displayName, not the registry key. Case
  // matters: `InfinitePay` is the declared spelling, `infinitepay` the key.
  await expect(page.getByTestId('payments-provider-card-pagbank')).toContainText('PagBank');
  await expect(page.getByTestId('payments-provider-card-stone')).toContainText('Stone');
  await expect(page.getByTestId('payments-provider-card-infinitepay')).toContainText('InfinitePay');
  await expect(page.getByTestId('payments-provider-card-stripe')).toContainText('Stripe');

  // A credentials provider opens onto the schema-driven form: environment
  // tabs, the SANDBOX notice, and a save button dead while nothing is edited.
  await openProvider(page, 'stone');
  await expect(page.getByTestId('payments-environment-tabs')).toBeVisible();
  await expect(page.getByTestId('payments-environment-SANDBOX')).toBeVisible();
  await expect(page.getByTestId('payments-environment-notice-SANDBOX')).toBeVisible();
  await expect(page.getByTestId('payments-save')).toBeDisabled();

  // Back to the list — and the controlled host was asked to push both moves.
  await page.getByTestId('payments-provider-back').click();
  await expect(page.getByTestId('payments-provider-picker')).toBeVisible();
  await expect(page.getByTestId('admin-nav-log')).toHaveText('push:stone,push:(none)');

  // Nothing above wrote anything: the component never put a PUT on the wire.
  await expect(page.getByTestId('admin-wire-paths')).not.toContainText('PUT');

  // And a write CANNOT get through: the raw probe's PUT is refused by the
  // mount (404 from the exclusion) before any vendor adapter method runs.
  await page.getByTestId('admin-probe-write').click();
  await expect(page.getByTestId('admin-probe-write-status')).toHaveText('404');
});

test('an OAuth provider with no prepareConnect falls back to the bare credential form', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'catalog');
  await openProvider(page, 'pagbank');

  // The `!prepareConnect` branch: an info alert plus the plain form. There is
  // NO manual-fallback accordion in this branch — that testid exists only
  // when the connect button is present — and no connect button at all.
  await expect(page.getByText('o botão de conexão não está disponível')).toBeVisible();
  await expect(page.getByTestId('payments-save')).toBeVisible();
  await expect(page.getByTestId('payments-manual-fallback')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Conectar com/ })).toBeHidden();
});

test('landing on the raw provider name respells the URL segment once, with replace', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'slug-alias');

  // Land controlled on the RAW name. A fragment-only navigation, so the case's
  // world (and its nav log) survives the hop.
  await page.goto('#/payments-provider-settings?provider=infinitepay');

  // The alias resolves — the provider screen opened despite the old spelling.
  await expect(page.getByTestId('payments-provider-back')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'InfinitePay' })).toBeVisible();

  // The component fired ONCE, with the canonical slug and {replace: true} —
  // the exact nav-log text is what pins "once", and `replace:` pins the flag.
  await expect(page.getByTestId('admin-nav-log')).toHaveText('replace:infinite-pay');
  await expect(page).toHaveURL(/provider=infinite-pay$/);
});

test('a provider that ships a guide renders it; one that ships none gets the form and a 404', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'guides');

  // Stone ships a walkthrough: the stepper renders, with one open section.
  await openProvider(page, 'stone');
  await expect(page.getByTestId('payments-setup-guide')).toBeVisible();
  await expect(page.locator('[data-testid^="payments-setup-section-"]')).toBeVisible();

  await page.getByTestId('payments-provider-back').click();
  await expect(page.getByTestId('payments-provider-picker')).toBeVisible();

  // PagBank ships none: the client turns the guide route's 404 into null and
  // the form stands on its own.
  await openProvider(page, 'pagbank');
  await expect(page.getByTestId('payments-save')).toBeVisible();
  await expect(page.getByTestId('payments-setup-guide')).toBeHidden();
  await expectWireOrder(page, ['GET /settings/guides/pagbank 404']);
});

/**
 * The guide is a function of the store's PROGRESS (FUT-691): the case seeds
 * stripe as `connected`, and the walkthrough must open on the dashboard
 * section — the notification URL and its copy button — with the stepper past
 * "Conectar conta", not stuck on step 1 as it used to be when the adapter
 * reported no stage at all.
 *
 * The adapter now reports the last, sectionless stage and the renderer clamps
 * back to this one until the owner confirms (FUT-799). What the owner sees is
 * unchanged; what changed is that there is now somewhere left to go.
 */
test('stripe: a connected store opens on the dashboard section, stepper past step 1', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'guides');
  await openProvider(page, 'stripe');

  await expect(page.getByTestId('payments-setup-guide')).toBeVisible();
  // The section the stage resolves: dashboard (stage 2 of 3), not connect.
  await expect(page.getByTestId('payments-setup-section-dashboard')).toBeVisible();
  await expect(page.getByTestId('payments-setup-section-dashboard')).toContainText(
    'URL de notificação',
  );
  await expect(page.getByTestId('payments-setup-section-connect')).toBeHidden();

  // The probe the guide's copy points at exists on this screen (FUT-691) —
  // presence only: this mount is read-only, so the button is not driven here.
  await expect(page.getByTestId('payments-oauth-verify')).toBeVisible();
});
