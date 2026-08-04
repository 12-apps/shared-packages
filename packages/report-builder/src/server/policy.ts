/**
 * Reporting authorization + guardrail policy (FUT-138), shared by the run
 * endpoints, the saved-report routes and the field-catalog listing. Prisma-free.
 */

type ReportEntityPermission =
  | "reports:sales:read"
  | "stock:read"
  | "reports:kitchen:read";

/**
 * The permission required to QUERY each catalog entity — the same split the
 * built-in presets use: sales-side entities ride the sales report tier,
 * stock-side entities the stock tier. A spec's entity decides what running it
 * requires; there is no way to reach an entity outside this map.
 *
 * The kitchen entities ride their OWN tier (FUT-454) rather than the sales
 * one: they carry per-cook timings, and a cook must not be able to read the
 * ranking they appear in just because they can read the kitchen board.
 */
export const REPORT_ENTITY_PERMISSION: Record<string, ReportEntityPermission> = {
  orders: "reports:sales:read",
  order_items: "reports:sales:read",
  payments: "reports:sales:read",
  stock_movements: "stock:read",
  loss_events: "stock:read",
  kitchen_ticket_items: "reports:kitchen:read",
  kitchen_shifts: "reports:kitchen:read",
};

/**
 * Hard cap on rows returned by a report run (Tabwoah's QUERY_DATASOURCE cap
 * pattern): protects the API and keeps LLM-facing responses bounded.
 */
export const REPORT_RUN_MAX_ROWS = 500;
