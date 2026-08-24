import type { HarnessPage } from './registry';

import { PaymentsCheckoutApplePayPage } from './payments-checkout-apple-pay';
import { PaymentsCheckoutBothPage } from './payments-checkout-both';
import { PaymentsCheckoutBuyerFieldsPage } from './payments-checkout-buyer-fields';
import { PaymentsCheckoutCardPage } from './payments-checkout-card';
import { PaymentsCheckoutChainFailoverPage } from './payments-checkout-chain-failover';
import { PaymentsCheckoutFailuresPage } from './payments-checkout-failures';
import { PaymentsCheckoutGooglePayPage } from './payments-checkout-google-pay';
import { PaymentsCheckoutHeadlessPage } from './payments-checkout-headless';
import { PaymentsCheckoutMethodGatePage } from './payments-checkout-method-gate';
import { PaymentsCheckoutNoProviderPage } from './payments-checkout-no-provider';
import { PaymentsCheckoutPixPage } from './payments-checkout-pix';
import { PaymentsCheckoutProviderScreensPage } from './payments-checkout-provider-screens';
import { PaymentsCheckoutRedirectPage } from './payments-checkout-redirect';
import { PaymentsCheckoutSavedCardsPage } from './payments-checkout-saved-cards';
import { PaymentsCheckoutSlotsPage } from './payments-checkout-slots';
import { PaymentsProviderActivationPage } from './payments-provider-activation';
import { PaymentsProviderChainPage } from './payments-provider-chain';
import { PaymentsProviderConnectPage } from './payments-provider-connect';
import { PaymentsProviderCredentialsPage } from './payments-provider-credentials';
import { PaymentsProviderSettingsPage } from './payments-provider-settings';
import { PaymentsWalletPage } from './payments-wallet';
import { PaymentsWiringPage } from './payments-wiring';

/**
 * `@12-apps/payments-frontend`'s pages, as two exports the registry spreads in.
 *
 * The same move `auth-pages.ts` makes, for the same boring reason: twenty
 * entries and twenty imports pushed `registry.ts` past the 400-line file cap.
 * The registry still names them — two spread lines there — and the promise that
 * adding a page is one edit in one file holds for every other package.
 *
 * These twenty are the exception the registry's own ONE-PAGE-PER-PACKAGE rule
 * already carries and states: what differs between them is the HOST WIRING —
 * which ports the mount is given, which built-in intents it serves, whether
 * provider selection is controlled — not the screen.
 */

/** The `payments-checkout-*` block: one page per BUYER FLOW (FUT-743). */
const PAYMENTS_FRONTEND = '@12-apps/payments-frontend';

/**
 * Every page of the `checkout` parent shares these, so the flows read as one
 * list of variations rather than thirteen restatements of where they live.
 */
const CHECKOUT_FLOW = {
  pkg: PAYMENTS_FRONTEND,
  group: 'storefront',
  parent: 'checkout',
} as const;

/** Every page of the `payments-admin` parent shares these. */
const PAYMENTS_ADMIN = {
  pkg: PAYMENTS_FRONTEND,
  group: 'backoffice',
  parent: 'payments-admin',
} as const;

/**
 * Every payments page a BUYER sees: the fifteen checkout flows under the nav's
 * `checkout` parent, and the wallet, which is deliberately not one of them.
 *
 * Titles name only what VARIES. The parent row already says "Checkout", so
 * repeating it fifteen times pushed the distinguishing word — the reason each
 * page exists — off to the right of every row.
 */
export const PAYMENTS_STOREFRONT_PAGES: readonly HarnessPage[] = [
  { ...CHECKOUT_FLOW, slug: 'payments-checkout-pix', title: 'PIX', Component: PaymentsCheckoutPixPage },
  { ...CHECKOUT_FLOW, slug: 'payments-checkout-card', title: 'Card', Component: PaymentsCheckoutCardPage },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-google-pay',
    title: 'Google Pay',
    Component: PaymentsCheckoutGooglePayPage,
  },
  { ...CHECKOUT_FLOW, slug: 'payments-checkout-both', title: 'Both methods', Component: PaymentsCheckoutBothPage },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-apple-pay',
    title: 'Apple Pay',
    Component: PaymentsCheckoutApplePayPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-no-provider',
    title: 'Cannot charge',
    Component: PaymentsCheckoutNoProviderPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-redirect',
    title: 'Hosted handover',
    Component: PaymentsCheckoutRedirectPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-chain-failover',
    title: 'Provider chain',
    Component: PaymentsCheckoutChainFailoverPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-provider-screens',
    title: 'Provider screens',
    Component: PaymentsCheckoutProviderScreensPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-method-gate',
    title: 'Method gate',
    Component: PaymentsCheckoutMethodGatePage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-buyer-fields',
    title: 'Buyer fields',
    Component: PaymentsCheckoutBuyerFieldsPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-failures',
    title: 'Refusals',
    Component: PaymentsCheckoutFailuresPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-saved-cards',
    title: 'Saved cards',
    Component: PaymentsCheckoutSavedCardsPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-slots',
    title: 'Two design systems',
    Component: PaymentsCheckoutSlotsPage,
  },
  {
    ...CHECKOUT_FLOW,
    slug: 'payments-checkout-headless',
    title: 'Composed by hand',
    Component: PaymentsCheckoutHeadlessPage,
  },
  // NOT under `checkout`: saving a card here is deliberately OUTSIDE any
  // purchase (FUT-183/FUT-478), so the wallet is its own buyer screen.
  {
    slug: 'payments-wallet',
    title: 'Wallet',
    pkg: PAYMENTS_FRONTEND,
    group: 'storefront',
    Component: PaymentsWalletPage,
  },
];

/**
 * The five provider-settings screens, under the nav's `payments-admin` parent.
 * Titles name only what VARIES; the parent row already says "Provider settings".
 */
export const PAYMENTS_ADMIN_PAGES: readonly HarnessPage[] = [
  {
    ...PAYMENTS_ADMIN,
    slug: 'payments-wiring',
    title: 'Adopted surfaces',
    Component: PaymentsWiringPage,
  },
  {
    ...PAYMENTS_ADMIN,
    slug: 'payments-provider-settings',
    title: 'Catalog',
    Component: PaymentsProviderSettingsPage,
  },
  {
    ...PAYMENTS_ADMIN,
    slug: 'payments-provider-credentials',
    title: 'Credentials',
    Component: PaymentsProviderCredentialsPage,
  },
  {
    ...PAYMENTS_ADMIN,
    slug: 'payments-provider-connect',
    title: 'Connect (OAuth)',
    Component: PaymentsProviderConnectPage,
  },
  {
    ...PAYMENTS_ADMIN,
    slug: 'payments-provider-activation',
    title: 'Activation charge',
    Component: PaymentsProviderActivationPage,
  },
  {
    ...PAYMENTS_ADMIN,
    slug: 'payments-provider-chain',
    title: 'Chain & policy',
    Component: PaymentsProviderChainPage,
  },
];
