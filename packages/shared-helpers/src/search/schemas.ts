import { z } from "zod";

import type { EntitySearchConfig, FilterOperator, ParsedSearchInput, SortParam } from "./types";
import type { SearchConfig } from "./config";

/** Parse a sort string like `"createdAt:desc"` into a {@link SortParam}. */
export function parseSortParam(sortString: string): SortParam {
  const [field, directionRaw] = sortString.split(":");
  if (!field || !directionRaw) {
    throw new Error(`Invalid sort format: "${sortString}". Expected "field:direction"`);
  }
  if (directionRaw !== "asc" && directionRaw !== "desc") {
    throw new Error(`Invalid sort direction: "${directionRaw}". Expected "asc" or "desc"`);
  }
  return { field, direction: directionRaw };
}

/** The query-param key for a filter field + operator (`eq` uses the bare name). */
function buildFilterKey(field: string, operator: FilterOperator): string {
  return operator === "eq" ? field : `${field}_${operator}`;
}

/** The `in` operator: a comma-separated query value → a validated array. */
function inFilterSchema(fieldType: "string" | "number" | "boolean" | "date", allowedValues?: string[]): z.ZodTypeAny {
  if (fieldType === "number") {
    return z
      .string()
      .transform((v) => v.split(",").map(Number))
      .pipe(z.array(z.number()).min(1));
  }
  const arraySchema = z
    .string()
    .transform((v) => v.split(","))
    .pipe(z.array(z.string()).min(1));
  if (!allowedValues) return arraySchema;
  return arraySchema.pipe(
    z.array(z.string()).refine((arr) => arr.every((v) => allowedValues.includes(v)), {
      message: `Each value must be one of: ${allowedValues.join(", ")}`,
    }),
  );
}

/** String scalar operators: nullable `eq` maps `"null"` → null; enums validate. */
function stringFilterSchema(operator: FilterOperator, nullable?: boolean, allowedValues?: string[]): z.ZodTypeAny {
  if (operator === "eq" && nullable) {
    const base = z.string().transform((v): string | null => (v === "null" ? null : v));
    return allowedValues ? base.pipe(z.union([z.null(), z.enum(allowedValues as [string, ...string[]])])) : base;
  }
  if (allowedValues) return z.enum(allowedValues as [string, ...string[]]);
  return z.string();
}

/** Build the Zod schema for one filter field + operator (coercions included). */
function buildFilterSchema(
  fieldType: "string" | "number" | "boolean" | "date",
  operator: FilterOperator,
  nullable?: boolean,
  allowedValues?: string[],
): z.ZodTypeAny {
  if (operator === "in") return inFilterSchema(fieldType, allowedValues);
  if (fieldType === "boolean") {
    return z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).pipe(z.boolean());
  }
  if (fieldType === "date") return z.coerce.date();
  if (fieldType === "number") return z.coerce.number();
  return stringFilterSchema(operator, nullable, allowedValues);
}

/**
 * The per-field filter query keys → their Zod schemas, flattened so
 * `createSearchInput` composes them without a lexically nested field/op loop.
 */
function buildFilterShape(entityConfig: EntitySearchConfig): Record<string, z.ZodTypeAny> {
  const entries = Object.entries(entityConfig.filterableFields).flatMap(([field, fieldDef]) =>
    fieldDef.operators.map((op): [string, z.ZodTypeAny] => [
      buildFilterKey(field, op),
      buildFilterSchema(fieldDef.type, op, fieldDef.nullable, fieldDef.allowedValues).optional(),
    ]),
  );
  return Object.fromEntries(entries);
}

/**
 * Build a Zod input schema from an entity config + global config. The shape is
 * derived from `filterableFields`, so the SAME schema validates the admin
 * page's `searchParams` AND becomes the MCP operation's `query` schema — the
 * filter/sort/pagination params reflect onto the agent surface automatically.
 *
 * Everything stays inside a single `ZodObject` so an OpenAPI generator can
 * walk the properties (`.and(...)`/`.extend(...)` would break that unwrap).
 */
export function createSearchInput<E extends Record<string, z.ZodTypeAny> = Record<string, never>>(
  entityConfig: EntitySearchConfig,
  globalConfig: SearchConfig,
  extraShape?: E,
): z.ZodType<ParsedSearchInput & { [K in keyof E]: z.infer<E[K]> }> {
  const shape: Record<string, z.ZodTypeAny> = { ...extraShape };

  shape.q = z
    .string()
    .max(globalConfig.maxSearchTermLength)
    .optional()
    .transform((v): string | undefined => (v === "" ? undefined : v));
  shape.page = z.coerce.number().int().positive().default(1);
  shape.pageSize = z.coerce.number().int().positive().max(globalConfig.maxPageSize).default(globalConfig.defaultPageSize);

  const defaultSortString = `${entityConfig.defaultSort.field}:${entityConfig.defaultSort.direction}`;
  shape.sort = z.string().default(defaultSortString);

  Object.assign(shape, buildFilterShape(entityConfig));

  const baseSchema = z.object(shape);

  type Output = ParsedSearchInput & { [K in keyof E]: z.infer<E[K]> };

  return baseSchema
    .refine(
      (data) => {
        try {
          const parsed = parseSortParam(String(data.sort));
          return entityConfig.sortableFields.includes(parsed.field);
        } catch {
          return false;
        }
      },
      {
        message: `sort must be "field:direction" where field is one of: ${entityConfig.sortableFields.join(", ")}`,
        path: ["sort"],
      },
    )
    .transform(
      (data): Output =>
        ({
          ...data,
          q: typeof data.q === "string" ? data.q : undefined,
          page: Number(data.page),
          pageSize: Number(data.pageSize),
          sort: parseSortParam(String(data.sort)),
        }) as Output,
    ) as unknown as z.ZodType<Output>;
}

/**
 * Parse admin-list search params RESILIENTLY: a single malformed value (e.g.
 * `?page=oops`) drops only its own key and re-parses, instead of failing the whole
 * object and silently discarding every OTHER valid filter. This keeps a page's
 * server read in step with the URL-driven grid controls — a bad param never makes
 * the server ignore a valid `q`/filter the user can still see. Falls back to all
 * schema defaults only if the cleaned input still won't parse.
 *
 * REST/MCP route handlers keep using strict `.safeParse` (a 400 is the right answer
 * for a programmatic caller); this is for the admin PAGES, which must degrade
 * gracefully rather than 500 or desync.
 */
export function parseSearchParamsResilient<T>(
  schema: z.ZodType<T>,
  raw: Record<string, unknown>,
): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const badKeys = new Set(
    result.error.issues
      .map((issue) => issue.path[0])
      .filter((key): key is string => typeof key === "string"),
  );
  if (badKeys.size > 0) {
    const cleaned = Object.fromEntries(Object.entries(raw).filter(([key]) => !badKeys.has(key)));
    const retry = schema.safeParse(cleaned);
    if (retry.success) return retry.data;
  }
  return schema.parse({});
}

/** Wrap an item schema in the paginated `{ data, pagination }` response shape. */
export function createSearchOutput<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      pageCount: z.number(),
      hasNextPage: z.boolean(),
      hasPreviousPage: z.boolean(),
      /**
       * Present when `total` was inferred from fetched rows (skipTotalCount
       * fast path) instead of counted. Declared explicitly — `z.object` strips
       * unknown keys, so omitting it would drop the flag before REST/MCP consumers.
       */
      approximate: z.boolean().optional(),
    }),
  });
}
