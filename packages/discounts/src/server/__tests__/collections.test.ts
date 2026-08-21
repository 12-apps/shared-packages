import { describe, expect, it } from "vitest";

import {
  assertCollections,
  assertTargetsOwned,
  buildTargetPath,
  ForeignTargetError,
  loadTargetGroups,
  targetIdsByType,
  targetPathResolver,
  type DiscountableCollection,
} from "../collections";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountRoute } from "../routes";
import type { DiscountRecord, DiscountStore } from "../store";
import type { DiscountTargets } from "../validate";
import { recordingLogger } from "./recording-logger";

/**
 * Unit (FUT-244): how a host table opts into being discountable.
 *
 * Three things are on trial here, and they are the three the origin host wrote
 * by hand beside its own tables: the cross-tenant guard on a write's targets,
 * the reference data a target picker renders, and the ancestry walk a
 * CATEGORY-scoped discount depends on.
 *
 * The ops are plain fakes rather than a database. That is the point of the
 * seam: what the package owns is WHICH questions get asked and what a wrong
 * answer costs, never how a host answers them.
 */

const OWNED: Readonly<Record<string, readonly string[]>> = {
  "tenant-1": ["c-drinks", "c-sodas", "m-cola", "m-water"],
};

/** A collection over {@link OWNED}, recording what it was asked. */
function collection(
  targetType: "CATEGORY" | "ITEM",
  overrides: Partial<DiscountableCollection> = {},
): DiscountableCollection {
  const rows =
    targetType === "CATEGORY"
      ? [
          { id: "c-drinks", name: "Bebidas", parentId: null },
          { id: "c-sodas", name: "Refrigerantes", parentId: "c-drinks" },
        ]
      : [
          { id: "m-cola", name: "Cola", parentId: null },
          { id: "m-water", name: "Água", parentId: null },
        ];
  return {
    targetType,
    slug: targetType === "CATEGORY" ? "categories" : "products",
    label: targetType === "CATEGORY" ? "Categorias" : "Produtos",
    ...(targetType === "CATEGORY" ? { nests: true } : {}),
    ops: {
      list: (clientId) => Promise.resolve(clientId === "tenant-1" ? rows : []),
      ownsAll: (clientId, ids) =>
        Promise.resolve(ids.every((id) => (OWNED[clientId] ?? []).includes(id))),
      ...(targetType === "CATEGORY"
        ? {
            parents: () =>
              Promise.resolve(
                new Map([
                  ["c-drinks", null],
                  ["c-sodas", "c-drinks"],
                ]),
              ),
          }
        : {}),
    },
    ...overrides,
  };
}

function targets(overrides: Partial<DiscountTargets> = {}): DiscountTargets {
  return { categoryIds: [], menuItemIds: [], comboRequirements: [], ...overrides };
}

const FOREIGN = PT_BR_DISCOUNTS_SERVER_COPY.foreignTarget;

describe("a write may only point at this tenant's rows", () => {
  it("C1: accepts a write whose targets the tenant owns", async () => {
    await expect(
      assertTargetsOwned(
        [collection("CATEGORY"), collection("ITEM")],
        "tenant-1",
        targets({ categoryIds: ["c-drinks"], menuItemIds: ["m-cola"] }),
        FOREIGN,
      ),
    ).resolves.toBeUndefined();
  });

  it("C2: refuses a target belonging to another store", async () => {
    await expect(
      assertTargetsOwned(
        [collection("ITEM")],
        "tenant-1",
        targets({ menuItemIds: ["m-somebody-elses"] }),
        FOREIGN,
      ),
    ).rejects.toBeInstanceOf(ForeignTargetError);
  });

  it("C3: checks the ids inside a COMBO's slots, which the origin host did not", async () => {
    // The gap this closes: a combo scope drops the top-level target pair and
    // carries its targets in the slots, so a host checking only the pair let a
    // crafted combo name another store's products — invisibly.
    await expect(
      assertTargetsOwned(
        [collection("ITEM")],
        "tenant-1",
        targets({
          comboRequirements: [
            { menuItemIds: ["m-cola", "m-somebody-elses"], categoryIds: [], quantity: 2 },
          ],
        }),
        FOREIGN,
      ),
    ).rejects.toThrow(FOREIGN);
  });

  it("C4: asks nothing at all when a dimension has no ids", async () => {
    const asked: string[][] = [];
    const spy = collection("ITEM");
    const watched: DiscountableCollection = {
      ...spy,
      ops: {
        ...spy.ops,
        ownsAll: (clientId, ids) => {
          asked.push([...ids]);
          return spy.ops.ownsAll(clientId, ids);
        },
      },
    };
    await assertTargetsOwned([watched], "tenant-1", targets({ categoryIds: [] }), FOREIGN);
    expect(asked).toEqual([]);
  });

  it("C5: de-duplicates before asking, so one id is one question", () => {
    const byType = targetIdsByType(
      targets({
        menuItemIds: ["m-cola", "m-cola"],
        comboRequirements: [{ menuItemIds: ["m-cola"], categoryIds: ["c-drinks"], quantity: 1 }],
      }),
    );
    expect(byType.ITEM).toEqual(["m-cola"]);
    expect(byType.CATEGORY).toEqual(["c-drinks"]);
  });
});

