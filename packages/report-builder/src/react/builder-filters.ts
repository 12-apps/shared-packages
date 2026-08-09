import type { BuilderDraft, FilterDraft } from "./builder-model";
import type { ReportField, ReportSpecWire } from "./custom-reports-api";

/**
 * The filter row's rules (FUT-391): which operators a field offers, whether its
 * value is PICKED or typed, and how one row maps onto the wire filter the spec
 * schema validates.
 *
 * The server resolves `ops`/`values` on the catalog and ships them per field;
 * this module only narrows them to what the BUILDER can express.
 */

type FilterWire = ReportSpecWire["filters"][number];
type WireValue = string | number | boolean;
type FilterHead = Pick<FilterWire, "field" | "operator">;
type Coerce = (raw: string) => WireValue;

/** How a row's value is entered: one control, a set, or a from/to pair. */
type ValueShape = "single" | "list" | "range";

/**
 * Operators the draft can serialize — the spec's FULL set (`spec.ts:32`).
 *
 * This used to be the four single-value ones, because `specFromDraft` wrote a
 * single `value`: `in` (needs `values[]`) and `between` (needs `from`/`to`)
 * would have produced specs the schema rejects, so offering them traded a typo
 * for a 400. {@link FilterDraft} now carries all three shapes and
 * {@link filterToWire} emits the arity each operator demands, so the narrowing
 * has nothing left to protect.
 */
const DRAFT_OPERATORS: readonly string[] = ["eq", "neq", "in", "gte", "lte", "between"];

/**
 * Pre-FUT-391 fallback: a cached field listing carries no `ops`.
 *
 * Deliberately NOT the full set. Without the server's answer the field's TYPE
 * is unknown, and `compileReport` rejects a range operator on anything but
 * number/money/date — so offering `in`/`between` blind would put back exactly
 * the 400 this file exists to prevent. A catalog that answers `ops` reaches
 * them through {@link DRAFT_OPERATORS} instead.
 */
const ALL_OPERATORS: readonly string[] = ["eq", "neq", "gte", "lte"];

/**
 * The operators offered for a field: the server's answer, intersected with
 * what the draft can serialize. Never empty — a field whose every legal
 * operator is unknown here (`contains`, still absent spec-side) still gets
 * `eq`, so the row stays usable.
 */
export function operatorOptionsFor(field: ReportField | undefined): string[] {
  if (!field) return [...ALL_OPERATORS];
  const declared = field.ops && field.ops.length > 0 ? field.ops : ALL_OPERATORS;
  const usable = declared.filter((operator) => DRAFT_OPERATORS.includes(operator));
  // Never empty: a field the builder cannot express an operator for at all
  // still gets `eq`, so the row renders a usable Select rather than an empty one.
  return usable.length > 0 ? [...usable] : ["eq"];
}

/** The first offered operator — the fallback when a field or spec changes. */
function firstOperatorFor(field: ReportField | undefined): string {
  return operatorOptionsFor(field)[0] ?? "eq";
}

/**
 * The value shape an operator demands, which is also the shape the ROW takes:
 * `in` picks a set and `between` a pair of bounds, and neither fits beside the
 * operator select inside a 344px panel — so both drop to a line of their own.
 */
export function valueShapeFor(operator: string): ValueShape {
  if (operator === "in") return "list";
  if (operator === "between") return "range";
  return "single";
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
 * A row re-shaped for its operator, carrying across what still means the same
 * thing: `status igual a Pago` → `status é um de [Pago]`, and back again.
 *
 * Blanking instead would clear the control the author had just filled — and
 * with the preview re-running on every keystroke, flash an UNFILTERED block
 * between two perfectly complete states. It also guarantees a row never holds
 * two shapes at once, so a `values[]` left over from `in` cannot ride along
 * into the `eq` spec that replaced it.
 */
/** The one value a row reduces to, whatever shape it is currently holding. */
function singleValueOf(row: FilterDraft): string {
  if (row.value !== "") return row.value;
  return row.values?.[0] ?? row.from ?? "";
}

function reshapeForOperator(row: FilterDraft): FilterDraft {
  const { field, operator } = row;
  const single = singleValueOf(row);
  switch (valueShapeFor(operator)) {
    case "list":
      return {
        field,
        operator,
        value: "",
        values: row.values ?? (single === "" ? [] : [single]),
      };
    case "range":
      return { field, operator, value: "", from: row.from ?? single, to: row.to ?? "" };
    default:
      return { field, operator, value: single };
  }
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
    next[index] = reshapeForOperator({
      field: patch.field,
      operator: firstOperatorFor(field),
      value: defaultValueFor(field),
    });
    return next;
  }

  const merged = { ...current, ...patch };
  // An operator the field no longer offers cannot be selected through the UI,
  // but a stored spec can carry one; snap it back rather than render a Select
  // whose value matches no option (which renders blank and looks broken). The
  // reshape runs AFTER the snap, so the row's shape always matches the
  // operator it actually ended up with.
  const legal = operatorOptionsFor(fields.get(merged.field));
  if (!legal.includes(merged.operator)) merged.operator = firstOperatorFor(fields.get(merged.field));
  next[index] = reshapeForOperator(merged);
  return next;
}

