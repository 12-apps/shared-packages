import { expect, type Page } from '@playwright/test';
import { definePaymentsWorld, type PaymentsStore } from '@12-apps/payments-e2e';

import { openCase, openPage } from '../helpers/checkout';

/**
 * THIS APP'S half of the packaged payment journeys (FUT-561).
 *
 * The scenarios and their steps ship inside `@12-apps/payments-e2e`; none of
 * them is copied here, and none of them knows what a harness page is. What is
 * host-specific is exactly what this file supplies: how a store of a given
 * shape is produced, how the hosted hand-off is triggered and returned from,
 * and where this app records what crossed the wire.
 *
 * That is the integration a real consumer performs too — a storefront would
 * seed a tenant where this seeds an in-page provider chain, and would route to
 * `/checkout` where this routes to `#/<slug>`. The features do not change.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `definePaymentsWorld` call below lands
 * in every worker before the first Given executes.
 *
 * Every checkout shape opens on the ONE list (FUT-4028), the only Pagamento
 * the package draws; `expectTheList` below still fails a shape that lands
 * anywhere else.
 */

/** Which harness page holds a store of each shape, and which case on it. */
const LOCATIONS: Readonly<Record<PaymentsStore, { slug: string; caseId?: string; pixBank?: true }>> = {
  'pix-only': { slug: 'payments-checkout-pix', caseId: 'awaiting' },
  card: { slug: 'payments-checkout-card' },
  'google-pay': { slug: 'payments-checkout-google-pay' },
  'apple-pay': { slug: 'payments-checkout-apple-pay', caseId: 'device' },
  'apple-pay-unsupported': { slug: 'payments-checkout-apple-pay', caseId: 'no-device' },
  'both-methods': { slug: 'payments-checkout-both' },
  hosted: { slug: 'payments-checkout-redirect' },
  // With the host's Pix bank flow, as the origin host passes it (FUT-3612):
  // the code is copied as it is generated, and the Pix opens on its after-copy
  // face. `pix-only` keeps the plain face, and `checkout-pix-faces.spec.ts`
  // drives both.
  awaiting: { slug: 'payments-checkout-pix', caseId: 'awaiting-bank', pixBank: true },
  settles: { slug: 'payments-checkout-pix', caseId: 'settles' },
  declined: { slug: 'payments-checkout-failures', caseId: 'declined' },
  unresolved: { slug: 'payments-checkout-failures', caseId: 'unresolved' },
  unavailable: { slug: 'payments-checkout-failures', caseId: 'unavailable' },
  'no-provider': { slug: 'payments-checkout-no-provider', caseId: 'empty-chain' },
  'no-provider-remedy': { slug: 'payments-checkout-no-provider', caseId: 'empty-chain-remedy' },
  'payments-off': { slug: 'payments-checkout-no-provider', caseId: 'host-veto' },
  'two-mintable': { slug: 'payments-checkout-chain-failover', caseId: 'two-mintable' },
  'redirect-head': { slug: 'payments-checkout-chain-failover', caseId: 'redirect-head' },
  // The saved-card wallet (FUT-183/FUT-478) — a buyer screen, not a checkout.
  wallet: { slug: 'payments-wallet' },
  // The activation charge (FUT-689) — the ADMIN settings surface. `open`
  // additionally walks onto the provider's own panel below.
  activation: { slug: 'payments-provider-activation', caseId: 'unproven' },
  'screen-on-page': { slug: 'payments-checkout-provider-screens', caseId: 'screen-on-page' },
  'screen-handoff': { slug: 'payments-checkout-provider-screens', caseId: 'screen-handoff' },
  'screen-undeclared': { slug: 'payments-checkout-provider-screens', caseId: 'screen-undeclared' },
  'screen-unknown': { slug: 'payments-checkout-provider-screens', caseId: 'screen-unknown' },
  // The setup walkthrough (FUT-760/761) — the PUBLISHED vendor catalog, so the
  // guide under assertion is a real shipped one rather than a harness
  // invention. `open` walks onto Stone's panel below. The case seeds Stone
  // CONNECTED on purpose: the sentence that addresses the platform by name is
  // in the webhook section, and a guide renders the section of the stage it
  // opens on, so a fresh row would leave that text out of the DOM entirely.
  'setup-guide': { slug: 'payments-provider-settings', caseId: 'guide-brand' },
  // The dead OAuth grant (FUT-683). The connect page already seeds it: its
  // `reconnect` case declares the OAuth provider's refresh as failing, which
  // is the only way the state is reachable — a real provider refusing to renew
  // is not something a scenario can ask for.
  'reconnect-required': { slug: 'payments-provider-connect', caseId: 'reconnect' },
};

/** The shapes that are not a checkout: a buyer's saved cards, or an admin surface. */
const NOT_A_CHECKOUT: ReadonlySet<PaymentsStore> = new Set([
  'wallet',
  'activation',
  'setup-guide',
  'reconnect-required',
]);