describe("what a picker is handed", () => {
  it("C6: reports every registered collection with its rows and its label", async () => {
    const groups = await loadTargetGroups(
      [collection("CATEGORY"), collection("ITEM")],
      "tenant-1",
    );
    expect(groups).toEqual([
      {
        targetType: "CATEGORY",
        slug: "categories",
        label: "Categorias",
        nests: true,
        targets: [
          { id: "c-drinks", name: "Bebidas", parentId: null },
          { id: "c-sodas", name: "Refrigerantes", parentId: "c-drinks" },
        ],
      },
      {
        targetType: "ITEM",
        slug: "products",
        label: "Produtos",
        nests: false,
        targets: [
          { id: "m-cola", name: "Cola", parentId: null },
          { id: "m-water", name: "Água", parentId: null },
        ],
      },
    ]);
  });

  it("C7: reports nothing for a tenant with no catalog, rather than failing", async () => {
    expect(await loadTargetGroups([collection("ITEM")], "tenant-2")).toEqual([
      { targetType: "ITEM", slug: "products", label: "Produtos", nests: false, targets: [] },
    ]);
  });
});

describe("the ancestry a CATEGORY-scoped discount walks", () => {
  it("C8: answers a row's own id first, then its ancestors", async () => {
    const resolve = await targetPathResolver(collection("CATEGORY"), "tenant-1");
    expect(resolve("c-sodas")).toEqual(["c-sodas", "c-drinks"]);
  });

  it("C9: answers just the id itself for a collection that does not nest", async () => {
    const resolve = await targetPathResolver(collection("ITEM"), "tenant-1");
    expect(resolve("m-cola")).toEqual(["m-cola"]);
    expect(resolve(null)).toEqual([]);
  });

  it("C10: truncates a cycle rather than looping inside a checkout", () => {
    // `assertValidParent` refuses to CREATE a cycle host-side, but this runs on
    // the money path: a pre-existing bad row must cost a short path, never a
    // hung request.
    const parents = new Map([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(buildTargetPath("a", parents)).toEqual(["a", "b"]);
  });
});

describe("a registration that could only misbehave is refused at construction", () => {
  it("C11: refuses two collections for one dimension", () => {
    expect(() => assertCollections([collection("ITEM"), collection("ITEM")])).toThrow(
      /would never be read/,
    );
  });

  it("C12: refuses a nesting collection with no parents op", () => {
    const broken: DiscountableCollection = {
      ...collection("ITEM"),
      nests: true,
    };
    expect(() => assertCollections([broken])).toThrow(/cover nothing filed under it/);
  });

  it("C13: refuses a dimension this package does not have", () => {
    expect(() =>
      assertCollections([{ ...collection("ITEM"), targetType: "SUPPLIER" as never }]),
    ).toThrow(/not a discountable dimension/);
  });
});

/** A store that answers, so a route case sees only the seam's own decisions. */
function silentStore(): DiscountStore {
  const record = { id: "d1" } as DiscountRecord;
  return {
    list: () => Promise.reject(new Error("not used")),
    get: () => Promise.resolve(null),
    create: () => Promise.resolve(record),
    update: () => Promise.resolve(),
    archive: () => Promise.resolve(),
  };
}

function api(collections?: readonly DiscountableCollection[]) {
  const log = recordingLogger();
  const { routes } = createApiDiscounts({
    store: silentStore(),
    copy: PT_BR_DISCOUNTS_SERVER_COPY,
    logger: log,
    ...(collections ? { collections } : {}),
  });
  return {
    log,
    route: (method: DiscountRoute["method"], path: string): DiscountRoute => {
      const route = routes.find((entry) => entry.method === method && entry.path === path);
      if (!route) throw new Error(`no discounts route for ${method} ${path}`);
      return route;
    },
  };
}

const WRITE_BODY = {
  name: "Ten off",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ITEM",
  trigger: "AUTOMATIC",
  stackable: true,
  active: true,
  menuItemIds: ["m-somebody-elses"],
};

describe("through the surface", () => {
  it("C14: serves the picker's whole reference set in ONE request", async () => {
    const response = await api([collection("CATEGORY"), collection("ITEM")])
      .route("GET", "/discounts/targets")
      .handle({ actor: { clientId: "tenant-1" }, params: {}, query: {} });
    expect(response.status).toBe(200);
    expect((response.body as { data: unknown[] }).data).toHaveLength(2);
  });

  it("C15: keeps the route with no collection registered, answering nothing", async () => {
    // The route table must not vary with one host's wiring: "which endpoints
    // does this package have" is answered by the package, and the advertised
    // tool surface is generated from the same list.
    const response = await api()
      .route("GET", "/discounts/targets")
      .handle({ actor: { clientId: "tenant-1" }, params: {}, query: {} });
    expect(response.body).toEqual({ data: [] });
  });

  it("C16: refuses a foreign target with a 422 naming `targets`", async () => {
    const response = await api([collection("ITEM")])
      .route("POST", "/discounts")
      .handle({ actor: { clientId: "tenant-1" }, params: {}, query: {}, body: WRITE_BODY });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: FOREIGN, issues: { targets: FOREIGN } });
  });

  it("C17: logs that refusal as a warning naming the field, not as an error", async () => {
    const built = api([collection("ITEM")]);
    await built
      .route("POST", "/discounts")
      .handle({ actor: { clientId: "tenant-1" }, params: {}, query: {}, body: WRITE_BODY });
    expect(built.log.at("warn")[0]).toContain('field "targets"');
    expect(built.log.at("error")).toEqual([]);
  });

  it("C18: leaves the check to the store when nothing is registered", async () => {
    // Stated as a case rather than left implicit: this is the cost of
    // `collections` being optional, and a host that skips the registration
    // must keep its own guard.
    const response = await api()
      .route("POST", "/discounts")
      .handle({ actor: { clientId: "tenant-1" }, params: {}, query: {}, body: WRITE_BODY });
    expect(response.status).toBe(200);
  });
});
