import { comboSlotAcceptsLine, freshComboPool, matchCombo } from "../engine/combo-match";
import type { ComboRequirement, DiscountCartLine, DiscountRule } from "../engine/types";
import { buildTargetPath } from "../server/collections";

import type { WireTarget, WireTargetGroup } from "./api";
import type { ComboReward } from "./form-kind";

/**
 * "Como fica no carrinho" — what one combo's items sum to and what the buyer
 * pays for them, worked out from the store's own prices while the operator is
 * still typing (FUT-4417).
 *
 * The figures are the ENGINE's, not a second derivation of them: each end of
 * the range is a small synthetic cart — every group filled with its cheapest
 * product, then with its dearest — handed to `matchCombo`, so the rounding of a
 * percentage, the cap of a fixed amount at the group's total and the closed
 * price's "never more than the items" (`applicationReward`,
 * `engine/combo-match.ts`) are the ones the cart will apply.
 *
 * It is ONE application, before the cart-level clamps (R4's remainders and
 * R9's payable floor, `ComboMatch.rewardCents`): a preview of the offer, not
 * of a particular cart.
 *
 * Prices come from the targets endpoint's ITEM rows (`priceRangeCents`, its own
 * price and its variations'); a group that can take no priced product makes
 * the whole preview `null`, because a sum with a missing term is not a figure
 * worth showing.
 */

/** The reward as numbers; a value left blank or invalid is `null`. */
export interface ComboRewardValue {
  type: ComboReward;
  percentOffBp: number | null;
  amountOffCents: number | null;
  bundlePriceCents: number | null;
}

/** One end of the range: the combo filled with the cheapest (or dearest) products. */
export interface ComboPreviewEnd {
  /** What the matched items cost before the reward. */
  groupCents: number;
  /** What the reward takes off them. 0 when the reward's value is not typed yet. */
  savingCents: number;
  /** What the buyer pays for this combo. */
  paysCents: number;
}

export interface ComboPreview {
  /** How many units one combo takes. */
  units: number;
  cheapest: ComboPreviewEnd;
  dearest: ComboPreviewEnd;
  /** Whether the reward has a usable value; without one only the items sum means anything. */
  rewardTyped: boolean;
  /**
   * For a ONE-group combo: the quantity and the product names at each end
   * (as the catalog stores them), for the example line. `null` for several groups.
   */
  single: {
    quantity: number;
    cheapestName: string;
    dearestName: string;
  } | null;
}

interface PricedItem {
  target: WireTarget;
  line: DiscountCartLine;
  minCents: number;
  maxCents: number;
}

/** Every priced ITEM row as the cart line the matcher would see for it. */
function pricedItems(groups: readonly WireTargetGroup[]): PricedItem[] {
  const parents = new Map<string, string | null>(
    groups
      .filter((group) => group.targetType === "CATEGORY")
      .flatMap((group) => group.targets)
      .map((target) => [target.id, target.parentId ?? null] as const),
  );
  return groups
    .filter((group) => group.targetType === "ITEM")
    .flatMap((group) => group.targets)
    .flatMap((target) => {
      const range = target.priceRangeCents;
      if (!range || range.minCents < 0 || range.maxCents < range.minCents) return [];
      const line: DiscountCartLine = {
        lineId: target.id,
        menuItemId: target.id,
        variationMenuItemId: null,
        categoryPath: buildTargetPath(target.categoryId ?? null, parents),
        quantity: 1,
        unitPriceCents: range.minCents,
      };
      return [{ target, line, minCents: range.minCents, maxCents: range.maxCents }];
    });
}