/**
 * A typed filter value: a number field compares as a number, a boolean as a
 * boolean. `total gte "1500"` compiles and compares a money column against a
 * string.
 */
function coerceFilterValue(field: ReportField | undefined, raw: string): WireValue {
  const trimmed = raw.trim();
  if (field && (field.type === "number" || field.type === "money")) {
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? trimmed : parsed;
  }
  if (field?.type === "boolean") return trimmed === "true";
  return trimmed;
}

/** `in` — a non-empty picked set, or nothing. */
function listWire(head: FilterHead, filter: FilterDraft, coerce: Coerce): FilterWire[] {
  const values = (filter.values ?? []).filter((entry) => entry.trim() !== "");
  return values.length > 0 ? [{ ...head, values: values.map(coerce) }] : [];
}

/** `between` — BOTH bounds, or nothing: one bound alone is the schema's 400. */
function rangeWire(head: FilterHead, filter: FilterDraft, coerce: Coerce): FilterWire[] {
  const from = filter.from?.trim() ?? "";
  const to = filter.to?.trim() ?? "";
  if (from === "" || to === "") return [];
  return [{ ...head, from: coerce(from), to: coerce(to) }];
}

/**
 * One draft row as the wire filter `reportFilterSchema` validates — or NOTHING
 * while the row is still incomplete, which a half-filled `between` is. Emitting
 * it anyway is the 400 the old single-value narrowing avoided by refusing to
 * offer the operator at all; dropping it keeps the preview runnable mid-edit.
 */
export function filterToWire(
  filter: FilterDraft,
  field: ReportField | undefined,
): FilterWire[] {
  if (filter.field === "") return [];
  const head: FilterHead = { field: filter.field, operator: filter.operator };
  const coerce: Coerce = (raw) => coerceFilterValue(field, raw);
  const shape = valueShapeFor(filter.operator);
  if (shape === "list") return listWire(head, filter, coerce);
  if (shape === "range") return rangeWire(head, filter, coerce);
  return filter.value.trim() === "" ? [] : [{ ...head, value: coerce(filter.value) }];
}

/** A stored wire value as the draft's editable text. */
function draftText(value: WireValue | undefined): string {
  return value === undefined ? "" : String(value);
}

/**
 * One stored wire filter as an editable row.
 *
 * Dropped only when it carries nothing for its operator. This used to drop
 * every filter without a `value`, which meant an `in` or `between` authored
 * over MCP VANISHED on opening the report in the builder — and a re-save then
 * published the spec without it.
 */
export function filterFromWire(filter: FilterWire): FilterDraft[] {
  const head: FilterHead = { field: filter.field, operator: filter.operator };
  const shape = valueShapeFor(filter.operator);
  if (shape === "list") {
    return filter.values ? [{ ...head, value: "", values: filter.values.map(draftText) }] : [];
  }
  if (shape === "range") {
    if (filter.from === undefined || filter.to === undefined) return [];
    return [{ ...head, value: "", from: draftText(filter.from), to: draftText(filter.to) }];
  }
  return filter.value === undefined ? [] : [{ ...head, value: draftText(filter.value) }];
}

/**
 * MUI hands a multi-select's value back as `unknown`. Narrowing here rather
 * than casting at the call site keeps the component free of assertions.
 */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return value === undefined || value === null || value === "" ? [] : [String(value)];
}

/**
 * What a multi-picker DISPLAYS: the LABELS of the picked values, never their
 * codes. Left to itself MUI joins the raw `PAID, FAILED` — the very thing the
 * closed-set picker exists to keep off the screen.
 */
export function pickedLabels(
  selected: unknown,
  options: Array<{ value: string; label: string }>,
): string {
  return toStringList(selected)
    .map((value) => options.find((option) => option.value === value)?.label ?? value)
    .join(", ");
}

/**
 * An open field's `in` list, typed as one comma-separated line — a field with
 * no closed set has nothing to pick FROM, so this is the only way to express
 * `in` on it.
 *
 * Deliberately neither trimmed nor compacted: `split(",")` and `join(",")` are
 * exact inverses, so a half-typed `PAID,` survives the controlled round trip
 * instead of losing the comma the author just pressed and jumping the caret.
 * {@link filterToWire} does the trimming, once, at serialization.
 */
export function splitValueList(raw: string): string[] {
  return raw.split(",");
}

/** The inverse of {@link splitValueList} — the list as one editable line. */
export function joinValueList(values: readonly string[]): string {
  return values.join(",");
}
