import {
  COMBO_ONLY_DISCOUNT_TYPES,
  MAX_COMBO_SLOTS,
  MAX_COMBO_SLOT_QUANTITY,
} from "../engine/kinds";
import type { ComboRequirement } from "../engine/types";
import type { DiscountsServerCopy } from "./copy";
import { DiscountValidationError, type DiscountWriteInput } from "./validate";

/**
 * The write-time rule set for the COMBO half of a discount (FUT-268).
 *
 * Split from `./validate.ts` for the 400-line file gate, and read as part of
 * it: the same doctrine applies unchanged. Every rule here has a twin as a
 * database CHECK where SQL can express it, this layer exists so the operator
 * gets a sentence naming the FIELD, and the sentences themselves live in
 * {@link DiscountsServerCopy} rather than here.
 *
 * Two of these rules have no SQL twin at all, for the same reason the "at least
 * one target" rule does not: they count rows in another table. A CHECK cannot
 * see whether a combo has any slots, nor add their quantities up to compare the
 * total against `free_units`. This module is their only enforcement point, and
 * both failures are silent ones — a combo with no slots never fires, and a
 * combo giving away as many units as it requires charges the buyer nothing for
 * a group the merchant meant to sell.
 */

function invalid(field: string, message: string): DiscountValidationError {
  return new DiscountValidationError(field, message);
}

/** The combo columns of a discount row, validated and narrowed to the type. */
export interface ComboColumns {
  bundlePriceCents: number | null;
  freeUnits: number | null;
  maxComboApplications: number | null;
}

function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0;
}

/**
 * A combo reward only means something against a matched group, so the two
 * types that express one are legal at exactly one scope. Checked BEFORE the
 * value columns, so an operator who picked "bundle price" on an order-wide
 * discount is told the real mistake rather than being asked for a price the
 * discount could never use.
 */
function assertComboScope(input: DiscountWriteInput, copy: DiscountsServerCopy): void {
  const isComboReward = COMBO_ONLY_DISCOUNT_TYPES.some((type) => type === input.type);
  if (isComboReward && input.scope !== "COMBO") {
    throw invalid("scope", copy.comboScopeRequired);
  }
}

/** The slot list itself: present, and small enough to be a describable offer. */
function assertSlotCount(requirements: readonly ComboRequirement[], copy: DiscountsServerCopy): void {
  if (requirements.length === 0 || requirements.length > MAX_COMBO_SLOTS) {
    throw invalid("comboRequirements", copy.invalidComboSlots);
  }
}

/**
 * One slot. A slot naming neither an item nor a category can never be filled,
 * so the combo would exist, look live in the list, and never fire — the same
 * failure `assertTargets` exists to refuse one level up.
 */
function assertSlot(requirement: ComboRequirement, copy: DiscountsServerCopy): void {
  const quantity = requirement.quantity;
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_COMBO_SLOT_QUANTITY) {
    throw invalid("comboRequirements", copy.invalidComboQuantity);
  }
  if (requirement.menuItemIds.length === 0 && requirement.categoryIds.length === 0) {
    throw invalid("comboRequirements", copy.comboTargetRequired);
  }
}

/** How many units ONE application of this combo takes out of the cart. */
function unitsPerApplication(requirements: readonly ComboRequirement[]): number {
  return requirements.reduce((total, requirement) => total + requirement.quantity, 0);
}

/**
 * The `FREE_UNITS` count, which is the one number in a combo that is bounded by
 * another: "take 3, one free" is a promotion, "take 3, three free" is a
 * giveaway the merchant almost certainly did not mean and that the payable
 * floor would then have to rescue at checkout.
 */
function assertFreeUnits(input: DiscountWriteInput, copy: DiscountsServerCopy): number {
  const freeUnits = input.freeUnits;
  if (!isPositiveInteger(freeUnits)) throw invalid("freeUnits", copy.invalidFreeUnits);
  if (freeUnits >= unitsPerApplication(input.comboRequirements)) {
    throw invalid("freeUnits", copy.freeUnitsExceedCombo);
  }
  return freeUnits;
}

function assertBundlePrice(input: DiscountWriteInput, copy: DiscountsServerCopy): number {
  if (!isPositiveInteger(input.bundlePriceCents)) {
    throw invalid("bundlePrice", copy.invalidBundlePrice);
  }
  return input.bundlePriceCents;
}

/**
 * The slots and the application cap — everything that describes the combo
 * rather than its reward. Only runs at `COMBO` scope: at every other scope the
 * fields are ignored on the way in and dropped on the way out
 * ({@link comboRequirementsForScope}), exactly as `ORDER` drops its targets.
 */
function assertComboSpec(input: DiscountWriteInput, copy: DiscountsServerCopy): void {
  assertSlotCount(input.comboRequirements, copy);
  for (const requirement of input.comboRequirements) assertSlot(requirement, copy);
  const cap = input.maxComboApplications;
  if (cap !== null && !isPositiveInteger(cap)) {
    throw invalid("maxComboApplications", copy.invalidMaxComboApplications);
  }
}

/**
 * Validate the combo half of one write and fold it into its columns.
 *
 * The unused reward column is forced to NULL rather than passed through, for
 * the reason the scalar folder gives at length: a `BUNDLE_PRICE` combo that
 * kept a leftover `freeUnits` from the form's other branch would violate the
 * "exactly one value column" constraint at the database, and the operator would
 * see a 500 for a form they filled in correctly.
 */
export function toComboColumns(
  input: DiscountWriteInput,
  copy: DiscountsServerCopy,
): ComboColumns {
  assertComboScope(input, copy);
  if (input.scope !== "COMBO") {
    return { bundlePriceCents: null, freeUnits: null, maxComboApplications: null };
  }
  assertComboSpec(input, copy);
  return {
    bundlePriceCents: input.type === "BUNDLE_PRICE" ? assertBundlePrice(input, copy) : null,
    freeUnits: input.type === "FREE_UNITS" ? assertFreeUnits(input, copy) : null,
    maxComboApplications: input.maxComboApplications,
  };
}

/**
 * The slots this scope actually stores, de-duplicated within each slot.
 *
 * Dropping them at every other scope (instead of trusting the caller) is what
 * keeps a scope change from leaving orphan slot rows that would quietly turn
 * the discount back into a combo if the scope were ever flipped back — the same
 * argument `targetsForScope` makes about its two id arrays.
 */
export function comboRequirementsForScope(input: DiscountWriteInput): ComboRequirement[] {
  if (input.scope !== "COMBO") return [];
  return input.comboRequirements.map((requirement) => ({
    menuItemIds: [...new Set(requirement.menuItemIds)],
    categoryIds: [...new Set(requirement.categoryIds)],
    quantity: requirement.quantity,
  }));
}
