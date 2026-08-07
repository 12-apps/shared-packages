import type { ComponentType } from 'react';

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
 * payments one drives the backend's adapters through the frontend's settings
 * screen), and what matters in the nav is which package the page is ABOUT.
 */
export interface HarnessPage {
  /** URL segment after the hash, and the test id the nav link carries. */
  slug: string;
  title: string;
  pkg: string;
  Component: ComponentType;
}

export const PAGES: readonly HarnessPage[] = [
  {
    slug: 'payments-provider-settings',
    title: 'Provider settings',
    pkg: '@12-apps/payments-frontend',
    Component: PaymentsProviderSettingsPage,
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
