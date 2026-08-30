import { maxDiscountableCents, rawAmountCents } from "./allocate";
import { buildLineIndex, coveredLineIdsNow, screenRule } from "./eligibility";
import { compareRuleOrder } from "./evaluate-passes";
import type { LocalClock } from "./schedule";
import type { DiscountCartLine, DiscountRule } from "./types";

/**
 * Menu-badge preview (FUT-246): what a single item's price looks like BEFORE
 * there is a cart, so the storefront can strike the old price through on the
 * catalog card. It reuses R2/R3/R5 from the evaluator rather than re-deriving
 * them — one pricing rule, one implementation.
 *
 * A badge is a PROMISE, so this deliberately considers far less than a real
 * evaluation does:
 * - `AUTOMATIC` only — a coupon price the buyer has not typed yet is not this
 *   item's price;
 * - `ORDER` scope is excluded — an order-wide promo is not an item price and
 *   would badge the whole menu;
 * - `COMBO` scope is excluded, for the same reason `minSubtotalCents` is: a
 *   combo price only exists once the OTHER components are in the cart, so
 *   striking a single item's price through with it would advertise a number
 *   this item alone can never reach. What a card CAN honestly say about a combo
 *   is that the item takes part in one, which is `comboOffersForItem` in
 *   `./combo-offer.ts` — a label, not a price;
 * - a `minSubtotalCents` threshold is excluded — a card promising a price that
 *   only materializes above some basket total is a lie;
 * - `stackable` is ignored: this previews ONE item at ONE price, and which
 *   promotions end up combining is a cart-level question (R8) that cannot be
 *   answered from a menu card.
 *
 * The R9 payable floor applies here too: the badged price is capped so it never
 * drops below `MIN_PAYABLE_TOTAL_CENTS`, exactly as the evaluator caps a cart.
 * A card advertising a zero price would be promising a free item the checkout
 * is structurally unable to deliver — the provider rejects a zero charge — so a
 * 100%-off item badges at one cent, and an item already priced at one cent
 * badges nothing at all. Both surfaces read the floor from the same
 * `maxDiscountableCents` in `./allocate.ts`, which is what keeps the card, the
 * product sheet and the cart quoting the same number.
 *
 * `perBuyerLimit` is the ONE place that promise is knowingly weaker, and it is
 * documented here rather than quietly inconsistent. The screen itself DOES
 * honour the cap — `screenRule` rejects `BUYER_LIMIT_REACHED` — but only
 * against the `buyerUsageCount` the caller resolved — and a catalog badge is
 * typically an ANONYMOUS read, where a host has no buyer to count against and
 * passes 0. A buyer who has already exhausted a once-per-buyer promotion
 * therefore still sees its badge.
 *
 * Two alternatives were weighed and rejected:
 *
 * 1. drop every per-buyer-capped rule from the badge, the way
 *    `minSubtotalCents` is dropped. That would hide a first-purchase promotion
 *    from precisely the first-time buyers it exists for — wrong for the
 *    overwhelming majority to protect a minority from a mild disappointment;
 * 2. resolve the buyer on these reads. A product sheet often could, but a
 *    catalog listing is deliberately unauthenticated — and a buyer-aware sheet
 *    over an anonymous card reintroduces the card/sheet price disagreement
 *    FUT-246 was filed about, one screen further in.
 *
 * So the badge stays optimistic and the CART tells the truth: the evaluator
 * screens the same rule against a real `buyerUsageCount` and reports
 * `BUYER_LIMIT_REACHED`, before a single cent is charged.
 *
 * Pure, like the rest of the engine: `now` is injected and the rules arrive
 * pre-loaded once per catalog request, never per product.
 */

