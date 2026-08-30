import { z } from "zod";

import {
  createSearchInput,
  createSearchOutput,
  searchConfigSchema,
  type SearchConfig,
} from "@12-apps/shared-helpers/search";
import type { WireMcpTool } from "@12-apps/wiring";

import {
  DISCOUNT_SCOPES,
  DISCOUNT_TARGET_TYPES,
  DISCOUNT_TRIGGERS,
  DISCOUNT_TYPES,
  MAX_COMBO_SLOTS,
  MAX_COMBO_SLOT_QUANTITY,
  MAX_PERCENT_OFF_BP,
} from "../engine/kinds";
import { MAX_SCHEDULE_WINDOWS } from "../engine/schedule";
import { discountSearchConfig } from "./search";

/**
 * The discounts tool surface — authored ONCE, beside the route descriptors it
 * proxies to, and reused as the runtime validators. The advertised schema and
 * what the handler accepts are the same objects, so they cannot drift.
 *
 * Every enum comes from `../engine/kinds` rather than being spelled out as
 * literals: those same arrays back a host's CHECK constraints, so a value an
 * agent can send is by construction a value the database will store.
 *
 * Paths are RELATIVE to the http capability's mount — the wiring consumer
 * prefixes the adoption's `mountPath`, so a tool's URL and its route's URL
 * cannot disagree.
 */

/** Path params for the tenant-scoped discounts collection. */
export const discountCollectionParams = z.object({
  tenantSlug: z.string().min(1),
});

/** Path params for a single discount. */
export const discountItemParams = z.object({
  tenantSlug: z.string().min(1),
  id: z.string().min(1),
});

/**
 * A calendar date (`YYYY-MM-DD`), read at UTC midnight by the API.
 *
 * No custom message: a sentence here would be a default in one language, and
 * the schema's own path is what a client renders. The SEMANTIC failure — a
 * date that is not a date — is reported by `toDiscountScalars` with the host's
 * `invalidDate` copy and the field to paint.
 */
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * One combo slot: what fills it, and how many units of it one application
 * needs. Both target lists default to empty and at least one must be
 * non-empty — a rule `./validate-combo.ts` enforces with the host's own
 * sentence, because a Zod refinement here could only answer in a Zod path.
 */
export const comboRequirementSchema = z.object({
  menuItemIds: z.array(z.string().min(1)).default([]),
  categoryIds: z.array(z.string().min(1)).default([]),
  quantity: z.number().int().min(1).max(MAX_COMBO_SLOT_QUANTITY),
});

/**
 * A `HH:MM` clock time, 24-hour — the schedule's own wire format (FUT-996).
 *
 * A string rather than minutes-since-midnight because it is what an operator
 * typed and what a card reads back; converting at the edge would mean two
 * representations of one fact and a conversion to get wrong in each direction.
 */
const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour");

/**
 * One "these days, these hours" row. `days` is **Monday-first, 0..6** — the
 * same axis every hours surface uses, and NOT `Date#getDay()`'s Sunday-first.
 *
 * `to` earlier than `from` is legal and means the window runs past midnight: a
 * bar shutting at 02:00 is the most common happy hour there is.
 */
const scheduleWindowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: clockTimeSchema,
  to: clockTimeSchema,
});

/** The weekly schedule. Null = always, within the campaign window. */
const discountScheduleSchema = z.object({
  windows: z.array(scheduleWindowSchema).min(1).max(MAX_SCHEDULE_WINDOWS),
});

/**
 * A discount as the API returns it (JSON-serialized: dates become ISO
 * strings). The two join tables are flattened into id arrays.
 */
