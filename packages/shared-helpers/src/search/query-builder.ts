import type { EntitySearchConfig, FilterOperator, OrderBy, ParsedSearchInput } from "./types";

export interface PrismaSearchArgs {
  where?: Record<string, unknown>;
  /**
   * Flat (`{ field: dir }`) by default, or whatever `orderByFor` returns — a
   * nested relation key, or an ARRAY of keys when the sort needs a tiebreak.
   */
  orderBy: OrderBy;
  skip: number;
  take: number;
}

/**
 * Build the Prisma `where` from parsed search input: a `q` term becomes an OR
 * across `searchableFields`, and each structured filter key (`field` or
 * `field_op`) becomes its operator condition. Multiple conditions AND together.
 */
/**
 * The structured-filter conditions for one field: each declared operator whose
 * query key is present becomes a condition. Extracted so `buildWhereClause`
 * iterates fields without a lexically nested operator loop.
 */
function fieldConditions(
  field: string,
  fieldDef: EntitySearchConfig["filterableFields"][string],
  input: ParsedSearchInput,
): Record<string, unknown>[] {
  return fieldDef.operators.flatMap((op) => {
    const key = op === "eq" ? field : `${field}_${op}`;
    const value = input[key];
    return value === undefined ? [] : [buildFilterCondition(field, op, value)];
  });
}

export function buildWhereClause(
  input: ParsedSearchInput,
  entityConfig: EntitySearchConfig,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];

  if (input.q && entityConfig.searchableFields.length > 0) {
    const match =
      entityConfig.searchMode === "insensitive"
        ? { contains: input.q, mode: "insensitive" as const }
        : { contains: input.q };
    const orConditions = entityConfig.searchableFields.map((field) => ({ [field]: match }));
    conditions.push({ OR: orConditions });
  }

  for (const [field, fieldDef] of Object.entries(entityConfig.filterableFields)) {
    conditions.push(...fieldConditions(field, fieldDef, input));
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}

function buildFilterCondition(field: string, operator: FilterOperator, value: unknown): Record<string, unknown> {
  switch (operator) {
    case "eq":
      return { [field]: value };
    case "neq":
      return { [field]: { not: value } };
    case "contains":
      return { [field]: { contains: value } };
    case "gte":
      return { [field]: { gte: value } };
    case "lte":
      return { [field]: { lte: value } };
    case "in":
      return { [field]: { in: value } };
  }
}

/** Build the full Prisma args (`where`/`orderBy`/`skip`/`take`) from parsed input. */
export function buildPrismaArgs(input: ParsedSearchInput, entityConfig: EntitySearchConfig): PrismaSearchArgs {
  const where = buildWhereClause(input, entityConfig);
  const orderBy = entityConfig.orderByFor
    ? entityConfig.orderByFor(input.sort)
    : { [input.sort.field]: input.sort.direction };
  const skip = (input.page - 1) * input.pageSize;
  const take = input.pageSize;

  return { where, orderBy, skip, take };
}
