import { z } from "zod";

import type { WireMcpTool } from "@12-apps/wiring";

/**
 * The marketplace tool surface — authored ONCE, beside the route descriptors
 * it proxies to, and reused as the runtime validators. The advertised schema
 * and what a handler accepts are the same objects, so they cannot drift.
 *
 * The shape is the bulk-upsert protocol: ONE bulk write per entity
 * (connections, SKU links, decisions), each taking a list, all-or-nothing,
 * `validateOnly` supported, idempotent on the natural key, every refusal
 * returned with its path; a connection is ARCHIVED, never deleted. A read is
 * the entity's `list*` tool, taking `ids`.
 *
 * Every input is STRICT (an unknown key is refused, never stripped), and the
 * cross-row checks (a key twice in one call) are part of the schema. The
 * provider is checked for SHAPE here and for EXISTENCE at runtime, because
 * the set of marketplaces is the set of adapters a host registered.
 *
 * Paths are RELATIVE to the http capability's mount (`/api` in the origin
 * host). The webhook is not a tool: a marketplace's server-to-server callback
 * is not a capability anybody invokes.
 */

const providerSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/u);
const environmentSchema = z.enum(["SANDBOX", "PRODUCTION"]);
const booleanText = z.enum(["true", "false"]);
/** A comma-separated id list in a query string: `ids=a,b`. */
const idsText = z
  .string()
  .transform((text) => text.split(",").map((id) => id.trim()).filter((id) => id !== ""))
  .pipe(z.array(z.string().min(1)).min(1).max(100));

/** Flag every row whose key repeats an earlier one, at that row's path. */
function noDuplicates<T>(list: string, field: string, keyOf: (row: T) => string) {
  return (rows: readonly T[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const key = keyOf(row);
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: [index, field], message: `${field} repeats an earlier row of ${list}` });
      }
      seen.add(key);
    });
  };
}

/** Path params for the tenant-scoped marketplace resource. */
export const marketplaceParams = z.strictObject({
  tenantSlug: z.string().min(1),
});

/** Which connections to read. */
export const listMarketplaceIntegrationsQuery = z.strictObject({
  ids: idsText.optional(),
  includeArchived: booleanText.optional(),
});

/** The credential half of a save. Absent leaves the stored secrets alone. */
const credentialsInput = z.strictObject({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullable().optional(),
});

/** Create or patch one connection; any subset of its settings. */
const integrationUpsertInput = z.strictObject({
  operation: z.literal("upsert").optional(),
  provider: providerSchema,
  enabled: z.boolean().optional(),
  environment: environmentSchema.optional(),
  externalMerchantId: z.string().trim().min(1).nullable().optional(),
  autoAccept: z.boolean().optional(),
  // Below a minute nothing human can answer in time; above an hour the
  // deadline has stopped describing anything a marketplace would wait for.
  ackSlaSeconds: z.number().int().min(60).max(3600).optional(),
  credentials: credentialsInput.optional(),
});

/** Archive (reversible) or unarchive one connection, with an optional reason. */
const integrationArchiveInput = z.strictObject({
  operation: z.enum(["archive", "unarchive"]),
  provider: providerSchema,
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});

/** Many connection changes, all-or-nothing. */
export const upsertMarketplaceIntegrationsBody = z.strictObject({
  validateOnly: z.boolean().optional(),
  integrations: z
    .array(z.union([integrationArchiveInput, integrationUpsertInput]))
    .min(1)
    .max(20)
    .superRefine(noDuplicates("integrations", "provider", (row) => row.provider)),
});

/** Filters for the SKU map. `unmapped=true` IS the attention list. */
export const listMarketplaceMenuLinksQuery = z.strictObject({
  provider: providerSchema.optional(),
  // A query string is text: "false" must mean false.
  unmapped: booleanText.optional(),
  ids: idsText.optional(),
});

/** Map one external SKU to a catalog id, or unmap it with `menuItemId: null`. */
const menuLinkInput = z.strictObject({
  provider: providerSchema,
  externalSku: z.string().trim().min(1),
  externalName: z.string().trim().min(1).optional(),
  menuItemId: z.string().min(1).nullable(),
});

