import type { EntitySearchConfig, PaginatedResult, ParsedSearchInput, SearchableModel } from "./types";
import { buildPrismaArgs } from "./query-builder";
import { buildPaginationMeta } from "./pagination";

export interface ExecuteSearchOptions {
  /**
   * When true, skip the `SELECT COUNT(*)` used to compute exact `total` and
   * instead fetch one extra row to infer `hasNextPage`. `total` becomes a
   * lower bound (`pagination.approximate` is set). Use only from callers that
   * don't need exact totals (e.g. infinite scroll) — REST/MCP endpoints that
   * expose a total must keep this `false` (the default).
   */
  skipTotalCount?: boolean;
  /**
   * Extra Prisma-shaped predicate AND-merged into the generated `where`. Use
   * to scope by fields the `EntitySearchConfig` doesn't declare — e.g. the
   * tenant id, or an RBAC visibility clause (Orders' `visibleWhere`).
   */
  extraWhere?: Record<string, unknown>;
}

/**
 * AND-merge `extra` into an existing where clause without losing either side.
 * Returns a fresh object; never mutates.
 */
function mergeExtraWhere(
  base: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extra) return base;
  if (!base) return extra;
  return { AND: [base, extra] };
}

/**
 * Opt-in fast path for callers that don't need an exact total. Fetches
 * `take + 1` rows so the extra row signals `hasNextPage` without a COUNT scan.
 * `total` is inferred, not counted, so `pagination.approximate` is set.
 */
async function fetchPageSkipTotalCount<T>(
  modelDelegate: SearchableModel,
  args: { where?: Record<string, unknown>; orderBy: Record<string, unknown>; skip: number; take: number },
  page: number,
  pageSize: number,
): Promise<PaginatedResult<T>> {
  const { where, orderBy, skip, take } = args;
  const rows = (await modelDelegate.findMany({ where, orderBy, skip, take: take + 1 })) as T[];
  const hasNextPage = rows.length > take;
  const data = hasNextPage ? rows.slice(0, take) : rows;
  const observed = skip + data.length + (hasNextPage ? 1 : 0);
  const pagination = buildPaginationMeta(observed, page, pageSize, { approximate: true });
  pagination.hasNextPage = hasNextPage;
  return { data, pagination };
}

/**
 * Execute a paginated list/search against a Prisma model delegate: builds the
 * `where`/`orderBy`/`skip`/`take` from validated input, AND-merges any
 * `extraWhere` scope, then runs `findMany` + `count` in parallel (or the
 * skip-total fast path). Matching is `contains`/`in` over declared fields —
 * always at the database, never in memory.
 */
export async function executeSearch<T>(
  modelDelegate: SearchableModel,
  entityConfig: EntitySearchConfig,
  input: ParsedSearchInput,
  options?: ExecuteSearchOptions,
): Promise<PaginatedResult<T>> {
  const { where: baseWhere, orderBy, skip, take } = buildPrismaArgs(input, entityConfig);
  const where = mergeExtraWhere(baseWhere, options?.extraWhere);

  if (options?.skipTotalCount) {
    return fetchPageSkipTotalCount<T>(modelDelegate, { where, orderBy, skip, take }, input.page, input.pageSize);
  }

  const [data, total] = await Promise.all([
    modelDelegate.findMany({ where, orderBy, skip, take }),
    modelDelegate.count({ where }),
  ]);

  const pagination = buildPaginationMeta(total, input.page, input.pageSize);
  return { data: data as T[], pagination };
}
