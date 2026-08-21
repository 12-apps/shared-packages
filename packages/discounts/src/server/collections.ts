import { DISCOUNT_TARGET_TYPES, type DiscountTargetType } from "../engine/kinds";
import type { ComboRequirement } from "../engine/types";
import type { DiscountTargets } from "./validate";

/**
 * How a host TABLE opts into being discountable (FUT-244).
 *
 * A discount points at rows this package will never see: a store's categories,
 * its products, and — the day a host wants it — its suppliers or its shelves.
 * Every one of those questions ("which of them exist", "are they this
 * tenant's", "what is this one filed under") is answerable only by the host,
 * and until now each host answered them in its own hand-written code beside
 * its own tables.
 *
 * The shape is deliberately {@link LifecycleEntityRegistration}'s, from
 * `@12-apps/entity-lifecycle`: identity plus a duck-typed ops seam the host
 * implements against its own tables. The family resemblance is the point — a
 * reader who knows one knows this one — and so is the difference: entity
 * lifecycle registers a collection it DRIVES, with write ops, while this
 * registers a catalog dimension it only QUERIES, so every op here reads.
 *
 * ## Why this is not a wiring capability
 *
 * `@12-apps/wiring`'s contract folder holds http, web, mcp, db, env, jobs,
 * email, notifications and permissions — there is no registration or extension
 * concept, so promoting this would be a genuinely new capability minted on two
 * instances that differ in the way just described. Abstracting one contract
 * over both risks fitting neither. It lives here, shaped like its sibling, and
 * a third consumer is what would earn it a place in the contract.
 */

/** One selectable row of a host collection, as a picker renders it. */
export interface DiscountTarget {
  id: string;
  /** The operator-facing name. Host vocabulary, host language. */
  name: string;
  /**
   * The parent row, for a collection that NESTS (a category tree). A picker
   * uses it to render a tree instead of a flat list, and the evaluator's
   * category path is built from the same edges. Absent or null at the root.
   */
  parentId?: string | null;
}

/**
 * The three reads this package needs of a host's table. Every one is scoped by
 * tenant, and none of them writes: a discount never creates, renames or
 * deletes a category — it only ever asks about one.
 */
export interface DiscountableOps {
  /**
   * Every row of this collection the tenant owns, for the target picker.
   *
   * The whole collection, not a page: a picker that paginated would let an
   * operator save a discount whose existing targets were never on screen, and
   * silently drop them. A host with a catalog too large to hand over caps it
   * and says so in its own surface — which is a host decision, not this
   * package's.
   */
  list(clientId: string): Promise<readonly DiscountTarget[]>;
  /**
   * Whether EVERY id names a live row of this collection owned by `clientId`.
   *
   * This is the cross-tenant guard, and it is the reason the op is not
   * optional. Without it a crafted write could point one store's promotion at
   * another store's catalog, and the reverse menu-badge lookup would then
   * advertise it there.
   */
  ownsAll(clientId: string, ids: readonly string[]): Promise<boolean>;
  /**
   * `child id → parent id` for the whole collection, for the ancestry walk a
   * nesting collection needs (see {@link buildTargetPath}).
   *
   * Separate from {@link list} even though `list` carries `parentId`, because
   * the two are read on different paths: `list` feeds an admin picker once,
   * while this runs on the MONEY path — every cart mutation and every menu
   * page's badge preview — where a host wants two indexed columns rather than
   * the picker's whole payload. A flat collection omits it.
   */
  parents?(clientId: string): Promise<ReadonlyMap<string, string | null>>;
}

/** One host table, declared discountable. */
export interface DiscountableCollection {
  /**
   * Which dimension this collection answers for. Closed at two today; see
   * {@link DISCOUNT_TARGET_TYPES} for what widening it would take.
   */
  targetType: DiscountTargetType;
  /** The picker's URL segment and its `data-testid` stem, e.g. `"categories"`. */
  slug: string;
  /**
   * What an operator calls this collection ("Categorias", "Produtos"). Host
   * vocabulary in the host's language, and therefore host config — the same
   * rule the copy ports follow, answered here rather than in a copy pack
   * because a pack keyed by a host-chosen collection could not be typed.
   */
  label: string;
  /** Whether a target covers the rows filed UNDER it. `parents` must be set. */
  nests?: boolean;
  ops: DiscountableOps;
}

/** The picker's payload for one collection: what it is, and what is in it. */
export interface DiscountTargetGroup {
  targetType: DiscountTargetType;
  slug: string;
  label: string;
  nests: boolean;
  targets: readonly DiscountTarget[];
}

/**
 * Raised when a write names a target that is not this tenant's.
 *
 * Its own class rather than a `DiscountValidationError` so that the sentence
 * stays the host's while the FIELD stays the package's: a form paints
 * `targets`, and `routes.ts` folds this into the same 422 envelope.
 */
export class ForeignTargetError extends Error {
  readonly field = "targets";
  constructor(message: string) {
    super(message);
    this.name = "ForeignTargetError";
  }
}

/** Every id a write points at, per dimension — the top-level pair AND the slots. */
export function targetIdsByType(
  targets: DiscountTargets,
): Readonly<Record<DiscountTargetType, string[]>> {
  const categoryIds = new Set(targets.categoryIds);
  const menuItemIds = new Set(targets.menuItemIds);
  addSlotIds(targets.comboRequirements, categoryIds, menuItemIds);
  return { CATEGORY: [...categoryIds], ITEM: [...menuItemIds] };
}