/** Many SKU links, all-or-nothing; idempotent on (provider, externalSku). */
export const upsertMarketplaceMenuLinksBody = z.strictObject({
  validateOnly: z.boolean().optional(),
  links: z
    .array(menuLinkInput)
    .min(1)
    .max(200)
    .superRefine(noDuplicates("links", "externalSku", (row) => `${row.provider}\u0000${row.externalSku}`)),
});

/** Which queued orders to read. */
export const listMarketplaceAcceptancesQuery = z.strictObject({
  ids: idsText.optional(),
});

/** What the person confirmed beside an accept, for the host's admission. */
const admissionInput = z.strictObject({
  admitStockPastZero: z.boolean().optional(),
});

/**
 * One decision. An accept may carry the admission and a preparation time; a
 * refusal one of the marketplace's reason codes (its first when omitted) and,
 * for a reason that needs them, the order's offending SKUs. A field of the
 * other kind is refused, not ignored.
 */
const decisionInput = z.discriminatedUnion("decision", [
  z.strictObject({
    orderId: z.string().min(1),
    decision: z.literal("ACCEPT"),
    admission: admissionInput.optional(),
    preparationMinutes: z.number().int().min(1).max(240).optional(),
  }),
  z.strictObject({
    orderId: z.string().min(1),
    decision: z.literal("REJECT"),
    reasonCode: z.string().trim().min(1).optional(),
    offendingSkus: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
  }),
]);

/** Many decisions, all-or-nothing, the host admitting each inside one transaction. */
export const decideMarketplaceOrdersBody = z.strictObject({
  validateOnly: z.boolean().optional(),
  decisions: z
    .array(decisionInput)
    .min(1)
    .max(50)
    .superRefine(noDuplicates("decisions", "orderId", (row) => row.orderId)),
});

const reasonSchema = z.object({
  code: z.string(),
  label: z.string(),
  itemUnavailable: z.boolean(),
  needsItems: z.boolean(),
});

const capabilitiesSchema = z.object({
  apiConfirm: z.boolean(),
  apiCancel: z.boolean(),
  cancelAfterAccept: z.boolean(),
  asyncCancellationOutcome: z.boolean(),
  perOrderAppLink: z.boolean(),
  confirmTakesPreparationTime: z.boolean(),
});

/** A connection as every read returns it: `connected` stands in for the secrets. */
const integrationSchema = z.object({
  provider: z.string(),
  enabled: z.boolean(),
  environment: environmentSchema,
  status: z.enum(["UNVERIFIED", "VERIFIED", "FAILED"]),
  externalMerchantId: z.string().nullable(),
  autoAccept: z.boolean(),
  ackSlaSeconds: z.number().int(),
  connected: z.boolean(),
  lastEventAt: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  capabilities: capabilitiesSchema.nullable(),
  reasons: z.array(reasonSchema),
});

const menuLinkSchema = z.object({
  id: z.string(),
  provider: z.string(),
  externalSku: z.string(),
  externalName: z.string(),
  menuItemId: z.string().nullable(),
  lastSeenAt: z.string(),
});

const pendingAcceptanceSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  provider: z.string(),
  externalOrderId: z.string(),
  externalDisplayId: z.string().nullable(),
  totalCents: z.number().int(),
  buyerName: z.string().nullable(),
  acknowledgeBy: z.string().nullable(),
  externalDueAt: z.string().nullable(),
  commissionCents: z.number().int().nullable(),
  unmappedLines: z.number().int(),
  createdAt: z.string().nullable(),
});

const decidedSchema = z.object({
  orderId: z.string(),
  status: z.enum(["ACCEPTED", "REJECTED"]),
  cancellation: z.enum(["PENDING", "REQUESTED", "CONFIRMED", "FAILED"]).nullable(),
  reasonCode: z.string().nullable(),
  offendingSkus: z.array(z.string()),
});

const BASE = "/admin/{tenantSlug}/marketplace";

