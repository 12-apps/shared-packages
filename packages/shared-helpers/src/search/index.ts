/**
 * `@12-apps/shared-helpers/search` — the reusable backend list/search engine.
 *
 * Every admin list repository goes through this so filtering, sorting, and
 * pagination happen at the database. A repo declares a {@link defineSearchConfig}
 * and calls {@link executeSearch}; the page and the MCP registry share the
 * {@link createSearchInput}/{@link createSearchOutput} Zod schemas.
 */

export {
  defineSearchConfig,
  type EntitySearchConfig,
  type FilterFieldDef,
  type FilterOperator,
  type PaginatedResult,
  type PaginationMeta,
  type ParsedSearchInput,
  type SearchableModel,
  type SortParam,
} from "./types";

export { parseSearchConfig, searchConfigSchema, type SearchConfig } from "./config";

export { buildPrismaArgs, buildWhereClause, type PrismaSearchArgs } from "./query-builder";

export { buildPaginationMeta, type PaginationMetaFlags } from "./pagination";

export { executeSearch, type ExecuteSearchOptions } from "./execute";

export {
  createSearchInput,
  createSearchOutput,
  parseSearchParamsResilient,
  parseSortParam,
} from "./schemas";