export const discountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(DISCOUNT_TYPES),
  /** Basis points off (1..10000). Non-null iff `type = PERCENTAGE`. */
  percentOffBp: z.number().int().nullable(),
  /** Cents off. Non-null iff `type = FIXED_AMOUNT`. */
  amountOffCents: z.number().int().nullable(),
  /**
   * The COMBO half. OPTIONAL in the RESPONSE, unlike in the body, because the
   * record is assembled by a host's store: an adopter that has not added the
   * columns still answers a valid discount, and one that has says so. See
   * `DiscountRecord` in `./store`.
   */
  bundlePriceCents: z.number().int().nullable().optional(),
  freeUnits: z.number().int().nullable().optional(),
  maxComboApplications: z.number().int().nullable().optional(),
  comboRequirements: z.array(comboRequirementSchema).optional(),
  scope: z.enum(DISCOUNT_SCOPES),
  trigger: z.enum(DISCOUNT_TRIGGERS),
  code: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  schedule: discountScheduleSchema.nullable().optional(),
  minSubtotalCents: z.number().int().nullable(),
  usageLimit: z.number().int().nullable(),
  perBuyerLimit: z.number().int().nullable(),
  usageCount: z.number().int(),
  stackable: z.boolean(),
  active: z.boolean(),
  categoryIds: z.array(z.string()),
  menuItemIds: z.array(z.string()),
  createdAt: z.string(),
});

/**
 * The list query, from the same config the store's engine reads.
 *
 * A host that tunes its page-size ceilings by environment, or that adds a pill
 * of its own vocabulary, builds its own with this factory and hands the result
 * to BOTH `createApiDiscounts({ listQuery })` and the adoption's
 * `mcpOverrides.listDiscounts.query` — one schema, advertised and enforced.
 */
export function createDiscountListQuery<E extends Record<string, z.ZodTypeAny>>(
  config: SearchConfig,
  extraShape?: E,
) {
  return createSearchInput(discountSearchConfig, config, extraShape);
}

/**
 * The package's own list query: the search config's DEFAULTS, not the
 * environment's. This module is imported by an offline tool generator and by
 * browsers; reading `process.env` at module scope would make the advertised
 * surface depend on where it was generated.
 */
export const listDiscountsQuery = createDiscountListQuery(searchConfigSchema.parse({}));

/**
 * The write body, shared by create and update: a discount is always saved
 * WHOLE (the form re-states every field), so there is no partial-patch shape
 * to diverge from. The cross-field rules — a rate iff PERCENTAGE, a code iff
 * CODE, a target iff CATEGORY/ITEM, a slot list iff COMBO, a combo reward ONLY
 * at COMBO scope, `endsAt` strictly after `startsAt` — are enforced in
 * `./validate` and `./validate-combo`, where they produce a sentence naming the
 * field instead of a Zod path.
 */
const discountWriteShape = {
  name: z.string().min(2).max(120),
  type: z.enum(DISCOUNT_TYPES),
  percentOffBp: z.number().int().min(1).max(MAX_PERCENT_OFF_BP).nullable().optional(),
  amountOffCents: z.number().int().positive().nullable().optional(),
  bundlePriceCents: z.number().int().positive().nullable().optional(),
  freeUnits: z.number().int().positive().nullable().optional(),
  comboRequirements: z.array(comboRequirementSchema).max(MAX_COMBO_SLOTS).optional(),
  maxComboApplications: z.number().int().positive().nullable().optional(),
  scope: z.enum(DISCOUNT_SCOPES),
  trigger: z.enum(DISCOUNT_TRIGGERS),
  code: z.string().min(1).max(64).nullable().optional(),
  startsAt: calendarDateSchema.nullable().optional(),
  endsAt: calendarDateSchema.nullable().optional(),
  schedule: discountScheduleSchema.nullable().optional(),
  minSubtotalCents: z.number().int().positive().nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perBuyerLimit: z.number().int().positive().nullable().optional(),
  stackable: z.boolean(),
  active: z.boolean(),
  categoryIds: z.array(z.string().min(1)).optional(),
  menuItemIds: z.array(z.string().min(1)).optional(),
};

/** Body for creating a discount. */
export const createDiscountBody = z.object(discountWriteShape);

/** Body for updating a discount (every field re-stated). */
export const updateDiscountBody = z.object(discountWriteShape);

/**
 * One collection of things a discount may be pointed at, and its rows.
 *
 * `targets` is the WHOLE collection rather than a page, deliberately: a picker
 * that paginated would let an operator save a discount whose existing targets
 * were never on screen. See `DiscountableOps.list`.
 */
