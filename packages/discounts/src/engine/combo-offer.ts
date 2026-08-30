import { comboRuleAcceptsLine } from "./combo-match";
import { compareRuleOrder } from "./evaluate-passes";
import { scheduleCovers, type LocalClock } from "./schedule";
import type { DiscountType } from "./kinds";
import type { ComboRequirement, DiscountCartLine, DiscountRule } from "./types";

/**
 * "Which combos is this item part of?" — the menu-card question, answered from
 * the same rules the cart is priced with.
 *
 * `previewItemDiscount` cannot answer it. A badge is a PRICE, and a combo has
 * none until the other components are in the cart, so combos are excluded
 * there. But a card that says nothing at all about a combo is how a merchant's
 * best promotion goes unsold: the buyer has to already know the bundle exists
 * to assemble it.
 *
 * So this returns a LABELLING fact, not a price: these are the live combos a
 * slot of which this item can fill. A host renders "Leve 3, pague 2" or "Faz
 * parte de um combo" from it, in its own words — the merchant's `name` is the
 * only string here, and it is already their copy in their own language.
 *
 * Pure and copy-free, like the rest of the engine. Loaded once for a whole
 * catalog request, never per product.
 *
 * ## What it deliberately does not do
 *
 * - **No cart.** It never says the combo would MATCH — that needs the other
 *   components, and a card cannot see them. `comboRuleAcceptsLine` is the
 *   weaker "a slot would accept this item", which is exactly what a card can
 *   honestly claim.
 * - **No coupon combos.** A `CODE`-triggered combo is not advertised, on the
 *   same reasoning the badge uses: a price the buyer has not unlocked yet is
 *   not this item's price, and a promotion nobody can reach from the card is
 *   noise on it.
 * - **No redemption caps.** `usageLimit` IS honoured (an exhausted combo is
 *   over), but `perBuyerLimit` is not, for the reason `./preview.ts` sets out
 *   at length: a catalog listing is anonymous, so the buyer's count is not
 *   knowable here, and hiding a first-purchase promotion from first-time
 *   buyers is the worse error.
 */

/**
 * One combo an item takes part in, flattened to what a card needs.
 *
 * The reward is carried as the raw columns rather than as a rendered phrase
 * because the phrase is a SENTENCE, and sentences are host config everywhere
 * else in this package. A host reads `type` and the one column that goes with
 * it, and writes its own line.
 */
export interface ComboOffer {
  discountId: string;
  /** The merchant's own name for the promotion — already their copy. */
  name: string;
  type: DiscountType;
  /** Non-null iff `type === "BUNDLE_PRICE"`: what the group costs. */
  bundlePriceCents: number | null;
  /** Non-null iff `type === "FREE_UNITS"`: how many of the group are free. */
  freeUnits: number | null;
  /** Non-null iff `type === "PERCENTAGE"`: basis points off the group. */
  percentOffBp: number | null;
  /** Non-null iff `type === "FIXED_AMOUNT"`: cents off the group. */
  amountOffCents: number | null;
  /** The slots, so a card can say what else the buyer has to add. */
  requirements: readonly ComboRequirement[];
}

export interface ComboOffersInput {
  /** The BASE (grouping) menu-item id the card renders. */
  menuItemId: string;
  /** The variation whose price the card shows, when it shows one. */
  variationMenuItemId?: string | null;
  /** The item's own category id followed by its ancestors, nearest first. */
  categoryPath: readonly string[];
  /** The tenant's live discount rules, loaded once for the whole menu. */
  rules: readonly DiscountRule[];
  /** Evaluation instant. Injected — this module never calls `new Date()`. */
  now: Date;
  /** `now` as the store's wall clock, for a combo that only runs some hours. */
  localNow?: LocalClock | null;
}

/** The synthetic one-unit line a slot is tested against. */
const OFFER_LINE_ID = "offer";

function toOfferLine(input: ComboOffersInput): DiscountCartLine {
  return {
    lineId: OFFER_LINE_ID,
    menuItemId: input.menuItemId,
    variationMenuItemId: input.variationMenuItemId ?? null,
    categoryPath: input.categoryPath,
    quantity: 1,
    // A card asks whether a slot ACCEPTS this item, which no price enters into.
    unitPriceCents: 0,
  };
}

/**
 * Live enough to advertise: switched on, inside its window, and not exhausted.
 *
 * Deliberately NOT `screenRule`: that function's remaining predicates are all
 * cart facts (`minSubtotalCents` against a subtotal, `hasEligibleItems` against
 * a covered set), and a card has no cart to answer them from. Feeding it
 * zeroes would reject every combo carrying a minimum basket, which is precisely
 * the sort a merchant advertises.
 *
 * It DOES honour the weekly schedule (FUT-996), and that is not optional: this
 * predicate is a SECOND implementation of "inside its window", so a schedule
 * taught only to `screenRule` would leave a Tuesday-afternoon combo advertising
 * itself around the clock while the cart refused to price it. The duplication
 * above is deliberate; a duplication that disagrees is not.
 */
function isAdvertisable(
  rule: DiscountRule,
  now: Date,
  localNow: LocalClock | null | undefined,
): boolean {
  if (rule.scope !== "COMBO" || rule.trigger !== "AUTOMATIC" || !rule.active) return false;
  if (rule.startsAt !== null && now.getTime() < rule.startsAt.getTime()) return false;
  if (rule.endsAt !== null && now.getTime() >= rule.endsAt.getTime()) return false;
  if (!scheduleCovers(rule.schedule, localNow)) return false;
  return rule.usageLimit === null || rule.usageCount < rule.usageLimit;
}

function toOffer(rule: DiscountRule): ComboOffer {
  return {
    discountId: rule.id,
    name: rule.name,
    type: rule.type,
    bundlePriceCents: rule.bundlePriceCents ?? null,
    freeUnits: rule.freeUnits ?? null,
    percentOffBp: rule.percentOffBp,
    amountOffCents: rule.amountOffCents,
    requirements: rule.comboRequirements ?? [],
  };
}

/**
 * Every combo the store is currently advertising, in the evaluator's canonical
 * rule order.
 *
 * The STORE-level sibling of {@link comboOffersForItem}: same predicate, no
 * item. A storefront that shows combos as their own shelf — "here are the
 * bundles this shop is running" rather than "this card takes part in one" —
 * needs the list before it has a product in hand, and answering it host-side
 * means a second copy of "live enough to advertise" that drifts from this one
 * the first time a rule gains a way to be over.
 *
 * It says nothing about whether the store can still SELL them: a combo whose
 * group has no orderable product left is a question about the host's catalog,
 * which this package cannot see. The caller resolves the groups and drops what
 * it cannot fill.
 */
export function advertisableCombos(
  rules: readonly DiscountRule[],
  now: Date,
  localNow?: LocalClock | null,
): readonly ComboOffer[] {
  return rules
    .filter((rule) => isAdvertisable(rule, now, localNow))
    .sort(compareRuleOrder)
    .map(toOffer);
}

/**
 * Every live combo one of whose slots this item can fill, in the evaluator's
 * canonical rule order so a card and a cart never disagree about which combo
 * comes first. Empty when the item is in none — the common case, and the one a
 * caller should render as nothing at all.
 */
export function comboOffersForItem(input: ComboOffersInput): readonly ComboOffer[] {
  const line = toOfferLine(input);
  return input.rules
    .filter(
      (rule) =>
        isAdvertisable(rule, input.now, input.localNow) && comboRuleAcceptsLine(rule, line),
    )
    .sort(compareRuleOrder)
    .map(toOffer);
}
