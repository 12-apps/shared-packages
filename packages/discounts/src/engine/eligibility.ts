import type { DiscountRejectionReason } from "./kinds";
import type { DiscountCartLine, DiscountRule } from "./types";

/**
 * ELIGIBILITY side of the discount evaluator (FUT-245): rules R2 (the screen)
 * and R3 (the covered set) of the numbered rule set documented in
 * `./evaluate.ts`. Pure — no database, no clock, no I/O; `now` arrives inside the
 * context the caller builds, exactly like `composeSelection` takes its live
 * catalog config rather than reading it.
 *
 * R3 is deliberately expressed as a REVERSE index built once per evaluation
 * (`buildLineIndex`) and then read with `Map`/`Set` lookups: matching every
 * target against every line would be the loop-inside-a-loop the quality gate
 * bans, and a whole menu page's badge preview (FUT-246) walks this path.
 */

/**
 * The cart facts R2 screens a rule against. All resolved by the caller.
 *
 * Not exported: callers pass an object literal, and knip fails the build on an
 * export nothing imports (`quality:knip` — "ship the consumer with the export").
 */
interface ScreenContext {
  /** Evaluation instant. Injected — this module never calls `new Date()`. */
  now: Date;
  /**
   * The PRE-discount cart subtotal. Always the untouched subtotal, never a
   * running total: that is what makes the result independent of the order the
   * discounts happen to be applied in.
   */
  subtotalCents: number;
  /** Whether R3's covered set came back non-empty for this rule. */
  hasEligibleItems: boolean;
}

/**
 * Lines of the cart indexed by everything a discount can target, so R3 is a
 * `Map` read per target instead of a scan per line.
 */
export interface LineIndex {
  /** Category id (own or any ancestor) → the lines filed under it. */
  byCategory: ReadonlyMap<string, readonly string[]>;
  /** Menu-item id (base or chosen variation) → the lines carrying it. */
  byMenuItem: ReadonlyMap<string, readonly string[]>;
}

type IndexPair = readonly [key: string, lineId: string];

function groupLineIds(pairs: readonly IndexPair[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [key, lineId] of pairs) {
    const bucket = grouped.get(key);
    if (bucket) bucket.push(lineId);
    else grouped.set(key, [lineId]);
  }
  return grouped;
}

/**
 * A line is reachable by an ITEM-scoped discount through its BASE (grouping)
 * item — the card the admin actually picked — or through the variation the
 * buyer chose, so "50% off Coca" still fires on "Coca zero lata".
 */
function menuItemPairs(line: DiscountCartLine): IndexPair[] {
  return [line.menuItemId, line.variationMenuItemId]
    .filter((id): id is string => id !== null)
    .map((id) => [id, line.lineId] as const);
}

function categoryPairs(line: DiscountCartLine): IndexPair[] {
  return line.categoryPath.map((categoryId) => [categoryId, line.lineId] as const);
}

/** Build the per-evaluation reverse index R3 reads. */
export function buildLineIndex(lines: readonly DiscountCartLine[]): LineIndex {
  return {
    byCategory: groupLineIds(lines.flatMap(categoryPairs)),
    byMenuItem: groupLineIds(lines.flatMap(menuItemPairs)),
  };
}

function addAll(target: Set<string>, lineIds: readonly string[] | undefined): void {
  for (const lineId of lineIds ?? []) target.add(lineId);
}

/**
 * R3 — the covered set: which of the cart's lines this discount is allowed to
 * touch. `ORDER` covers everything; `CATEGORY` covers every line whose category
 * PATH (own category followed by its ancestors) intersects the targets, so a
 * discount on a top-level category automatically reaches items filed under its
 * subcategories; `ITEM` covers every line whose base or variation menu item is
 * targeted.
 */
export function coveredLineIds(
  rule: DiscountRule,
  lines: readonly DiscountCartLine[],
  index: LineIndex,
): ReadonlySet<string> {
  if (rule.scope === "ORDER") return new Set(lines.map((line) => line.lineId));
  const byCategory = rule.scope === "CATEGORY";
  const targets = byCategory ? rule.targetCategoryIds : rule.targetMenuItemIds;
  const bucket = byCategory ? index.byCategory : index.byMenuItem;
  const covered = new Set<string>();
  for (const target of targets) addAll(covered, bucket.get(target));
  return covered;
}

/**
 * The scheduling half of R2: switched off, not started yet, or already over.
 * The window is the HALF-OPEN interval `[startsAt, endsAt)` — `endsAt` is
 * exclusive, so an admin who sets it to midnight of the next day means exactly
 * that and not "one more day".
 */
function screenWindow(rule: DiscountRule, now: Date): DiscountRejectionReason | null {
  if (!rule.active) return "INACTIVE";
  if (rule.startsAt !== null && now.getTime() < rule.startsAt.getTime()) return "NOT_STARTED";
  if (rule.endsAt !== null && now.getTime() >= rule.endsAt.getTime()) return "EXPIRED";
  return null;
}

/**
 * The counting half of R2: the two redemption caps and the minimum-subtotal
 * threshold. `buyerUsageCount` is advisory — it is counted from PAID orders at
 * evaluation time, so two concurrent first-time orders by the same buyer can
 * both pass; the global cap is what the PAID-time predicated UPDATE enforces.
 */
function screenLimits(rule: DiscountRule, ctx: ScreenContext): DiscountRejectionReason | null {
  if (rule.usageLimit !== null && rule.usageCount >= rule.usageLimit) {
    return "USAGE_LIMIT_REACHED";
  }
  if (rule.perBuyerLimit !== null && rule.buyerUsageCount >= rule.perBuyerLimit) {
    return "BUYER_LIMIT_REACHED";
  }
  if (rule.minSubtotalCents !== null && ctx.subtotalCents < rule.minSubtotalCents) {
    return "MIN_SUBTOTAL_NOT_MET";
  }
  return null;
}

/**
 * R2 — the eligibility screen. Returns the FIRST failing predicate's reason, or
 * null when the rule is a live candidate. The order is not arbitrary: it runs
 * from the least to the most cart-specific reason so the message the buyer ends
 * up seeing is the most useful one ("expirado" beats "não vale para os itens do
 * seu carrinho" for a coupon that is both).
 *
 * The coupon-match predicate is NOT here: a CODE-triggered rule the buyer did
 * not type is not a rejection, it is simply not a candidate, and the caller
 * drops it silently.
 */
export function screenRule(
  rule: DiscountRule,
  ctx: ScreenContext,
): DiscountRejectionReason | null {
  const scheduling = screenWindow(rule, ctx.now);
  if (scheduling !== null) return scheduling;
  const limits = screenLimits(rule, ctx);
  if (limits !== null) return limits;
  return ctx.hasEligibleItems ? null : "NO_ELIGIBLE_ITEMS";
}
