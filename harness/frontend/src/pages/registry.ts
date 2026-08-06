import type { ComponentType } from 'react';

import { BlockTemplatePickerPage } from './block-template-picker';
import { PaymentsProviderSettingsPage } from './payments-provider-settings';
import { ReportBuilderPage } from './report-builder';
import { UnsavedChangesPage } from './unsaved-changes';
import { ReportCardListPage } from './report-card-list';
import { ReportRenderPage } from './report-render';

/**
 * One page per published surface, and the ONLY place a new one is registered.
 *
 * Adding a package to the harness is meant to be two steps and no more: write
 * `pages/<slug>.tsx` that renders the published thing, then add a line here.
 * The shell builds its nav from this list, so nothing else has to change — and
 * a spec addresses a page by slug (`#/<slug>`), so specs do not move when the
 * nav grows.
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
    slug: 'report-builder',
    title: 'Report builder',
    pkg: '@12-apps/report-builder',
    Component: ReportBuilderPage,
  },
  {
    slug: 'report-card-list',
    title: 'Report list',
    pkg: '@12-apps/report-builder/react',
    Component: ReportCardListPage,
  },
  {
    slug: 'block-template-picker',
    title: 'Block template picker',
    pkg: '@12-apps/report-builder/react',
    Component: BlockTemplatePickerPage,
  },
  {
    slug: 'report-render',
    title: 'Chart + table fallback',
    pkg: '@12-apps/report-builder/react',
    Component: ReportRenderPage,
  },
  {
    slug: 'unsaved-changes',
    title: 'Unsaved changes',
    pkg: '@12-apps/report-builder',
    Component: UnsavedChangesPage,
  },
];