/**
 * The page a scenario is on, so the return leg can come back to it.
 *
 * A module-level value rather than a fixture: the packaged `test` deliberately
 * carries no host fixtures (that coupling is what kept these journeys out of
 * the library), and workers are isolated, so a scenario cannot see another's.
 */
let currentSlug: string | null = null;

/**
 * A checkout shape is the ONE list, or the screen that says the store cannot
 * charge (FUT-4028) — proven before a scenario leans on it, so a page that
 * drew anything else fails here rather than three steps later.
 */
async function expectTheList(page: Page): Promise<void> {
  const settled = page
    .getByTestId('payment-list')
    .or(page.getByTestId('checkout-payments-disabled'))
    .or(page.getByTestId('checkout-payments-remedy'));
  await expect(settled.first()).toBeVisible();
}

definePaymentsWorld({
  async open(page, store) {
    const where = LOCATIONS[store];
    // Every store with the bank flow copies the code as it is generated: the
    // page may write the clipboard (that is what lands it on the after-copy
    // face) and the journey may read it back. Granted wherever `pixBank` is on.
    if (where.pixBank) await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openPage(page, where.slug);
    // Emptied before the case mounts, so a code a previous scenario copied
    // can never pass for the one this store generates.
    if (where.pixBank) await page.evaluate(() => navigator.clipboard.writeText(''));
    currentSlug = where.slug;
    if (where.caseId) await openCase(page, where.caseId);
    if (!NOT_A_CHECKOUT.has(store)) await expectTheList(page);
    if (store === 'activation') {
      // The admin shape lands ON the provider's panel: the journey's subject
      // is one provider's switch and activation step, not the landing list.
      await page.getByTestId('payments-provider-card-aurora').click();
      await expect(page.getByTestId('payments-provider-back')).toBeVisible();
    }
    if (store === 'setup-guide') {
      // Same reason, one vendor over: the walkthrough is on the panel, not on
      // the catalog. Stone rather than the harness's own provider because the
      // sentence under assertion is one the PACKAGE ships.
      await page.getByTestId('payments-provider-card-stone').click();
      await expect(page.getByTestId('payments-provider-back')).toBeVisible();
    }
  },

  async raiseHostedPayable(page) {
    const panel = page.getByTestId('panel-hosted-handoff');
    await panel.getByTestId('raise-hosted-payable').click();
    // Wait for the interstitial, not just for the click. Parking the order is
    // an effect of that screen MOUNTING, and a scenario that navigates away
    // before it has mounted is testing a trip whose outbound leg never
    // happened. The port documents this as the host's responsibility.
    await expect(panel.getByTestId('checkout-hosted-handoff')).toBeVisible();
  },

  async returnFromProvider(page) {
    // The way a hosted provider really sends her back: a fresh load of this
    // app's own route, carrying the markers the provider appends. The
    // application was destroyed in between.
    await page.goto(`/?transaction_nsu=NSU-HARNESS&slug=inv-harness#/${currentSlug ?? ''}`);
  },

  hostedReturnStatus: (page) => page.getByTestId('hosted-return-status'),

  async authorizeOAuth(page) {
    // The connect page's fake provider consent screen: one button that grants.
    await page.getByTestId('admin-oauth-authorize').click();
  },

  fixtures: {
    headProvider: 'aurora',
    tailProvider: 'boreal',
    hostedUrlFragment: 'infinito.example',
    payableRef: 'inv_harness_0043',
    // As the provider receives it: the list keeps the document as plain
    // digits, whatever mask the buyer saw (FUT-4080).
    taxId: '52998224725',
    // The same word `admin-ports.ts` passes as `SetupGuideContext.brandName`.
    // Deliberately a name no real adopter uses: if the guide were still
    // carrying a compiled-in brand, this would not appear and the journey
    // fails — which is the whole assertion.
    platformBrand: 'Plataforma Harness',
    // The OAuth member of this harness's invented cast — the row whose grant
    // the `reconnect` case declares dead.
    oauthProvider: 'cerrado',
  },

  wire: {
    paths: (page) => page.getByTestId('wire-paths'),
    // A read through the probe's own recorder: the "nothing was written" step
    // proves the probe live with it before it trusts an absence.
    async heartbeat(page) {
      await page.getByTestId('wire-heartbeat').click();
      return 'GET /api/checkout/heartbeat';
    },
    chargeKeys: (page) => page.getByTestId('wire-charge-keys'),
    chargeBody: (page) => page.getByTestId('wire-charge-body'),
    tokensByProvider: (page) => page.getByTestId('wire-tokens-by-provider'),
    providerCharges: (page) => page.getByTestId('provider-charges'),
    providerChargeCount: (page) => page.getByTestId('provider-charge-count'),
    navigated: (page) => page.getByTestId('panel-hosted-checkout').getByTestId('host-navigated'),
    // The connect page's probe of the stored rows it seeded.
    connectionStatus: (page, provider) => page.getByTestId(`admin-status-${provider}`),
    connectionEnabled: (page, provider) => page.getByTestId(`admin-enabled-${provider}`),
    rotation: (page) => page.getByTestId('admin-rotation'),
  },
});
