import { describe, it, expect } from "vitest";

import { buildPaginationMeta } from "./pagination";

describe("buildPaginationMeta", () => {
  it("calculates standard pagination", () => {
    const meta = buildPaginationMeta(95, 2, 20);
    expect(meta).toMatchObject({
      total: 95,
      page: 2,
      pageSize: 20,
      pageCount: 5,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it("returns pageCount 1 for zero results", () => {
    const meta = buildPaginationMeta(0, 1, 20);
    expect(meta).toMatchObject({ total: 0, pageCount: 1, hasNextPage: false, hasPreviousPage: false });
  });

  it("handles page beyond range", () => {
    const meta = buildPaginationMeta(10, 5, 20);
    expect(meta).toMatchObject({ pageCount: 1, hasNextPage: false, hasPreviousPage: true });
  });

  it("handles single page with results", () => {
    const meta = buildPaginationMeta(5, 1, 20);
    expect(meta).toMatchObject({ pageCount: 1, hasNextPage: false, hasPreviousPage: false });
  });

  it("handles exact page boundary", () => {
    const meta = buildPaginationMeta(40, 2, 20);
    expect(meta).toMatchObject({ pageCount: 2, hasNextPage: false, hasPreviousPage: true });
  });

  it("handles first page of multi-page set", () => {
    const meta = buildPaginationMeta(50, 1, 20);
    expect(meta).toMatchObject({ pageCount: 3, hasNextPage: true, hasPreviousPage: false });
  });

  it("handles last page of multi-page set", () => {
    const meta = buildPaginationMeta(50, 3, 20);
    expect(meta).toMatchObject({ pageCount: 3, hasNextPage: false, hasPreviousPage: true });
  });

  it("flags approximate totals", () => {
    expect(buildPaginationMeta(21, 1, 20, { approximate: true }).approximate).toBe(true);
    expect(buildPaginationMeta(21, 1, 20).approximate).toBeUndefined();
  });
});
