import { expect } from '@playwright/test';
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
 */

/** Which harness page holds a store of each shape, and which case on it. */
const LOCATIONS: Readonly<Record<PaymentsStore, { slug: string; caseId?: string }>> = {
  'pix-only': { slug: 'payments-checkout-pix', caseId: 'awaiting' },
  card: { slug: 'payments-checkout-card' },
  'google-pay': { slug: 'payments-checkout-google-pay' },
  'apple-pay': { slug: 'payments-checkout-apple-pay', caseId: 'device' },
  'apple-pay-unsupported': { slug: 'payments-checkout-apple-pay', caseId: 'no-device' },
  'both-methods': { slug: 'payments-checkout-both' },
  hosted: { slug: 'payments-checkout-redirect' },
  awaiting: { slug: 'payments-checkout-pix', caseId: 'awaiting' },
  settles: { slug: 'payments-checkout-pix', caseId: 'settles' },
  declined: { slug: 'payments-checkout-failures', caseId: 'declined' },
  unresolved: { slug: 'payments-checkout-failures', caseId: 'unresolved' },
  unavailable: { slug: 'payments-checkout-failures', caseId: 'unavailable' },
  'no-provider': { slug: 'payments-checkout-no-provider', caseId: 'empty-chain' },
  'no-provider-remedy': { slug: 'payments-checkout-no-provider', caseId: 'empty-chain-remedy' },
  'payments-off': { slug: 'payments-checkout-no-provider', caseId: 'host-veto' },
  'two-mintable': { slug: 'payments-checkout-chain-failover', caseId: 'two-mintable' },
  'redirect-head': { slug: 'payments-checkout-chain-failover', caseId: 'redirect-head' },
  'screen-on-page': { slug: 'payments-checkout-provider-screens', caseId: 'screen-on-page' },
  'screen-handoff': { slug: 'payments-checkout-provider-screens', caseId: 'screen-handoff' },
  'screen-undeclared': { slug: 'payments-checkout-provider-screens', caseId: 'screen-undeclared' },
  'screen-unknown': { slug: 'payments-checkout-provider-screens', caseId: 'screen-unknown' },
};

/**
 * The page a scenario is on, so the return leg can come back to it.
 *
 * A module-level value rather than a fixture: the packaged `test` deliberately
 * carries no host fixtures (that coupling is what kept these journeys out of
 * the library), and workers are isolated, so a scenario cannot see another's.
 */
let currentSlug: string | null = null;

definePaymentsWorld({
  async open(page, store) {
    const where = LOCATIONS[store];
    await openPage(page, where.slug);
    currentSlug = where.slug;
    if (where.caseId) await openCase(page, where.caseId);
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

  fixtures: {
    headProvider: 'aurora',
    tailProvider: 'boreal',
    hostedUrlFragment: 'infinito.example',
    payableRef: 'inv_harness_0043',
    taxId: '529.982.247-25',
  },

  wire: {
    paths: (page) => page.getByTestId('wire-paths'),
    chargeKeys: (page) => page.getByTestId('wire-charge-keys'),
    chargeBody: (page) => page.getByTestId('wire-charge-body'),
    tokensByProvider: (page) => page.getByTestId('wire-tokens-by-provider'),
    providerCharges: (page) => page.getByTestId('provider-charges'),
    providerChargeCount: (page) => page.getByTestId('provider-charge-count'),
    navigated: (page) => page.getByTestId('panel-hosted-checkout').getByTestId('host-navigated'),
  },
});
