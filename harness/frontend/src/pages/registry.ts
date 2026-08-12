import type { ComponentType } from 'react';

import { EntitlementsPlanPage } from './entitlements-plan';
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
import { PaymentsWalletPage } from './payments-wallet';
import { PaymentsProviderActivationPage } from './payments-provider-activation';
import { PaymentsProviderChainPage } from './payments-provider-chain';
import { PaymentsProviderConnectPage } from './payments-provider-connect';
import { PaymentsProviderCredentialsPage } from './payments-provider-credentials';
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
  /** Which {@link NAV_GROUPS} section this page's row joins. */
  group: HarnessNavGroupKey;
  /**
   * Nest this page under a group's parent row instead of listing it as a
   * top-level one — the key of an entry in that group's `parents`.
   */
  parent?: string;
  Component: ComponentType;
}

/**
 * The nav SECTIONS, borrowed wholesale from the admin sidebar's structure
 * (future-pay `apps/admin/src/shell/nav-config.ts`, FUT-428): labelled groups
 * in a deliberate order, a collapsible disclosure per group, a caret on the
 * group header and nowhere else, and parent rows whose children appear when
 * you are inside them.
 *
 * What is NOT borrowed is the vocabulary. The admin's five groups — Operação,
 * Catálogo, Estoque, Financeiro, Equipe — are a mental model of running a
 * restaurant, and that doc's first rule is that a group IS a mental model
 * rather than a department. The thing being navigated here is a set of
 * PUBLISHED SURFACES, so the model that fits is *whose screen is this*: the
 * same split future-pay itself makes between `apps/client` and `apps/admin`.
 *
 * Ordered the same way the admin orders its groups — by how often you open
 * them. Thirteen of the seventeen pages are buyer flows.
 */
export type HarnessNavGroupKey = 'storefront' | 'backoffice';

/**
 * A nav-only row that OWNS other rows: a label, and the page it lands on.
 *
 * `slug` is one of its own children, the way the admin's Cozinha row leads to
 * its first child and repeats that child under itself. A parent with a landing
 * page nobody can see reads as "no children" to anyone who never clicks it,
 * and pointing it at a real child means the row and the disclosure can never
 * disagree about where clicking goes.
 */
export interface HarnessNavParent {
  key: string;
  label: string;
  slug: string;
}

export interface HarnessNavGroup {
  key: HarnessNavGroupKey;
  label: string;
  parents?: readonly HarnessNavParent[];
}

export const NAV_GROUPS: readonly HarnessNavGroup[] = [
  {
    key: 'storefront',
    label: 'Storefront',
    // The thirteen buyer flows are ASPECTS of one screen, not thirteen
    // destinations — the same claim the admin makes by nesting an area's
    // reports under it. Flat, they were the whole sidebar and the two pages
    // that are not payments sank below them.
    parents: [{ key: 'checkout', label: 'Checkout', slug: 'payments-checkout-pix' }],
  },
  {
    key: 'backoffice',
    label: 'Backoffice',
    // Four pages, one screen. What differs between them is the HOST WIRING —
    // which ports the mount is given, which built-in intents it serves,
    // whether provider selection is controlled — not the screen. That is the
    // same claim `checkout` makes for its buyer flows, and it is the exception
    // the rule above already carries. Flat, these would outnumber every other
    // backoffice row three to one.
    parents: [
      { key: 'payments-admin', label: 'Provider settings', slug: 'payments-provider-settings' },
    ],
  },
];

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

export const PAGES: readonly HarnessPage[] = [
  // --- Storefront: what a BUYER sees --------------------------------------
  //
  // Titles inside `checkout` name only what VARIES. The parent row already
  // says "Checkout", so repeating it thirteen times pushed the distinguishing
  // word — the reason each page exists — off to the right of every row.
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
  {
    slug: 'pwa-install-prompt',
    title: 'Install prompt',
    pkg: '@12-apps/ui',
    group: 'storefront',
    Component: PwaInstallPromptPage,
  },

  // --- Backoffice: what the STORE sees ------------------------------------
  // Titles name only what VARIES; the parent row already says "Provider
  // settings".
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
  {
    slug: 'report-builder',
    title: 'Report builder',
    pkg: '@12-apps/report-builder',
    group: 'backoffice',
    Component: ReportBuilderPage,
  },
  {
    slug: 'entitlements-plan',
    title: 'Plan & entitlements',
    pkg: '@12-apps/entitlements',
    group: 'backoffice',
    Component: EntitlementsPlanPage,
  },
];
