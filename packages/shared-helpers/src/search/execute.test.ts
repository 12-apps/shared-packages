import { describe, it, expect, vi } from "vitest";

import { executeSearch } from "./execute";
import { createMockEntitySearchConfig, createMockSearchableModel } from "./test-helpers";
import type { ParsedSearchInput } from "./types";

function makeInput(overrides: Partial<ParsedSearchInput> = {}): ParsedSearchInput {
  return { page: 1, pageSize: 20, sort: { field: "createdAt", direction: "desc" }, ...overrides };
}

const entityConfig = createMockEntitySearchConfig();

describe("executeSearch", () => {
  it("runs findMany + count and returns exact pagination", async () => {
    const rows = [{ id: "1" }, { id: "2" }];
    const model = createMockSearchableModel(rows, 42);

    const result = await executeSearch(model, entityConfig, makeInput({ page: 2, pageSize: 20, q: "jo" }));

    expect(result.data).toEqual(rows);
    expect(result.pagination).toMatchObject({ total: 42, page: 2, pageSize: 20, pageCount: 3, hasNextPage: true });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: "jo" } }, { email: { contains: "jo" } }] },
      orderBy: { createdAt: "desc" },
      skip: 20,
      take: 20,
    });
    expect(model.count).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: "jo" } }, { email: { contains: "jo" } }] },
    });
  });

  it("AND-merges extraWhere (RBAC/tenant scope) into the generated where", async () => {
    const model = createMockSearchableModel([], 0);
    const extraWhere = { tenantId: "t1" };

    await executeSearch(model, entityConfig, makeInput({ q: "x" }), { extraWhere });

    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ OR: [{ name: { contains: "x" } }, { email: { contains: "x" } }] }, { tenantId: "t1" }] },
      }),
    );
    expect(model.count).toHaveBeenCalledWith({
      where: { AND: [{ OR: [{ name: { contains: "x" } }, { email: { contains: "x" } }] }, { tenantId: "t1" }] },
    });
  });

  it("uses extraWhere alone when there is no generated where", async () => {
    const model = createMockSearchableModel([], 0);
    await executeSearch(model, entityConfig, makeInput(), { extraWhere: { tenantId: "t1" } });
    expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "t1" } }));
  });

  it("skipTotalCount fetches take+1, never counts, and infers hasNextPage", async () => {
    // pageSize 2, model returns 3 rows → there IS a next page.
    const model = createMockSearchableModel([{ id: "1" }, { id: "2" }, { id: "3" }]);

    const result = await executeSearch(model, entityConfig, makeInput({ pageSize: 2 }), { skipTotalCount: true });

    expect(model.count).not.toHaveBeenCalled();
    expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(result.data).toHaveLength(2);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.approximate).toBe(true);
  });

  it("skipTotalCount reports no next page when the extra row is absent", async () => {
    const model = createMockSearchableModel([{ id: "1" }]);
    const result = await executeSearch(model, entityConfig, makeInput({ pageSize: 2 }), { skipTotalCount: true });
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.data).toHaveLength(1);
  });

  it("runs findMany and count in parallel", async () => {
    const order: string[] = [];
    const model = {
      findMany: vi.fn().mockImplementation(async () => {
        order.push("findMany:start");
        return [];
      }),
      count: vi.fn().mockImplementation(async () => {
        order.push("count:start");
        return 0;
      }),
    };
    await executeSearch(model, entityConfig, makeInput());
    // Both started before either resolved (Promise.all), so both starts are recorded.
    expect(order).toContain("findMany:start");
    expect(order).toContain("count:start");
  });
});
