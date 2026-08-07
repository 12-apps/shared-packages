import type { FieldDef, FilterOperator } from './types';

/**
 * Which operators a field accepts, and which values it offers (FUT-391).
 *
 * This is the half of the catalog the FILTER row needs. Without it the builder
 * shows every operator against every field and a free-text box for the value,
 * so `status a partir de PAI D` is expressible — it compiles, matches nothing,
 * and renders an empty block that looks like missing data rather than a typo.
 *
 * The compiler is unchanged: these narrow what can be AUTHORED, they are not a
 * second validation layer. A spec that arrives over MCP still passes through
 * `compileReport` and is judged there.
 */

const BY_TYPE: Record<string, readonly FilterOperator[]> = {
  string: ['eq', 'neq', 'in'],
  number: ['eq', 'neq', 'gte', 'lte', 'between'],
  money: ['eq', 'neq', 'gte', 'lte', 'between'],
  date: ['gte', 'lte', 'between'],
  boolean: ['eq', 'neq'],
};

/** Every operator the spec schema accepts — the fallback for an unknown type. */
const ALL: readonly FilterOperator[] = ['eq', 'neq', 'in', 'gte', 'lte', 'between'];

/**
 * A closed set is picked from, never ordered: `gte` on an enum would compare
 * the stored codes alphabetically, which is meaningless even when it runs.
 */
const CLOSED_SET: readonly FilterOperator[] = ['eq', 'neq', 'in'];

/**
 * The operators a field may be filtered by, most specific first: the catalog's
 * own `ops`, then the closed-set rule, then the field type's defaults.
 */
export function operatorsFor(field: FieldDef): readonly FilterOperator[] {
  if (field.ops && field.ops.length > 0) return field.ops;
  if (field.values && field.values.length > 0) return CLOSED_SET;
  return BY_TYPE[field.type] ?? ALL;
}

/**
 * Whether a filter on this field is PICKED from a list rather than typed. The
 * builder branches on this to choose a select over a text input.
 */
export function isClosedSet(field: FieldDef): boolean {
  return Boolean(field.values && field.values.length > 0);
}

/**
 * The value a filter should carry when its field changes. Picking the first
 * legal option matters: leaving the previous field's value behind produces a
 * filter like `status eq 1500`, which is valid JSON, compiles, and matches
 * nothing.
 */
export function defaultValueFor(field: FieldDef): string {
  return field.values?.[0]?.value ?? '';
}

/**
 * Whether an operator takes a list of values (`in`) rather than a single one.
 * `between` takes two and is handled by its own from/to pair.
 */
export function isMultiValue(operator: FilterOperator): boolean {
  return operator === 'in';
}
