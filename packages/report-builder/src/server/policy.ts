/**
 * The one guardrail this surface sets for every host (FUT-138). Prisma-free.
 *
 * `REPORT_ENTITY_PERMISSION` used to live here too: a seven-line map from
 * the origin host's entities to the origin host's permission ids (`orders →
 * reports:sales:read`, `stock_movements → stock:read`, `kitchen_ticket_items →
 * reports:kitchen:read`), typed against a union of those three ids, and
 * installed as the DEFAULT for any host that named none. That is the host's
 * policy over the host's data; it is now a required config field —
 * `ReportBuilderServerConfig.entityPermission` — checked against the catalog at
 * assembly.
 */

/**
 * Hard cap on rows returned by a report run (Tabwoah's QUERY_DATASOURCE cap
 * pattern): protects the API and keeps LLM-facing responses bounded.
 *
 * This one genuinely IS the package's: a property of the response envelope this
 * surface promises, not of any host's data. A host may lower it with `maxRows`.
 */
export const REPORT_RUN_MAX_ROWS = 500;
