import type { ComboRequirement } from "../engine/types";

import { comboUnits } from "./combo-slot-builder";
import { fill, type DiscountsWebCopy } from "./copy";
import type { DiscountFormValues } from "./discount-form-values";
import { isComboKind, typeAndScopeFor } from "./form-kind";
import type { DiscountsFormatters } from "./format";

/**
 * Everything the create/edit form refuses locally, split from the form itself
 * for the 400-line file gate — comments count toward it, and the container plus
 * these would not fit.
 *
 * Every rule here is ALSO the server's (`../server/validate-combo.ts` and the
 * route's own schema). This half exists to attach the refusal to the input the
 * operator is looking at, never to be the authority: the surface re-validates,
 * and a server refusal comes back through `setFieldErrors` and paints the same
 * inputs red.
 */

/** A whole number above zero, as typed. `null` when it is neither. */
function positiveCount(typed: string): number | null {
  const trimmed = typed.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** A money field that has to hold something above zero. */
function checkMoney(
  typed: string,
  field: string,
  message: string,
  formatters: DiscountsFormatters,
): Record<string, string> {
  const amount = formatters.parseDecimal(typed);
  return amount === null || amount <= 0 ? { [field]: message } : {};
}

/**
 * The free count, which is the one reward bounded by another field.
 *
 * "Take 3, three free" is a giveaway rather than a promotion, so it is compared
 * against what ONE application of the combo takes out of the cart. The ceiling
 * is named in the message: an operator told only "too many" has to guess the
 * number.
 */
function checkFreeUnits(
  typed: string,
  slots: readonly ComboRequirement[],
  copy: DiscountsWebCopy,
): Record<string, string> {
  const free = positiveCount(typed);
  if (free === null) return { freeUnits: copy.form.invalidFreeUnits };
  const units = comboUnits(slots);
  if (free >= units) {
    return {
      freeUnits: fill(copy.form.freeUnitsExceedCombo, { units, max: Math.max(units - 1, 0) }),
    };
  }
  return {};
}

/** The rate, in the 0–100 an operator thinks in rather than basis points. */
function checkPercent(
  typed: string,
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  const percent = formatters.parseDecimal(typed);
  return percent === null || percent <= 0 || percent > 100
    ? { percentOff: copy.form.invalidPercent }
    : {};
}

/**
 * The reward, checked against the input the chosen KIND actually mounted.
 *
 * `type` is derived rather than read: a combo's reward is a percentage or an
 * amount, and which one it is lives in `comboReward` — so the check runs off
 * the same mapping the submit does, and the two cannot disagree about which
 * input holds the number.
 */
function checkValue(
  values: DiscountFormValues,
  slots: readonly ComboRequirement[],
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  const { type } = typeAndScopeFor(values);
  if (type === "FIXED_AMOUNT") {
    return checkMoney(values.amountOff, "amountOff", copy.form.invalidAmount, formatters);
  }
  if (type === "BUNDLE_PRICE") {
    return checkMoney(values.bundlePrice, "bundlePrice", copy.form.invalidBundlePrice, formatters);
  }
  if (type === "FREE_UNITS") return checkFreeUnits(values.freeUnits, slots, copy);
  return checkPercent(values.percentOff, formatters, copy);
}

/**
 * The combo half: the groups themselves, and the per-cart cap.
 *
 * Every rule here is also the server's (`validate-combo.ts`), and deliberately
 * so — this half exists to attach the refusal to the input the operator is
 * looking at, never to be the authority.
 */
function checkCombo(
  values: DiscountFormValues,
  slots: readonly ComboRequirement[],
  copy: DiscountsWebCopy,
): Record<string, string> {
  if (!isComboKind(values.kind)) return {};
  // "Leve 3, pague 2" is one group of products, so it is refused in those words
  // rather than in the multi-group builder's — same stored shape, different
  // sentence, because the operator is looking at a different control.
  const free = values.kind === "FREE_UNITS";
  const empty = free ? copy.form.freeUnitsTargetRequired : copy.form.comboSlotsRequired;
  // The refusal hangs on `kind` rather than on `scope`: a combo kind does not
  // mount a scope toggle, so an error attributed there would paint nothing.
  if (slots.length === 0) return { kind: empty };
  const errors: Record<string, string> = {};
  if (slots.some((slot) => !Number.isInteger(slot.quantity) || slot.quantity <= 0)) {
    errors.kind = copy.form.invalidComboQuantity;
  } else if (
    slots.some((slot) => slot.categoryIds.length === 0 && slot.menuItemIds.length === 0)
  ) {
    errors.kind = free ? copy.form.freeUnitsTargetRequired : copy.form.comboSlotTargetRequired;
  }
  if (values.maxComboApplications.trim() !== "" && positiveCount(values.maxComboApplications) === null) {
    errors.maxComboApplications = copy.form.invalidMaxComboApplications;
  }
  return errors;
}

/** What the pickers and the builder currently hold, in one argument. */
export interface FormTargets {
  categoryIds: string[];
  menuItemIds: string[];
  comboRequirements: ComboRequirement[];
}

/** The cross-field rules a per-input schema cannot express. */
export function validate(
  values: DiscountFormValues,
  targets: FormTargets,
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  const slots = targets.comboRequirements;
  const errors: Record<string, string> = {
    ...checkValue(values, slots, formatters, copy),
    ...checkCombo(values, slots, copy),
  };
  if (values.trigger === "CODE" && values.code.trim() === "") {
    errors.code = copy.form.codeRequired;
  }
  const { scope } = typeAndScopeFor(values);
  if (scope === "CATEGORY" && targets.categoryIds.length === 0) {
    errors.scope = copy.form.categoryTargetRequired;
  }
  if (scope === "ITEM" && targets.menuItemIds.length === 0) {
    errors.scope = copy.form.itemTargetRequired;
  }
  // The window is half-open [start, end): equal dates are an EMPTY window, so
  // the rule is "after", not "not before".
  if (values.startsAt !== "" && values.endsAt !== "" && values.endsAt <= values.startsAt) {
    errors.endsAt = copy.form.endsBeforeStarts;
  }
  return errors;
}

