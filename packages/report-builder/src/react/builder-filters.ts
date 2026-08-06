import type { BuilderDraft, FilterDraft } from "./builder-model";
import type { ReportField } from "./custom-reports-api";

/**
 * The filter row's rules (FUT-391): which operators a field offers, and
 * whether its value is PICKED or typed.
 *
 * The server resolves `ops`/`values` on the catalog and ships them per field;
 * this module only narrows them to what the BUILDER can currently express.
 */

/**
 * Operators the draft can serialize. `specFromDraft` writes a single `value`,
 * so `in` (needs `values[]`) and `between` (needs `from`/`to`) would produce
 * specs the schema rejects — offering them would trade a typo for a 400.
 * Widening this list means widening {@link FilterDraft} first.
 */
const SINGLE_VALUE_OPERATORS = ["eq", "neq", "gte", "lte"] as const;

/** Pre-FUT-391 fallback: a cached field listing carries no `ops`. */
const ALL_OPERATORS: readonly string[] = ["eq", "neq", "gte", "lte"];

/**
 * The operators offered for a field: the server's answer, intersected with
 * what the draft can serialize. Never empty — a field whose every legal
 * operator is multi-value still gets `eq`, so the row stays usable.
 */
export function operatorOptionsFor(field: ReportField | undefined): string[] {
  if (!field) return [...ALL_OPERATORS];
  const declared = field.ops && field.ops.length > 0 ? field.ops : ALL_OPERATORS;
  const usable = declared.filter((operator) =>
    (SINGLE_VALUE_OPERATORS as readonly string[]).includes(operator),
  );
  // Never empty: a field whose every legal operator is multi-value still gets
  // `eq`, so the row stays usable rather than rendering an empty Select.
  return usable.length > 0 ? [...usable] : ["eq"];
}

/** The first offered operator — the fallback when a field or spec changes. */
function firstOperatorFor(field: ReportField | undefined): string {
  return operatorOptionsFor(field)[0] ?? "eq";
}

/** A closed-set field is picked from a list; everything else is typed. */
export function valueOptionsFor(
  field: ReportField | undefined,
): Array<{ value: string; label: string }> | null {
  if (!field?.values || field.values.length === 0) return null;
  return field.values.map((option) => ({ value: option.value, label: option.label }));
}

/**
 * The value a row should carry for a field: its first legal option, or blank
 * when the field is typed. Leaving the PREVIOUS field's value behind is the
 * bug this prevents — `status eq 1500` is valid JSON, compiles, and matches
 * nothing.
 */
export function defaultValueFor(field: ReportField | undefined): string {
  return valueOptionsFor(field)?.[0]?.value ?? "";
}

/**
 * Edit one filter row, keeping it internally consistent: changing the FIELD
 * resets both the operator and the value to that field's first legal pair,
 * because neither is guaranteed to remain meaningful.
 */
export function editFilterRow(
  draft: BuilderDraft,
  index: number,
  patch: Partial<FilterDraft>,
  fields: Map<string, ReportField>,
): FilterDraft[] {
  const next = [...draft.filters];
  const current = next[index];
  if (!current) return next;

  if (patch.field !== undefined && patch.field !== current.field) {
    const field = fields.get(patch.field);
    next[index] = {
      field: patch.field,
      operator: firstOperatorFor(field),
      value: defaultValueFor(field),
    };
    return next;
  }

  const merged = { ...current, ...patch };
  // An operator the field no longer offers cannot be selected through the UI,
  // but a stored spec can carry one; snap it back rather than render a Select
  // whose value matches no option (which renders blank and looks broken).
  const legal = operatorOptionsFor(fields.get(merged.field));
  if (!legal.includes(merged.operator)) merged.operator = firstOperatorFor(fields.get(merged.field));
  next[index] = merged;
  return next;
}
