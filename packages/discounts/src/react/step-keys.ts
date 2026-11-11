import type { ComboRequirement } from "../engine/types";

import { fill, type CompleteDiscountsWebCopy } from "./copy";

/**
 * The per-step view over `validate()` (FUT-4477, Story "Validation").
 *
 * `validate()` is untouched: it returns one map of field key → message, and
 * this module only says which of the four steps each key belongs to, what the
 * "Falta: …" line calls it, and how the pendências read. The same table routes
 * the server's `fieldErrors`, so a refusal the server attributes lands on the
 * step the operator fills that field in.
 */

export type StepNumber = 1 | 2 | 3 | 4;
export const STEPS: readonly StepNumber[] = [1, 2, 3, 4];

/**
 * Every key `validate()` can return, and the step that owns it. `kind` is the
 * Tipo field's key, but its messages come from the group builders, so it is
 * step 2's.
 */
export const STEP_OF_KEY: Readonly<Record<string, StepNumber>> = {
  name: 1,
  kind: 2,
  freeUnitsTargets: 2,
  freeUnits: 2,
  scope: 2,
  percentOff: 3,
  amountOff: 3,
  bundlePrice: 3,
  maxComboApplications: 3,
  code: 4,
  startsAt: 4,
  endsAt: 4,
  schedule: 4,
  usageLimit: 4,
  perBuyerLimit: 4,
};

/** The step a key belongs to; null for a key the table does not list (shown in the alert only). */
export function stepOfKey(key: string): StepNumber | null {
  return Object.prototype.hasOwnProperty.call(STEP_OF_KEY, key) ? (STEP_OF_KEY[key] ?? null) : null;
}

interface StepError {
  key: string;
  message: string;
}

/**
 * Step n's errors, in table order, identical messages kept once: an Itens
 * grátis rule with no product sets `kind` AND `freeUnitsTargets` to the same
 * sentence, and it must be said once.
 */
export function errorsOfStep(errors: Readonly<Record<string, string | undefined>>, step: StepNumber): StepError[] {
  const seen = new Set<string>();
  const out: StepError[] = [];
  for (const key of Object.keys(STEP_OF_KEY)) {
    const message = errors[key];
    if (STEP_OF_KEY[key] !== step || message === undefined || message === "" || seen.has(message)) continue;
    seen.add(message);
    out.push({ key, message });
  }
  return out;
}

/** The keys whose short name depends on the message, because they carry several. */
function kindShortName(message: string, copy: CompleteDiscountsWebCopy): string {
  const { form } = copy;
  const { short } = copy.steps;
  if (message === form.comboSlotsRequired) return short.oneGroup;
  if (message === form.invalidComboQuantity) return short.quantity;
  if (message === form.freeUnitsTargetRequired) return short.products;
  return short.groupTargets;
}

const SHORT_BY_KEY: Readonly<Record<string, keyof CompleteDiscountsWebCopy["steps"]["short"]>> = {
  name: "name",
  freeUnitsTargets: "products",
  freeUnits: "freeUnits",
  scope: "scope",
  percentOff: "value",
  amountOff: "value",
  bundlePrice: "value",
  maxComboApplications: "comboCap",
  code: "code",
  startsAt: "startsAt",
  endsAt: "endsAt",
  usageLimit: "usageLimit",
  perBuyerLimit: "perBuyerLimit",
};

/** What a "Falta" line calls one error. */
export function shortNameOf(error: StepError, copy: CompleteDiscountsWebCopy): string {
  const { short } = copy.steps;
  if (error.key === "kind") return kindShortName(error.message, copy);
  if (error.key === "schedule") {
    return error.message === copy.schedule.windowsRequired ? short.oneWindow : short.schedule;
  }
  const name = SHORT_BY_KEY[error.key];
  return name === undefined ? error.key : short[name];
}

/** "Falta: nome · o valor", or "" when the step has nothing missing. */
export function missingLine(errors: readonly StepError[], copy: CompleteDiscountsWebCopy): string {
  if (errors.length === 0) return "";
  const names = [...new Set(errors.map((error) => shortNameOf(error, copy)))];
  return fill(copy.steps.missing, { names: names.join(copy.steps.missingSeparator) });
}

export interface Pendencia {
  step: StepNumber;
  key: string;
  where: string;
  text: string;
}

const WHERE: Readonly<Record<StepNumber, keyof CompleteDiscountsWebCopy["steps"]["chrome"]["where"]>> = {
  1: "identity",
  2: "targets",
  3: "price",
  4: "rules",
};

/** One entry per empty group, from the same predicate as the group's own message. */
function groupEntries(slots: readonly ComboRequirement[], copy: CompleteDiscountsWebCopy): string[] {
  return slots.flatMap((slot, index) =>
    slot.categoryIds.length === 0 && slot.menuItemIds.length === 0
      ? [fill(copy.steps.chrome.groupIssue, { position: index + 1, message: copy.form.comboSlotTargetRequired })]
      : [],
  );
}

/**
 * The pendências: every current error of a counted step, by step. A combo's
 * "a group is empty" is said per group ("Grupo 2: …"), as the rows say it.
 */
export function pendencias(
  errors: Readonly<Record<string, string | undefined>>,
  counted: (step: StepNumber) => boolean,
  slots: readonly ComboRequirement[],
  copy: CompleteDiscountsWebCopy,
): Pendencia[] {
  return STEPS.filter(counted).flatMap((step) => {
    const where = copy.steps.chrome.where[WHERE[step]];
    return errorsOfStep(errors, step).flatMap((error) => {
      if (error.key === "kind" && error.message === copy.form.comboSlotTargetRequired) {
        return groupEntries(slots, copy).map((text) => ({ step, key: error.key, where, text }));
      }
      return [{ step, key: error.key, where, text: error.message }];
    });
  });
}
