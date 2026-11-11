import type { FormSnapshot } from "./step-summary";

/**
 * Whether the form differs from what it opened with (FUT-4478, Story
 * "Dirty"), and what a server error is attached to.
 *
 * The baseline is every `total-form` string plus the state kept beside it.
 * Two values are read with care:
 * - `freeUnitsTargets` is never compared: FUT-4441's effect writes it when Tipo
 *   leaves Itens grátis, so a Tipo switched away and back would read as dirty;
 *   for the same reason a key missing on one side counts as "".
 * - the schedule's rows count only while "Dias e horários" is on: a rule with no
 *   schedule opens with a blank window, so turning Repetição on and off again
 *   changes nothing that is saved.
 */

const IGNORED_KEYS: ReadonlySet<string> = new Set(["freeUnitsTargets", "schedule"]);

function strings(values: Readonly<Record<string, string>>, keys: readonly string[]): string[] {
  return keys.map((key) => values[key] ?? "");
}

/** One comparable string for the form. */
export function dirtyKey(form: FormSnapshot, keys: readonly string[]): string {
  return JSON.stringify({
    values: strings(form.values, keys),
    active: form.active,
    stackable: form.stackable,
    firstOrderOnly: form.firstOrderOnly,
    categoryIds: form.categoryIds,
    menuItemIds: form.menuItemIds,
    slots: form.slots,
    scheduleEnabled: form.scheduleEnabled,
    schedule: form.scheduleEnabled ? form.schedule : null,
  });
}

/** The string keys both sides are compared on: the union, minus the ignored ones. */
export function comparedKeys(...sides: readonly Readonly<Record<string, string>>[]): string[] {
  const keys = new Set(sides.flatMap((side) => Object.keys(side)));
  return [...keys].filter((key) => !IGNORED_KEYS.has(key)).sort();
}

export function isDirty(baseline: FormSnapshot, now: FormSnapshot): boolean {
  const keys = comparedKeys(baseline.values, now.values);
  return dirtyKey(baseline, keys) !== dirtyKey(now, keys);
}

/**
 * What a server error on `key` is attached to: when this changes, the operator
 * has answered it and it is dropped. A string field is its own value; the keys
 * of the builders and the schedule are the state those edit.
 */
export function stampOf(key: string, form: FormSnapshot): string {
  if (key === "kind" || key === "freeUnitsTargets") return JSON.stringify([form.values.kind, form.slots]);
  if (key === "scope") return JSON.stringify([form.values.scope, form.categoryIds, form.menuItemIds]);
  if (key === "schedule") return JSON.stringify([form.scheduleEnabled, form.schedule]);
  return form.values[key] ?? "";
}
