import { z } from "zod";

import type { WireMcpTool } from "@12-apps/wiring";

/**
 * The marketplace tool surface — authored ONCE, beside the route descriptors
 * it proxies to, and reused as the runtime validators. The advertised schema
 * and what a handler accepts are the same objects, so they cannot drift.
 *
 * Every input is STRICT: an unknown key is a 422 naming it, never a field the
 * parser quietly drops.
 *
 * The provider is checked for SHAPE here and for EXISTENCE at runtime (the
 * engine's registry), because the set of marketplaces is the set of adapters
 * a host registered — a closed enum here would make a new adapter a change to
 * this file.
 *
 * Paths are RELATIVE to the http capability's mount (`/api` in the origin
 * host); the wiring consumer prefixes it, so a tool's URL and its route's URL
 * cannot disagree. The webhook is not a tool: a marketplace's server-to-server
 * callback is not a capability anybody invokes.
 */

const providerSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/u);
const environmentSchema = z.enum(["SANDBOX", "PRODUCTION"]);

/** Path params for the tenant-scoped marketplace resource. */
export const marketplaceParams = z.strictObject({
  tenantSlug: z.string().min(1),
});

/** Path params for one order in the acceptance queue. */
export const marketplaceOrderParams = z.strictObject({
  tenantSlug: z.string().min(1),
  orderId: z.string().min(1),
});

/**
 * The credential half of a save. Optional as a BLOCK: flipping `autoAccept`
 * must not require retyping a secret the screen cannot read back.
 */
const credentialsInput = z.strictObject({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullable().optional(),
});

/** Create or update one marketplace connection; any subset of the settings. */
export const saveMarketplaceIntegrationBody = z.strictObject({
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

/** Which connection to forget. */
export const deleteMarketplaceIntegrationQuery = z.strictObject({
  provider: providerSchema,
});

/** Filters for the SKU map. `unmapped=true` IS the attention list. */
export const listMarketplaceMenuLinksQuery = z.strictObject({
  provider: providerSchema.optional(),
  // A query string is text: "false" must mean false, which `z.coerce.boolean`
  // would read as true.
  unmapped: z.enum(["true", "false"]).optional(),
});

/** Point one external SKU at a catalog id, or unmap it with `menuItemId: null`. */
export const setMarketplaceMenuLinkBody = z.strictObject({
  provider: providerSchema,
  externalSku: z.string().trim().min(1),
  menuItemId: z.string().min(1).nullable(),
});

/**
 * Accept, or refuse with one of the marketplace's own reason codes.
 *
 * ONE tool for both, and all-or-nothing: a refusal whose code is not the
 * marketplace's is a 422 and nothing is written. With no code the
 * marketplace's first reason is taken. A code on an accept is refused by the
 * schema rather than ignored.
 */
export const decideMarketplaceOrderBody = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("ACCEPT") }),
  z.strictObject({ decision: z.literal("REJECT"), reasonCode: z.string().trim().min(1).optional() }),
]);

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

/**
 * A connection as every read returns it. `connected` stands in for the
 * credential blob: whether a secret EXISTS is the only fact about it anyone
 * needs. The marketplace's capabilities and reasons ride along, so a client
 * draws its refusal dialog without a second call and without the network.
 */
export const integrationSchema = z.object({
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
  capabilities: capabilitiesSchema.nullable(),
  reasons: z.array(reasonSchema),
});

/** A SKU→catalog link, mapped or not. */
export const menuLinkSchema = z.object({
  id: z.string(),
  provider: z.string(),
  externalSku: z.string(),
  externalName: z.string(),
  menuItemId: z.string().nullable(),
  lastSeenAt: z.string(),
});