/**
 * Fold the combo slots' own targets in.
 *
 * A separate function because it is where the gap was: the origin host checked
 * `categoryIds` and `menuItemIds` and nothing else, so a crafted COMBO whose
 * slots named another store's products would have passed — invisibly, because
 * a combo scope drops the top-level pair and carries its targets in the slots.
 * It was never live only because the slots were not yet persisted anywhere.
 */
function addSlotIds(
  requirements: readonly ComboRequirement[],
  categoryIds: Set<string>,
  menuItemIds: Set<string>,
): void {
  for (const requirement of requirements) {
    requirement.categoryIds.forEach((id) => categoryIds.add(id));
    requirement.menuItemIds.forEach((id) => menuItemIds.add(id));
  }
}

/**
 * Refuse a write pointing at a row this tenant does not own, before it reaches
 * the store.
 *
 * ## Why OUTSIDE the store's transaction is enough
 *
 * The origin host ran this check inside the write transaction, which reads as
 * the safer arrangement, and for the leak that matters it makes no difference:
 * a catalog row's tenant never changes, so an id that belongs to this tenant
 * now cannot belong to another one by the time the write lands. The only race
 * left is a target DELETED between the check and the write — whose outcome is a
 * discount pointing at a row that no longer exists, which the evaluator already
 * tolerates (an unmatched target simply covers nothing). Cross-tenant, the
 * thing this exists to stop, is impossible either way.
 *
 * A dimension with no registered collection is NOT checked here, and the store
 * is left to enforce it — see {@link DiscountsApiConfig.collections}.
 */
export async function assertTargetsOwned(
  collections: readonly DiscountableCollection[],
  clientId: string,
  targets: DiscountTargets,
  message: string,
): Promise<void> {
  const byType = targetIdsByType(targets);
  const checks = collections.map(async (collection) => {
    const ids = byType[collection.targetType];
    if (ids.length === 0) return true;
    return collection.ops.ownsAll(clientId, ids);
  });
  const results = await Promise.all(checks);
  if (results.some((owned) => !owned)) throw new ForeignTargetError(message);
}

/** Every registered collection's rows, as the target picker reads them. */
export async function loadTargetGroups(
  collections: readonly DiscountableCollection[],
  clientId: string,
): Promise<readonly DiscountTargetGroup[]> {
  return Promise.all(
    collections.map(async (collection) => ({
      targetType: collection.targetType,
      slug: collection.slug,
      label: collection.label,
      nests: collection.nests ?? false,
      targets: await collection.ops.list(clientId),
    })),
  );
}

/**
 * A row's own id followed by its ancestors, nearest first — the path R3
 * intersects a scoped discount's targets against, so a discount on a top-level
 * category automatically covers items filed under its subcategories.
 *
 * The `seen` set is a cycle guard, and it is not decoration: this runs on the
 * money path, so a pre-existing bad row must cost a truncated path and never an
 * infinite loop inside a checkout.
 *
 * Pure, and exported, because the host builds the cart lines this package then
 * prices — it needs the same walk on its side of the seam, and a second
 * implementation of it is how the two would disagree about what a discount
 * covers.
 */
export function buildTargetPath(
  targetId: string | null,
  parentById: ReadonlyMap<string, string | null>,
): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor = targetId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return path;
}

/**
 * The ancestry walk for one nesting collection, loaded ONCE per evaluation.
 *
 * Returned as a resolver rather than as a map so the caller cannot be tempted
 * to walk the edges by hand and lose the cycle guard. A collection that does
 * not nest — or one whose host declared no `parents` — resolves every id to
 * itself, which is exactly what a flat dimension means.
 */
export async function targetPathResolver(
  collection: DiscountableCollection,
  clientId: string,
): Promise<(targetId: string | null) => string[]> {
  if (!collection.nests || !collection.ops.parents) {
    return (targetId) => (targetId === null ? [] : [targetId]);
  }
  const parents = await collection.ops.parents(clientId);
  return (targetId) => buildTargetPath(targetId, parents);
}

/**
 * Assert a registration set is usable, at construction rather than at the
 * first request that trips over it.
 *
 * Two rules, both of which produce a surface that looks live and quietly does
 * the wrong thing: two collections for one dimension means one of them silently
 * never runs, and a nesting collection with no `parents` op means every target
 * resolves to itself — a discount on a top-level category covering nothing
 * filed beneath it, which reads as a pricing bug and not as a wiring one.
 */
export function assertCollections(collections: readonly DiscountableCollection[]): void {
  const seen = new Set<string>();
  for (const collection of collections) {
    if (!DISCOUNT_TARGET_TYPES.some((type) => type === collection.targetType)) {
      throw new Error(
        `@12-apps/discounts: "${collection.targetType}" is not a discountable dimension — ` +
          `expected one of ${DISCOUNT_TARGET_TYPES.join(", ")}.`,
      );
    }
    if (seen.has(collection.targetType)) {
      throw new Error(
        `@12-apps/discounts: two collections registered for ${collection.targetType} — ` +
          "one of them would never be read.",
      );
    }
    seen.add(collection.targetType);
    if (collection.nests && !collection.ops.parents) {
      throw new Error(
        `@12-apps/discounts: the ${collection.targetType} collection nests but declares no ` +
          "parents op — every target would resolve to itself and a discount on a parent " +
          "would cover nothing filed under it.",
      );
    }
  }
}
