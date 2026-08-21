import type { PaginatedResult, ParsedSearchInput } from "@12-apps/shared-helpers/search";

import type { DiscountScope, DiscountTrigger, DiscountType } from "../engine/kinds";
import type { DiscountScalars, DiscountTargets } from "./validate";

/**
 * The persistence seam — the ONE thing this package does not do.
 *
 * A discount's rows relate to a host's own catalog and orders: targets point
 * at its categories and items, redemptions at its orders and its buyers. A
 * shipped Prisma partial would therefore only compile inside a host that
 * already has those tables under those names, which is why the manifest
 * declares no `db` capability and this interface exists instead. The host
 * owns the schema, the tenant scoping, the transactions and the uniqueness
 * conflicts; the package owns the rules and the wire.
 *
 * Everything here is `clientId`-first for the same reason the origin
 * implementation is: a discount is a direct lever on what a buyer is charged,
 * so a query that forgot its tenant would not merely leak a row — it would let
 * one store edit another store's prices.
 */

/** One discount as the admin API returns it, before JSON serialization. */
export interface DiscountRecord {
  id: string;
  name: string;
  type: DiscountType | string;
  percentOffBp: number | null;
  amountOffCents: number | null;
  scope: DiscountScope | string;
  trigger: DiscountTrigger | string;
  code: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  minSubtotalCents: number | null;
  usageLimit: number | null;
  perBuyerLimit: number | null;
  usageCount: number;
  stackable: boolean;
  active: boolean;
  /**
   * The join tables flattened into plain id arrays: a form's target pickers
   * bind to ids, and a client has no business knowing there are two joins.
   */
  categoryIds: string[];
  menuItemIds: string[];
  createdAt: Date;
}

/**
 * What a write persists: the validated columns and the scope-narrowed targets.
 *
 * The store receives them ALREADY folded, never the raw body — every rule
 * (`toDiscountScalars`) has run, the unused half of each either/or pair is
 * NULL, and the targets are de-duplicated. So a store implementation is
 * persistence and nothing else, and the rules cannot be half-applied by a
 * second caller that forgot one.
 */
export interface DiscountWrite {
  scalars: DiscountScalars;
  targets: DiscountTargets;
}

/**
 * The list query as the store receives it: the shared search engine's parsed
 * input, widened so a host can carry pills of its OWN vocabulary through.
 *
 * The widening is the point. A promotions grid usually wants a validity pill
 * — running / scheduled / ended — which compares two nullable columns against
 * "now" and no `filterableField` can express; its VALUES are words a host
 * chose, in a language this package does not have. So the host extends the
 * advertised query schema (an `mcpOverrides` entry, the same object it hands
 * `createApiDiscounts` as `listQuery`), and reads its own key back out here.
 */
export type DiscountListInput = ParsedSearchInput & Readonly<Record<string, unknown>>;

/** One backend-paginated page of the admin discounts grid. */
export type DiscountPage = PaginatedResult<DiscountRecord>;

export interface DiscountStore {
  /** One page of this tenant's LIVE discounts, filtered/sorted/paginated. */
  list(clientId: string, input: DiscountListInput): Promise<DiscountPage>;
  /** One LIVE discount owned by `clientId`, or null (stale, foreign, archived). */
  get(clientId: string, id: string): Promise<DiscountRecord | null>;
  /**
   * Persist a new discount and its targets. Implementations raise their own
   * host error for a uniqueness clash (name or coupon code within the tenant)
   * and for a target id that belongs to another tenant — both are database
   * facts this package cannot see, and both must reach the operator naming the
   * offending field.
   */
  create(clientId: string, write: DiscountWrite): Promise<DiscountRecord>;
  /** Re-state a discount whole. Raises the host's not-found for a stale id. */
  update(clientId: string, id: string, write: DiscountWrite): Promise<void>;
  /**
   * SOFT-delete. The row survives: its redemption snapshots are order history
   * and its counter is reporting history, so removing it would either orphan
   * redemptions or reset a number the store may still be asked to explain.
   */
  archive(clientId: string, id: string): Promise<void>;
}