/** One order waiting on the store's acceptance. */
export const pendingAcceptanceSchema = z.object({
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

/** What a decision answers. */
export const decisionSchema = z.object({
  id: z.string(),
  ackStatus: z.enum(["AWAITING", "ACCEPTED", "REJECTED", "EXPIRED"]),
  cancellation: z.enum(["PENDING", "REQUESTED", "CONFIRMED", "FAILED"]).nullable(),
  reasonCode: z.string().nullable(),
});

const BASE = "/admin/{tenantSlug}/marketplace";

/** The seven marketplace tools, one per authenticated route. */
export const MARKETPLACE_MCP_TOOLS = [
  {
    operationId: "listMarketplaceIntegrations",
    method: "GET",
    path: BASE,
    summary:
      "List a store's marketplace connections: which marketplaces are connected, whether each is enabled, its environment, whether incoming orders are auto-accepted, how long the store has to acknowledge one, and each marketplace's capabilities and refusal reasons. Never returns the stored credentials: `connected` says only whether a set is on file.",
    tags: ["marketplace"],
    params: marketplaceParams,
    response: z.object({ data: z.array(integrationSchema) }),
    annotations: { readOnly: true },
  },
  {
    operationId: "saveMarketplaceIntegration",
    method: "PUT",
    path: BASE,
    summary:
      "Create or update a store's marketplace connection. Any subset of the settings; omitting `credentials` leaves the stored secrets untouched, and sending them resets the connection to UNVERIFIED.",
    tags: ["marketplace"],
    params: marketplaceParams,
    body: saveMarketplaceIntegrationBody,
    response: z.object({ data: integrationSchema }),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: "deleteMarketplaceIntegration",
    method: "DELETE",
    path: BASE,
    summary:
      "Forget a store's marketplace connection and its stored credentials. Orders already ingested from that marketplace are untouched: they are sales, not integration state.",
    tags: ["marketplace"],
    params: marketplaceParams,
    query: deleteMarketplaceIntegrationQuery,
    response: z.object({ data: z.object({ ok: z.literal(true) }) }),
    annotations: { readOnly: false, destructive: true },
  },
  {
    operationId: "listMarketplaceMenuLinks",
    method: "GET",
    path: `${BASE}/menu-links`,
    summary:
      "List a store's marketplace SKU map: every external SKU an incoming order has carried, and the catalog id it resolves to. Pass `unmapped=true` for the attention list: the SKUs that arrived with nothing behind them, newest-seen first. An unmapped SKU never rejects an order.",
    tags: ["marketplace"],
    params: marketplaceParams,
    query: listMarketplaceMenuLinksQuery,
    response: z.object({ data: z.array(menuLinkSchema) }),
    annotations: { readOnly: true },
  },
  {
    operationId: "setMarketplaceMenuLink",
    method: "PUT",
    path: `${BASE}/menu-links`,
    summary:
      "Map an external marketplace SKU to one of the store's catalog ids, or unmap it with `menuItemId: null`. Creates the link if the SKU has never been seen, so a store can map ahead of the first order. Applies to orders ingested from now on.",
    tags: ["marketplace"],
    params: marketplaceParams,
    body: setMarketplaceMenuLinkBody,
    response: z.object({ data: menuLinkSchema }),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: "listMarketplaceAcceptances",
    method: "GET",
    path: `${BASE}/acceptances`,
    summary:
      "List marketplace orders waiting on the store's acceptance, soonest deadline first. `acknowledgeBy` is the instant the marketplace cancels an unacknowledged order, and `unmappedLines` counts the lines that arrived with nothing behind them.",
    tags: ["marketplace"],
    params: marketplaceParams,
    response: z.object({ data: z.array(pendingAcceptanceSchema) }),
    annotations: { readOnly: true },
  },
  {
    operationId: "decideMarketplaceOrder",
    method: "POST",
    path: `${BASE}/acceptances/{orderId}`,
    summary:
      "Accept or refuse one marketplace order on the acceptance clock. Refusing cancels it here and asks the marketplace to cancel it, with `reasonCode` from the marketplace's own list (see `listMarketplaceIntegrations`; the first reason when omitted). All-or-nothing: an unknown code is refused with 422 and nothing changes. An order no longer awaiting a decision is refused with 409.",
    tags: ["marketplace"],
    params: marketplaceOrderParams,
    body: decideMarketplaceOrderBody,
    response: z.object({ data: decisionSchema }),
    annotations: { readOnly: false, destructive: true, openWorld: true },
  },
] as const satisfies readonly WireMcpTool<z.ZodType>[];
