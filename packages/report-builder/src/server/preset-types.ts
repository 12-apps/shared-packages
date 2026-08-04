import type { ReportSpecInput, TimeGrain } from "../index";

/**
 * The shape of a built-in report and of a consolidated dashboard, split out of
 * `presets.ts` (FUT-454) so a section's presets can live in their own module
 * without importing the catalogue that registers them.
 */

/** Permission required to run/see a preset (checked via getActorPermissions). */
export type SystemReportPermission =
  | "reports:sales:read"
  | "stock:read"
  | "reports:kitchen:read";

/**
 * Which area of the host's lateral menu a built-in report is nested under
 * (FUT-391). Built-ins are no longer listed in the Relatórios area: they are
 * fixed views OF an area, so they live WITH that area — a stock report hangs
 * off Estoque, a sales report off Pedidos, a kitchen report off Cozinha. The
 * value is the host nav item's stable key, which is why it is data here and
 * not inferred from `permission` (the same tier can serve more than one
 * section).
 */
export type SystemReportSection = "orders" | "inventory" | "kitchen";

export interface SystemReportDef {
  key: string;
  title: string;
  description: string;
  permission: SystemReportPermission;
  /** The lateral-menu section this report is nested under (FUT-391). */
  section: SystemReportSection;
  /** Whether the date-grain toggle (dia/semana/mês) applies. */
  supportsGrain: boolean;
  /** Presentation kind surfaced on the hub card. */
  presentation: "chart" | "table";
  build: (options: { grain: TimeGrain }) => ReportSpecInput;
}

export interface SystemDashboardBlockDef {
  /** The `SYSTEM_REPORTS` key this block renders. */
  reportKey: string;
  /** Width on the 12-column canvas; at or above the presentation's floor. */
  span: number;
}

export interface SystemDashboardDef {
  key: string;
  title: string;
  description: string;
  /**
   * The single tier gating the whole canvas. Every member preset carries the
   * SAME permission (asserted by the unit tests): a mixed-tier dashboard would
   * render a partly-empty canvas that reads as "no sales" rather than as a
   * missing grant, so it is a definition error, not a runtime filter.
   */
  permission: SystemReportPermission;
  section: SystemReportSection;
  /**
   * Canvas-level disclosures rendered above the blocks (FUT-454): the facts a
   * reader needs in order to read ANY figure on the page — what is excluded
   * from the data, and when a figure is withheld rather than absent.
   *
   * They live on the dashboard rather than only on each report's own
   * description because the canvas is where the numbers are actually read: a
   * caveat that only appears on a deep-link page nobody visits is a caveat
   * that was never made.
   */
  notes?: readonly string[];
  blocks: readonly SystemDashboardBlockDef[];
}