export const discountTargetGroupSchema = z.object({
  targetType: z.enum(DISCOUNT_TARGET_TYPES),
  slug: z.string(),
  label: z.string(),
  nests: z.boolean(),
  targets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      parentId: z.string().nullable().optional(),
    }),
  ),
});

/** `{ data: { id } }` acknowledgement for update/delete. */
const discountIdResponse = z.object({ data: z.object({ id: z.string() }) });

/**
 * The tools, one per route descriptor. `annotations` travel WITH the tool —
 * the package knows perfectly well that `listDiscounts` only reads and that
 * `deleteDiscount` is the destructive one, and a host's policy table would
 * otherwise restate all five by hand.
 */
export const DISCOUNTS_MCP_TOOLS: readonly WireMcpTool<z.ZodType>[] = [
  {
    operationId: "listDiscounts",
    method: "GET",
    path: "/discounts",
    summary:
      "List a store's discounts and promotions (admin). Backend filter (`q` over name and coupon code, `type_in` PERCENTAGE|FIXED_AMOUNT|BUNDLE_PRICE|FREE_UNITS, `scope_in` ORDER|CATEGORY|ITEM|COMBO, `trigger_in` AUTOMATIC|CODE, `active`), `sort` (field:asc|desc), and pagination (`page`/`pageSize`). Returns the page plus `pagination` (total, pageCount, hasNextPage).",
    tags: ["discounts"],
    params: discountCollectionParams,
    query: listDiscountsQuery,
    response: createSearchOutput(discountSchema),
    annotations: { readOnly: true },
  },
  {
    operationId: "listDiscountTargets",
    method: "GET",
    path: "/discounts/targets",
    summary:
      "List what a discount can be pointed at in this store: every registered collection (categories, products) with its rows. Read this before creating or updating a CATEGORY- or ITEM-scoped discount, or a combo slot — an id from anywhere else is refused as not belonging to the store.",
    tags: ["discounts"],
    params: discountCollectionParams,
    response: z.object({ data: z.array(discountTargetGroupSchema) }),
    annotations: { readOnly: true },
  },
  {
    operationId: "getDiscount",
    method: "GET",
    path: "/discounts/{id}",
    summary: "Read one of a store's discounts by id (admin).",
    tags: ["discounts"],
    params: discountItemParams,
    response: z.object({ data: discountSchema }),
    annotations: { readOnly: true },
  },
  {
    operationId: "createDiscount",
    method: "POST",
    path: "/discounts",
    summary:
      "Create a discount for a store (admin). A percentage is basis points (1..10000); a fixed amount is integer cents. A CODE-triggered discount needs a coupon code, unique within the store; a CATEGORY/ITEM-scoped one needs at least one target. A COMBO-scoped one is a bundle: `comboRequirements` lists its slots (products and/or categories, with a per-slot `quantity`), and the reward is either `BUNDLE_PRICE` (what the whole matched group costs, in cents) or `FREE_UNITS` (how many of its cheapest units are free — \"3 for the price of 2\" is one slot of quantity 3 with `freeUnits` 1), or an ordinary percentage/fixed amount off the group.",
    tags: ["discounts"],
    params: discountCollectionParams,
    body: createDiscountBody,
    response: z.object({ data: discountSchema }),
  },
  {
    operationId: "updateDiscount",
    method: "PATCH",
    path: "/discounts/{id}",
    summary: "Update a store's discount (every field is re-stated, targets included).",
    tags: ["discounts"],
    params: discountItemParams,
    body: updateDiscountBody,
    response: discountIdResponse,
  },
  {
    operationId: "deleteDiscount",
    method: "DELETE",
    path: "/discounts/{id}",
    summary:
      "Delete a store's discount (admin). Soft-delete: the discount stops applying and leaves the list, while the orders that already redeemed it keep their snapshot and its redemption counter is preserved.",
    tags: ["discounts"],
    params: discountItemParams,
    response: discountIdResponse,
    annotations: { destructive: true },
  },
];
