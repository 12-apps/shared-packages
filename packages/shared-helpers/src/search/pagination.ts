import type { PaginationMeta } from "./types";

export interface PaginationMetaFlags {
  /** `total` was inferred from fetched rows (skipTotalCount path), not exact. */
  approximate?: boolean;
}

export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
  flags: PaginationMetaFlags = {},
): PaginationMeta {
  const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);

  const meta: PaginationMeta = {
    total,
    page,
    pageSize,
    pageCount,
    hasNextPage: page < pageCount,
    hasPreviousPage: page > 1,
  };
  if (flags.approximate) meta.approximate = true;
  return meta;
}
