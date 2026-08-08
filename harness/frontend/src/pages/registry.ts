import type { ComponentType } from 'react';

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
import { PaymentsProviderSettingsPage } from './payments-provider-settings';
import { PwaInstallPromptPage } from './pwa-install-prompt';
import { ReportBuilderPage } from './report-builder';

/**
 * One page per published surface, and the ONLY place a new one is registered.
 *
 * Adding a package to the harness is meant to be two steps and no more: write
 * `pages/<slug>.tsx` that renders the published thing, then add a line here.
 * The shell builds its nav from this list, so nothing else has to change — and
 * a spec addresses a page by slug (`#/<slug>`), so specs do not move when the
 * nav grows.
 *
 * ONE ENTRY PER PACKAGE. This is a consumer harness, not a component gallery:
 * a page proves the package's PUBLIC wiring works for a host, so a package
 * that needs several screens exposes them behind its own entry point and the
 * harness still wires it once. Exploring components individually is
 * Storybook's job, and belongs in the package that owns them.
 *
 * `pkg` is the package the page exercises, shown in the nav. It is not derived
 * from the imports on purpose: a page may compose several packages (the
 * payments ones drive the backend's checkout mount through the frontend's
 * buyer flow), and what matters in the nav is which package the page is ABOUT.
 */
export interface HarnessPage {
  /** URL segment after the hash, and the test id the nav link carries. */
  slug: string;
  title: string;
  pkg: string;
  Component: ComponentType;
}

/** The `payments-checkout-*` block: one page per BUYER FLOW (FUT-743). */
const PAYMENTS_FRONTEND = '@12-apps/payments-frontend';

export const PAGES: readonly HarnessPage[] = [
  {
    slug: 'payments-provider-settings',
    title: 'Provider settings',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsProviderSettingsPage,
  },
  {
    slug: 'payments-checkout-pix',
    title: 'Checkout · PIX',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutPixPage,
  },
  {
    slug: 'payments-checkout-card',
    title: 'Checkout · card',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutCardPage,
  },
  {
    slug: 'payments-checkout-google-pay',
    title: 'Checkout · Google Pay',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutGooglePayPage,
  },
  {
    slug: 'payments-checkout-apple-pay',
    title: 'Checkout · Apple Pay',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutApplePayPage,
  },
  {
    slug: 'payments-checkout-both',
    title: 'Checkout · both methods',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutBothPage,
  },
  {
    slug: 'payments-checkout-no-provider',
    title: 'Checkout · cannot charge',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutNoProviderPage,
  },
  {
    slug: 'payments-checkout-redirect',
    title: 'Checkout · hosted handover',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutRedirectPage,
  },
  {
    slug: 'payments-checkout-chain-failover',
    title: 'Checkout · provider chain',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutChainFailoverPage,
  },
  {
    slug: 'payments-checkout-provider-screens',
    title: 'Checkout · provider screens',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutProviderScreensPage,
  },
  {
    slug: 'payments-checkout-method-gate',
    title: 'Checkout · method gate',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutMethodGatePage,
  },
  {
    slug: 'payments-checkout-buyer-fields',
    title: 'Checkout · buyer fields',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutBuyerFieldsPage,
  },
  {
    slug: 'payments-checkout-failures',
    title: 'Checkout · refusals',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutFailuresPage,
  },
  {
    slug: 'payments-checkout-saved-cards',
    title: 'Checkout · saved cards',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutSavedCardsPage,
  },
  {
    slug: 'payments-checkout-slots',
    title: 'Checkout · two design systems',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutSlotsPage,
  },
  {
    slug: 'payments-checkout-headless',
    title: 'Checkout · composed by hand',
    pkg: PAYMENTS_FRONTEND,
    Component: PaymentsCheckoutHeadlessPage,
  },
  {
    slug: 'pwa-install-prompt',
    title: 'Install prompt',
    pkg: '@12-apps/ui',
    Component: PwaInstallPromptPage,
  },
  {
    slug: 'report-builder',
    title: 'Report builder',
    pkg: '@12-apps/report-builder',
    Component: ReportBuilderPage,
  },
];