/** The rule the synthetic carts are matched against: this combo, applied once. */
function previewRule(slots: readonly ComboRequirement[], reward: ComboRewardValue): DiscountRule {
  const typed = rewardIsTyped(reward);
  return {
    id: "preview",
    name: "preview",
    // An untyped reward is matched as a zero percentage, which takes nothing
    // off and still sums the group.
    type: typed ? reward.type : "PERCENTAGE",
    percentOffBp: typed ? reward.percentOffBp : 0,
    amountOffCents: reward.amountOffCents,
    bundlePriceCents: reward.bundlePriceCents,
    scope: "COMBO",
    targetCategoryIds: [],
    targetMenuItemIds: [],
    comboRequirements: slots,
    maxComboApplications: 1,
    trigger: "AUTOMATIC",
    code: null,
    active: true,
    startsAt: null,
    endsAt: null,
    minSubtotalCents: null,
    usageLimit: null,
    usageCount: 0,
    perBuyerLimit: null,
    buyerUsageCount: 0,
    stackable: true,
    createdAt: new Date(0),
  };
}

function rewardIsTyped(reward: ComboRewardValue): boolean {
  if (reward.type === "PERCENTAGE") return reward.percentOffBp !== null && reward.percentOffBp > 0;
  if (reward.type === "FIXED_AMOUNT")
    return reward.amountOffCents !== null && reward.amountOffCents > 0;
  return reward.bundlePriceCents !== null && reward.bundlePriceCents > 0;
}

/** One end: each group filled by `pick`'s product, priced at `price`, then matched. */
function endOf(
  slots: readonly ComboRequirement[],
  picks: readonly PricedItem[],
  price: (item: PricedItem) => number,
  rule: DiscountRule,
): ComboPreviewEnd | null {
  const lines = picks.map((item, index) => ({
    ...item.line,
    lineId: `${index}:${item.target.id}`,
    quantity: slots[index]?.quantity ?? 0,
    unitPriceCents: price(item),
  }));
  const match = matchCombo(rule, freshComboPool(lines));
  if (match === null) return null;
  return {
    groupCents: match.groupCents,
    savingCents: match.rewardCents,
    paysCents: match.groupCents - match.rewardCents,
  };
}

/** The cheapest and the dearest product one group can take, or null when it can take none. */
function extremesFor(
  slot: ComboRequirement,
  items: readonly PricedItem[],
): { cheapest: PricedItem; dearest: PricedItem } | null {
  // The matcher's own predicate, asked one group at a time.
  const fits = items.filter((item) => comboSlotAcceptsLine(slot, item.line));
  if (fits.length === 0) return null;
  const cheapest = fits.reduce((best, item) => (item.minCents < best.minCents ? item : best));
  const dearest = fits.reduce((best, item) => (item.maxCents > best.maxCents ? item : best));
  return { cheapest, dearest };
}

export function comboPreviewOf(
  slots: readonly ComboRequirement[],
  groups: readonly WireTargetGroup[],
  reward: ComboRewardValue,
): ComboPreview | null {
  if (
    slots.length === 0 ||
    slots.some((slot) => !Number.isInteger(slot.quantity) || slot.quantity <= 0)
  ) {
    return null;
  }
  const items = pricedItems(groups);
  const extremes = slots.map((slot) => extremesFor(slot, items));
  if (extremes.some((pair) => pair === null)) return null;
  const pairs = extremes as { cheapest: PricedItem; dearest: PricedItem }[];
  const rule = previewRule(slots, reward);
  const cheapest = endOf(
    slots,
    pairs.map((pair) => pair.cheapest),
    (item) => item.minCents,
    rule,
  );
  const dearest = endOf(
    slots,
    pairs.map((pair) => pair.dearest),
    (item) => item.maxCents,
    rule,
  );
  if (cheapest === null || dearest === null) return null;
  const [only] = pairs;
  return {
    units: slots.reduce((total, slot) => total + slot.quantity, 0),
    cheapest,
    dearest,
    rewardTyped: rewardIsTyped(reward),
    single:
      slots.length === 1 && only
        ? {
            quantity: slots[0]?.quantity ?? 0,
            cheapestName: only.cheapest.target.name,
            dearestName: only.dearest.target.name,
          }
        : null,
  };
}