/** The six marketplace tools: a read and a bulk write per entity. */
export const MARKETPLACE_MCP_TOOLS = [
  {
    operationId: "listMarketplaceIntegrations",
    method: "GET",
    path: BASE,
    summary:
      "List one or many of a store's marketplace connections (pass `ids` as provider ids, e.g. `ids=IFOOD`): whether each is enabled, its environment, auto-accept, the acknowledgement window, and each marketplace's capabilities and refusal reasons. Archived connections only with `includeArchived=true`. Never returns the stored credentials: `connected` says only whether a set is on file.",
    tags: ["marketplace"],
    params: marketplaceParams,
    query: listMarketplaceIntegrationsQuery,
    response: z.object({ data: z.array(integrationSchema) }),
    annotations: { readOnly: true },
  },
  {
    operationId: "upsertMarketplaceIntegrations",
    method: "PUT",
    path: BASE,
    summary:
      "Create, update, archive or unarchive one or many marketplace connections in one all-or-nothing call. A row is keyed by `provider`; `operation` is `upsert` (default: any subset of the settings; omitting `credentials` keeps the stored secrets, sending them resets the status to UNVERIFIED), `archive` or `unarchive` (reversible, audited, with an optional `reason`). Any problem writes nothing and every problem comes back with its path. `validateOnly: true` checks without writing.",
    tags: ["marketplace"],
    params: marketplaceParams,
    body: upsertMarketplaceIntegrationsBody,
    response: z.object({ data: z.object({ validateOnly: z.boolean(), integrations: z.array(integrationSchema) }) }),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: "listMarketplaceMenuLinks",
    method: "GET",
    path: `${BASE}/menu-links`,
    summary:
      "List a store's marketplace SKU map, or the links named by `ids`: every external SKU an incoming order has carried, and the catalog id it resolves to. `unmapped=true` is the attention list: the SKUs that arrived with nothing behind them, newest-seen first. An unmapped SKU never rejects an order.",
    tags: ["marketplace"],
    params: marketplaceParams,
    query: listMarketplaceMenuLinksQuery,
    response: z.object({ data: z.array(menuLinkSchema) }),
    annotations: { readOnly: true },
  },
  {
    operationId: "upsertMarketplaceMenuLinks",
    method: "PUT",
    path: `${BASE}/menu-links`,
    summary:
      "Map one or many external marketplace SKUs to the store's catalog ids, or unmap them with `menuItemId: null`, in one all-or-nothing call keyed by (`provider`, `externalSku`). A SKU never seen is created, so a store can map ahead of the first order. Applies to orders ingested from now on. Any problem (a catalog id that is not the store's, a repeated SKU) writes nothing; `validateOnly: true` checks without writing.",
    tags: ["marketplace"],
    params: marketplaceParams,
    body: upsertMarketplaceMenuLinksBody,
    response: z.object({ data: z.object({ validateOnly: z.boolean(), links: z.array(menuLinkSchema) }) }),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: "listMarketplaceAcceptances",
    method: "GET",
    path: `${BASE}/acceptances`,
    summary:
      "List the marketplace orders waiting on the store's acceptance, soonest deadline first, or those named by `ids` (order ids). `acknowledgeBy` is the instant the marketplace cancels an unacknowledged order; `unmappedLines` counts the lines that arrived with nothing behind them.",
    tags: ["marketplace"],
    params: marketplaceParams,
    query: listMarketplaceAcceptancesQuery,
    response: z.object({ data: z.array(pendingAcceptanceSchema) }),
    annotations: { readOnly: true },
  },
  {
    operationId: "decideMarketplaceOrders",
    method: "POST",
    path: `${BASE}/acceptances`,
    summary:
      "Accept or refuse one or many marketplace orders on the acceptance clock, all-or-nothing. ACCEPT may carry `admission` (`admitStockPastZero: true` after the store was told an item is short) and `preparationMinutes`. REJECT cancels the order here and asks the marketplace to cancel it, with `reasonCode` from the marketplace's own list (see `listMarketplaceIntegrations`; its first reason when omitted) and, for a reason that needs them, `offendingSkus` from the order. Any problem writes nothing: an unknown code or item is a 422, an order no longer awaiting a decision a 409, and the store's own refusal a 409 with its code (e.g. `MARKETPLACE_STOCK_ASK` with the short items). `validateOnly: true` checks everything without writing.",
    tags: ["marketplace"],
    params: marketplaceParams,
    body: decideMarketplaceOrdersBody,
    response: z.object({ data: z.object({ validateOnly: z.boolean(), decisions: z.array(decidedSchema) }) }),
    annotations: { readOnly: false, destructive: true, openWorld: true },
  },
] as const satisfies readonly WireMcpTool<z.ZodType>[];
