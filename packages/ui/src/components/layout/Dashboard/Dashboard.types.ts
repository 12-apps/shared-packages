import type { ElementType, ReactNode } from 'react';

import type { HeaderActionsProps } from '../../form/HeaderActions';

/** A single breadcrumb entry for `<Dashboard.Breadcrumb>`. */
export interface DashboardBreadcrumbItem {
  /** Visible label. */
  label: string;
  /** Optional link target; omit for the current (last) crumb. */
  href?: string;
}

/** Props for the root `<Dashboard>` provider/layout. */
export interface DashboardProps {
  /** Composed sub-components (`Dashboard.Header`, `Dashboard.Filters`, …). */
  children?: ReactNode;
  /**
   * Whether the filter region starts expanded. Uncontrolled default only —
   * toggled thereafter by `<Dashboard.FilterToggle>`. Defaults to `true`.
   */
  defaultFiltersVisible?: boolean;
  /** Count shown as a badge on `<Dashboard.FilterToggle>`. Defaults to `0`. */
  activeFilterCount?: number;
  /** Prefix for `data-testid` attributes. Defaults to `"dashboard"`. */
  testIdPrefix?: string;
  /** Extra class on the root element. */
  className?: string;
}

/** Props for `<Dashboard.Breadcrumb>`. */
export interface DashboardBreadcrumbProps {
  /** Ordered crumbs, root first. */
  items: DashboardBreadcrumbItem[];
  /** Render function for links, e.g. a Next.js `<Link>`. Defaults to `<a>`. */
  renderLink?: (item: DashboardBreadcrumbItem, children: ReactNode) => ReactNode;
  className?: string;
}

/** Props for `<Dashboard.Header>` — the title row that hosts action parts. */
export interface DashboardHeaderProps {
  /** Page title. */
  title: ReactNode;
  /**
   * Header controls, composed left-to-right (e.g. `<Dashboard.Info>`,
   * `<Dashboard.FilterToggle>`, `<Dashboard.Settings>`, `<Dashboard.Export>`,
   * `<Dashboard.Action>`). Anything after a `<Dashboard.Spacer>` is pushed to
   * the right edge.
   */
  children?: ReactNode;
  className?: string;
}

/** Props for `<Dashboard.Info>` — an `[i]` popover summarising the page. */
export interface DashboardInfoProps {
  /** Popover heading. Defaults to `"About this page"`. */
  title?: ReactNode;
  /** Popover body content. */
  children: ReactNode;
  /** Accessible label for the trigger. Defaults to `"Page information"`. */
  ariaLabel?: string;
}

/** Props for `<Dashboard.FilterToggle>` — the funnel icon. */
export interface DashboardFilterToggleProps {
  /** Accessible label. Defaults to a show/hide string based on state. */
  ariaLabel?: string;
}

/** Shared props for both modes of `<Dashboard.Settings>`. */
interface DashboardSettingsBaseProps {
  /** Accessible label for the trigger. Defaults to `"Settings"`. */
  ariaLabel?: string;
}

/**
 * Dialog mode of `<Dashboard.Settings>` — the gear opens an in-page settings
 * dialog rendering `children`. Mutually exclusive with link mode.
 */
export interface DashboardSettingsDialogProps extends DashboardSettingsBaseProps {
  /** The dialog's close button — a glyph with no visible label. REQUIRED. */
  closeLabel: string;
  /** Dialog title. Defaults to `"Settings"`. */
  title?: ReactNode;
  /** Dialog body. */
  children: ReactNode;
  href?: never;
  linkComponent?: never;
}

/**
 * Link mode of `<Dashboard.Settings>` — the gear renders as a link to a settings
 * route (e.g. a page's Configuração section); no dialog is shown. Mutually
 * exclusive with dialog mode, so `title`/`children` are not accepted.
 */
export interface DashboardSettingsLinkProps extends DashboardSettingsBaseProps {
  /** Link mode opens no dialog, so there is no close button to name. */
  closeLabel?: never;
  /** Link target settings route. */
  href: string;
  /**
   * Element type used to render the gear — e.g. a Next.js `<Link>` — so
   * navigation is client-side and the whole gear is one interactive element.
   * Defaults to a plain `<a>`.
   */
  linkComponent?: ElementType;
  title?: never;
  children?: never;
}

/**
 * Props for `<Dashboard.Settings>` — the gear icon. A discriminated union of two
 * mutually exclusive modes: dialog mode (`children`, no `href`) opens an in-page
 * settings dialog; link mode (`href`) renders the gear as a link to a settings
 * route with no dialog. The compiler rejects mixing the two (e.g. an empty
 * `<Dashboard.Settings />` with neither `children` nor `href`).
 */
export type DashboardSettingsProps =
  | DashboardSettingsDialogProps
  | DashboardSettingsLinkProps;

/** A single export format offered by `<Dashboard.Export>`. */
export interface DashboardExportFormat {
  /** Stable id passed back to `onExport`, e.g. `"csv"`. */
  id: string;
  /** Menu item label, e.g. `"CSV (.csv)"`. */
  label: string;
}

/** Props for `<Dashboard.Export>` — the export dropdown. */
export interface DashboardExportProps {
  /** Offered formats. Defaults to CSV, Excel and JSON. */
  formats?: DashboardExportFormat[];
  /** Invoked with the chosen format id. */
  onExport: (formatId: string) => void;
  /** Button label. Defaults to `"Export"`. */
  label?: ReactNode;
}

/** Props for `<Dashboard.Action>` — a slot for a primary/secondary button. */
export interface DashboardActionProps {
  children: ReactNode;
}

/**
 * Props for `<Dashboard.Actions>` — the header's actions DECLARED, rather than
 * composed one `<Dashboard.Action>` at a time.
 *
 * `testIdPrefix` is not among them: the Dashboard already has one, from its
 * root, and letting the part carry a second would give one page two answers to
 * "what is this header called".
 */
export type DashboardActionsProps = Omit<HeaderActionsProps, 'testIdPrefix'>;

/** Props for `<Dashboard.Filters>` — the collapsible search/filter region. */
export interface DashboardFiltersProps {
  /** Filter controls (search input, pills, `<Dashboard.MoreFilters>`, …). */
  children: ReactNode;
  className?: string;
}

/** Props for `<Dashboard.MoreFilters>` — the advanced, expandable panel. */
export interface DashboardMoreFiltersProps {
  /** Advanced controls, e.g. numeric min/max ranges or date pickers. */
  children: ReactNode;
  /** Toggle label. Defaults to `"More filters"`. */
  label?: ReactNode;
}

/** Props for `<Dashboard.Body>` — the main content area below the header. */
export interface DashboardBodyProps {
  children: ReactNode;
  className?: string;
}