export interface ItemDiscountPreviewInput {
  /** The BASE (grouping) menu-item id the card renders. */
  menuItemId: string;
  /** The variation whose price the card shows, when it shows one. */
  variationMenuItemId?: string | null;
  /** The item's own category id followed by its ancestors, nearest first. */
  categoryPath: readonly string[];
  /** The price the card would otherwise show, in integer cents. */
  priceCents: number;
  /** The tenant's live discount rules, loaded once for the whole menu. */
  rules: readonly DiscountRule[];
  /** Evaluation instant. Injected — this module never calls `new Date()`. */
  now: Date;
  /**
   * `now` as the STORE's wall clock (FUT-996), for a rule that only runs on
   * certain days and hours.
   *
   * A badge is a PRICE, and the price a card may promise is the one a shopper
   * adding this item RIGHT NOW would get — so the preview screens the schedule
   * against `now` for both halves: it is the evaluation instant and, for
   * anything added off the back of this card, the commit instant too.
   *
   * Omitted or null → scheduled rules badge as if always running, the same
   * fail-open direction the rest of the schedule takes.
   */
  localNow?: LocalClock | null;
}

/** What a host needs to render the badge: the struck price and its label. */
export interface ItemDiscountPreview {
  /**
   * The price to show, in integer cents. Always strictly below `priceCents` and
   * never below `MIN_PAYABLE_TOTAL_CENTS` — a card may not advertise zero.
   */
  discountedPriceCents: number;
  /**
   * What to name the promotion on the ribbon: the merchant's own discount name,
   * which is already copy they wrote, in their own language. The `-NN%` badge is
   * derived downstream from the two prices, so no money is formatted here.
   */
  promoLabel: string;
}

/** The synthetic one-line cart the preview screens against. */
const PREVIEW_LINE_ID = "preview";

function isBadgeable(rule: DiscountRule): boolean {
  return (
    rule.trigger === "AUTOMATIC" &&
    rule.scope !== "ORDER" &&
    rule.scope !== "COMBO" &&
    rule.minSubtotalCents === null
  );
}

function toPreviewLine(input: ItemDiscountPreviewInput): DiscountCartLine {
  return {
    lineId: PREVIEW_LINE_ID,
    menuItemId: input.menuItemId,
    variationMenuItemId: input.variationMenuItemId ?? null,
    categoryPath: input.categoryPath,
    quantity: 1,
    unitPriceCents: input.priceCents,
    // The shopper is looking at this card NOW, so the instant it would be
    // committed at is `now` — which is what lets one predicate answer both the
    // badge and the cart without the card promising an hour it cannot deliver.
    committedLocal: input.localNow ?? null,
  };
}

/**
 * The best badge for this item: the biggest saving, ties broken by the same
 * canonical rule order the evaluator uses, so the card and the cart never
 * disagree about which of two competing promotions is "the" one.
 *
 * Amounts are capped by R9 BEFORE they are ranked, so the winner is the one that
 * really takes the most off the badged price — the same reason the evaluator's
 * R8 compares post-clamp outcomes. A rule left with nothing to remove falls out
 * on the `> 0` filter and is simply not badged.
 */
function bestBadgeRule(
  input: ItemDiscountPreviewInput,
  line: DiscountCartLine,
): { rule: DiscountRule; amountCents: number } | null {
  const index = buildLineIndex([line]);
  const scored = input.rules
    .filter(isBadgeable)
    .filter((rule) => {
      const { covered, blockedBySchedule } = coveredLineIdsNow(
        rule,
        [line],
        index,
        input.localNow,
      );
      return (
        screenRule(rule, {
          now: input.now,
          subtotalCents: input.priceCents,
          hasEligibleItems: covered.has(PREVIEW_LINE_ID),
          blockedBySchedule,
        }) === null
      );
    })
    .map((rule) => ({
      rule,
      amountCents: Math.min(
        rawAmountCents(rule, input.priceCents),
        maxDiscountableCents(input.priceCents),
      ),
    }))
    .filter((entry) => entry.amountCents > 0);
  scored.sort((a, b) => {
    const byAmount = b.amountCents - a.amountCents;
    return byAmount !== 0 ? byAmount : compareRuleOrder(a.rule, b.rule);
  });
  return scored[0] ?? null;
}

/**
 * The discounted price to badge this menu item with, or null when no automatic
 * item-or-category promotion currently removes a whole cent from it — a
 * "-0%" badge is worse than no badge at all.
 */
export function previewItemDiscount(
  input: ItemDiscountPreviewInput,
): ItemDiscountPreview | null {
  const best = bestBadgeRule(input, toPreviewLine(input));
  if (best === null) return null;
  return {
    discountedPriceCents: input.priceCents - best.amountCents,
    promoLabel: best.rule.name,
  };
}
