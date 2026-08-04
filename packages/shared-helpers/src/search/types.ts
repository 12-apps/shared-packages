/**
 * Backend list/search engine — framework-agnostic types.
 *
 * Ported from the tabwoah `lib/search` reference, trimmed to the LIKE path
 * (no FTS5 — PGlite has no full-text index, so matching is `contains`/`in`
 * over declared fields). This is the single reusable contract every admin
 * list repository goes through so filtering, sorting, and pagination always
 * happen at the database, never in the browser.
 */

export type FilterOperator = "eq" | "neq" | "contains" | "gte" | "lte" | "in";

/** One filterable column: its scalar type and the operators the API accepts. */
export interface FilterFieldDef {
  type: "string" | "number" | "boolean" | "date";
  operators: FilterOperator[];
  /** When true, `eq` accepts the literal `"null"` and maps it to SQL NULL. */
  nullable?: boolean;
  /** Restricts string `eq`/`in` values to this allow-list (rejected otherwise). */
  allowedValues?: string[];
}

export interface SortParam {
  field: string;
  direction: "asc" | "desc";
}

/**
 * The per-entity search contract: which columns are searchable (the `q` box),
 * filterable (structured pills/ranges), and sortable, plus the default sort.
 * Validated by {@link defineSearchConfig} at module load.
 */
export interface EntitySearchConfig {
  searchableFields: string[];
  filterableFields: Record<string, FilterFieldDef>;
  sortableFields: string[];
  defaultSort: SortParam;
  /**
   * How the `q` term matches `searchableFields`. `"insensitive"` emits Prisma's
   * `{ contains, mode: "insensitive" }` (case-insensitive, Postgres/PGlite ILIKE)
   * — the right default for a user-facing search box. Omitted / `"default"`
   * keeps a plain case-sensitive `contains`.
   */
  searchMode?: "default" | "insensitive";
  /**
   * Optional override to translate a validated sort into a Prisma `orderBy`.
   * The default is the flat `{ [sort.field]: sort.direction }`; supply this only
   * when a sortable field maps to a RELATION (e.g. stock → `{ inventory:
   * { quantity } }`, category → `{ category: { name } }`) that the flat form
   * can't express. `sortableFields` still gates which fields are accepted.
   */
  orderByFor?: (sort: SortParam) => Record<string, unknown>;
}

/**
 * The minimal Prisma model delegate the executor needs — kept structural so
 * the engine never imports `@prisma/client` and works against any delegate
 * (real client, PGlite adapter, or a test double).
 */
export interface SearchableModel {
  findMany(args?: {
    where?: Record<string, unknown>;
    // Flat (`{ field: dir }`) or a nested relation orderBy (`orderByFor`).
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<unknown[]>;

  count(args?: { where?: Record<string, unknown> }): Promise<number>;
}

export interface PaginationMeta {
  /** Total matched rows. Exact by default; check `approximate` before trusting. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  /**
   * True when `total` was inferred from fetched rows (the `skipTotalCount`
   * fast path) instead of counted. Consumers computing page-math off `total`
   * (jump-to-last-page) must fall back to `hasNextPage`/`hasPreviousPage`.
   */
  approximate?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Parsed, validated request input. Produced by `createSearchInput(...).parse`;
 * the open index signature carries the per-field filter keys (e.g. `name_contains`).
 */
export interface ParsedSearchInput {
  q?: string;
  page: number;
  pageSize: number;
  sort: SortParam;
  [key: string]: unknown;
}

/** Reject an operator that is incompatible with its field's scalar type. */
function assertOperatorTypeCompatible(fieldName: string, fieldDef: FilterFieldDef, op: FilterOperator): void {
  if (op === "contains" && fieldDef.type !== "string") {
    throw new Error(`"contains" operator is only valid on string fields, but "${fieldName}" is type "${fieldDef.type}"`);
  }
  if ((op === "gte" || op === "lte") && fieldDef.type !== "number" && fieldDef.type !== "date") {
    throw new Error(`"${op}" operator is only valid on number or date fields, but "${fieldName}" is type "${fieldDef.type}"`);
  }
}

/** Validate every operator declared on one filterable field. */
function validateFilterField(fieldName: string, fieldDef: FilterFieldDef): void {
  fieldDef.operators.forEach((op) => assertOperatorTypeCompatible(fieldName, fieldDef, op));
}

/**
 * Validate an entity search config at module load time — surfaces
 * operator/type mismatches and a default-sort outside `sortableFields`
 * immediately rather than as a runtime query error.
 */
export function defineSearchConfig(config: EntitySearchConfig): EntitySearchConfig {
  if (config.sortableFields.length === 0) {
    throw new Error("At least one sortable field is required");
  }

  if (!config.sortableFields.includes(config.defaultSort.field)) {
    throw new Error(
      `defaultSort.field "${config.defaultSort.field}" must be in sortableFields: [${config.sortableFields.join(", ")}]`,
    );
  }

  for (const [fieldName, fieldDef] of Object.entries(config.filterableFields)) {
    validateFilterField(fieldName, fieldDef);
  }

  return config;
}
