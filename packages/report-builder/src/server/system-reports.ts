import type { ReportSpecInput, TimeGrain } from '../index';

/**
 * BUILT-IN ("system") REPORTS — the SHAPE, which is this package's, over
 * CONTENT, which is never this package's.
 *
 * A built-in is a fixed view OF one of the host's admin areas: sales over time,
 * stock movements, whatever that host's product happens to be. The pipeline it
 * runs on is this package's — spec, catalog, window, permission narrowing,
 * rendering, the hub card and the deep link — and the query is the host's,
 * because only the host has entities to query.
 *
 * This module used to ship seven of them (`presets.ts`, `presets-kitchen.ts`):
 * future-pay's revenue, product ranking, payment-method donut, peak hours,
 * stock ledger, losses and its kitchen dashboard, in pt-BR, over entities named
 * `orders` and `kitchen_ticket_items`, gated by ids from that application's
 * catalog. They were the DEFAULT, so a host that named none served all seven —
 * over its own catalog, where they did not compile. The definitions moved to
 * the host; the types, the nav projection and the lookups stayed.
 */

export interface SystemReportDef {
  /** Stable key: the URL segment, the deep link, the nav testid. */
  key: string;
  title: string;
  description: string;
  /**
   * The permission required to run and to SEE it — one of the HOST's ids, from
   * the same catalog `entityPermission` names. Not a union here: this package
   * has no business enumerating another application's permissions, and the
   * three it used to enumerate (`reports:sales:read`, `stock:read`,
   * `reports:kitchen:read`) were exactly that.
   */
  permission: string;
  /**
   * The host nav section this report is nested under — a key of the host's own
   * menu, matched against {@link SystemReportSection}. Built-ins are fixed
   * views OF an area, so they live WITH that area rather than in a hub the
   * reader has to remember to visit.
   */
  section: string;
  /** Whether the date-grain toggle (day/week/month) applies. */
  supportsGrain: boolean;
  /** Presentation kind surfaced on the hub card. */
  presentation: 'chart' | 'table';
  build: (options: { grain: TimeGrain }) => ReportSpecInput;
}

/**
 * A host menu section a built-in can belong to, as this surface needs it: the
 * key its reports name, the words the back-link reads, and where that link
 * goes.
 *
 * The label and the path are declared rather than derived. They used to be
 * derived — a hardcoded `{ orders: 'Pedidos', inventory: 'Estoque', kitchen:
 * 'Cozinha' }` map, plus the assumption that a section key IS the host's URL
 * segment (`/{tenantSlug}/{section}`). Both are facts about one host's menu:
 * the labels are that host's product vocabulary in its language, and the path
 * assumption breaks for any host whose stock area is not mounted at `/stock`.
 */
export interface SystemReportSection {
  /** Matches `SystemReportDef.section`. */
  key: string;
  /** What the back-link reads, in the host's own words and language. */
  label: string;
  /**
   * Where the back-link goes, relative to the tenant root and without a leading
   * slash (`'orders'`, `'stock/movements'`). The surface prefixes the tenant.
   */
  path: string;
}

export interface SystemDashboardBlockDef {
  /** The {@link SystemReportDef.key} this block renders. */
  reportKey: string;
  /** Width on the 12-column canvas; at or above the presentation's floor. */
  span: number;
}

export interface SystemDashboardDef {
  key: string;
  title: string;
  description: string;
  /**
   * The single tier gating the whole canvas. Every member report should carry
   * the SAME permission: a mixed-tier dashboard renders a partly-empty canvas
   * that reads as "no sales" rather than as a missing grant.
   */
  permission: string;
  section: string;
  /**
   * Canvas-level disclosures rendered above the blocks: the facts a reader
   * needs in order to read ANY figure on the page — what is excluded from the
   * data, and when a figure is withheld rather than absent.
   */
  notes?: readonly string[];
  blocks: readonly SystemDashboardBlockDef[];
}

/** One built-in report as a host's lateral menu needs it. */
export interface SystemReportNavEntry {
  key: string;
  title: string;
  description: string;
  /** The READ permission gating the entry — identical to the API's own gate. */
  permission: string;
  section: string;
  /**
   * Whether the date-grain toggle applies. Carried on the nav entry so a
   * surface composing several reports can decide whether to OFFER the toggle
   * before any of them has loaded.
   */
  supportsGrain: boolean;
}

/**
 * The built-ins as MENU entries, in declaration order.
 *
 * The host nests each under the nav item matching its `section` and gates it on
 * `permission`; the server re-checks that permission on every run, so the menu
 * can only ever hide a report the API would have refused — never grant one.
 */
export function systemReportNav(
  reports: readonly SystemReportDef[],
): readonly SystemReportNavEntry[] {
  return reports.map((report) => ({
    key: report.key,
    title: report.title,
    description: report.description,
    permission: report.permission,
    section: report.section,
    supportsGrain: report.supportsGrain,
  }));
}

/** Look up one built-in by key. */
export function findSystemReport(
  reports: readonly SystemReportDef[],
  key: string,
): SystemReportDef | undefined {
  return reports.find((report) => report.key === key);
}

/** Look up one dashboard by key. */
export function findSystemDashboard(
  dashboards: readonly SystemDashboardDef[],
  key: string,
): SystemDashboardDef | undefined {
  return dashboards.find((dashboard) => dashboard.key === key);
}
