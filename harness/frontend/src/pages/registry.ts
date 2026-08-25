import type { ComponentType } from 'react';

import { AppShellPage } from './app-shell';
import { AuditLogPage } from './audit-log';
import { DiscountsPage } from './discounts';
import { McpAiConnectPage } from './mcp-ai-connect';
import { AUTH_PAGES, AUTH_SETTINGS_PAGE } from './auth-pages';
import { EntitlementsPlanPage } from './entitlements-plan';
import { FeatureFlagsPage } from './feature-flags';
import { ImpersonationPage } from './impersonation';
import { LifecycleAdminPage } from './lifecycle-admin';
import { NotificationsCenterPage } from './notifications-center';
import { ObservabilityPage } from './observability';
import { OnboardingGuidedPage } from './onboarding-guided';
import { PAYMENTS_ADMIN_PAGES, PAYMENTS_STOREFRONT_PAGES } from './payments-pages';
import { ProductResearchPage } from './product-research';
import { PwaInstallPromptPage } from './pwa-install-prompt';
import { PwaManifestPage } from './pwa-manifest';
import { RbacAdminPage } from './rbac-admin';
import { RealtimeEventsPage } from './realtime-events';
import { ReportBuilderPage } from './report-builder';
import { StorageUploadsPage } from './storage-uploads';
import { WiringReportPage } from './wiring-report';

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
 * (the origin host `apps/admin/src/shell/nav-config.ts`, FUT-428): labelled groups
 * in a deliberate order, a collapsible disclosure per group, a caret on the
 * group header and nowhere else, and parent rows whose children appear when
 * you are inside them.
 *
 * What is NOT borrowed is the vocabulary. The admin's five groups — Operação,
 * Catálogo, Estoque, Financeiro, Equipe — are a mental model of running a
 * restaurant, and that doc's first rule is that a group IS a mental model
 * rather than a department. The thing being navigated here is a set of
 * PUBLISHED SURFACES, so the model that fits is *whose screen is this*: the
 * same split the origin host itself makes between `apps/client` and `apps/admin`.
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
    parents: [
      { key: 'checkout', label: 'Checkout', slug: 'payments-checkout-pix' },
      // The same exception `checkout` is, for the same reason. @12-apps/auth's six
      // buyer-facing screens are ASPECTS of signing in, not six destinations —
      // and unlike every other package here it genuinely needs six URLs, because
      // a confirmation mail has to land on one specific page and a reset mail on
      // another. Flat, they would be a quarter of the sidebar.
      { key: 'auth', label: 'Sign-in', slug: 'auth-login' },
    ],
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

export const PAGES: readonly HarnessPage[] = [
  // --- Storefront: what a BUYER sees --------------------------------------
  //
  ...PAYMENTS_STOREFRONT_PAGES,
  ...AUTH_PAGES,
  {
    slug: 'pwa-install-prompt',
    title: 'Install prompt',
    pkg: '@12-apps/ui',
    group: 'storefront',
    Component: PwaInstallPromptPage,
  },
  // @12-apps/pwa's REQUEST-TIME half (12-23): the per-host manifest endpoint and
  // the packaged worker, asked for from a real browser. The install prompt above
  // is @12-apps/ui's component; this is the package that makes the app installable
  // in the first place.
  {
    slug: 'pwa-manifest',
    title: 'Manifest & worker',
    pkg: '@12-apps/pwa',
    group: 'storefront',
    Component: PwaManifestPage,
  },
  // @12-apps/app-shell (12-18): the tower every one of these pages would otherwise
  // sit in — theme, session, boundary, lazy routes and the consent gate. Filed under
  // storefront because the two things it puts in front of a person are both a
  // buyer's: the corrected tenant palette and the terms prompt.
  {
    slug: 'app-shell',
    title: 'Shell & consent',
    pkg: '@12-apps/app-shell',
    group: 'storefront',
    Component: AppShellPage,
  },

  // --- Backoffice: what the STORE sees ------------------------------------
  ...PAYMENTS_ADMIN_PAGES,
  AUTH_SETTINGS_PAGE,
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
  {
    slug: 'storage-uploads',
    title: 'Image uploads',
    pkg: '@12-apps/storage',
    group: 'backoffice',
    Component: StorageUploadsPage,
  },
  {
    slug: 'impersonation',
    title: 'Desk sessions',
    pkg: '@12-apps/impersonation',
    group: 'backoffice',
    Component: ImpersonationPage,
  },
  {
    slug: 'discounts',
    title: 'Promotions',
    pkg: '@12-apps/discounts',
    group: 'backoffice',
    Component: DiscountsPage,
  },
  {
    slug: 'mcp-ai-connect',
    title: 'Connect an assistant',
    pkg: '@12-apps/mcp',
    group: 'backoffice',
    Component: McpAiConnectPage,
  },
  {
    slug: 'rbac-admin',
    title: 'Roles & team',
    pkg: '@12-apps/rbac',
    group: 'backoffice',
    Component: RbacAdminPage,
  },
  {
    slug: 'onboarding-guided',
    title: 'Guided onboarding',
    pkg: '@12-apps/onboarding',
    group: 'backoffice',
    Component: OnboardingGuidedPage,
  },
  {
    slug: 'notifications-center',
    title: 'Notifications',
    pkg: '@12-apps/notifications',
    group: 'backoffice',
    Component: NotificationsCenterPage,
  },
  {
    slug: 'lifecycle-admin',
    title: 'Versions, drafts & bin',
    pkg: '@12-apps/entity-lifecycle',
    group: 'backoffice',
    Component: LifecycleAdminPage,
  },
  {
    slug: 'realtime-events',
    title: 'Live updates',
    pkg: '@12-apps/realtime',
    group: 'backoffice',
    Component: RealtimeEventsPage,
  },
  {
    // Not a package's screen: the HOST's own report over every web manifest it
    // adopted. It renders `assemble()`, so an unanswered capability is a red
    // page rather than a silence.
    slug: 'wiring-report',
    title: 'Wiring report',
    pkg: '@12-apps/wiring',
    group: 'backoffice',
    Component: WiringReportPage,
  },
  {
    slug: 'audit-log',
    title: 'Audit log',
    pkg: '@12-apps/audit',
    group: 'backoffice',
    Component: AuditLogPage,
  },
  {
    slug: 'feature-flags',
    title: 'Beta flags',
    pkg: '@12-apps/feature-flags',
    group: 'backoffice',
    Component: FeatureFlagsPage,
  },
  // The one page whose package is NOT mounted by the page: `startObservability`
  // runs in `main.tsx`, for the whole bundle, because it installs its global
  // handlers before its own config arrives. This entry drives what is already
  // there — which is exactly the shape a host's adoption has.
  {
    slug: 'observability',
    title: 'Error reporting',
    pkg: '@12-apps/observability-frontend',
    group: 'backoffice',
    Component: ObservabilityPage,
  },
  // ONE entry, and the `pkg` is the UI half deliberately: the page is ABOUT
  // whether the published screens work for a host, and the engine underneath
  // them is what the backend harness exercises.
  {
    slug: 'product-research',
    title: 'Price research',
    pkg: '@12-apps/product-research-ui',
    group: 'backoffice',
    Component: ProductResearchPage,
  },
];
