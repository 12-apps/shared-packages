import { beforeEach, describe, expect, it } from "vitest";

import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountRoute, type DiscountsActor } from "../routes";
import type { DiscountPage, DiscountRecord, DiscountStore, DiscountWrite } from "../store";
import { DiscountValidationError } from "../validate";
import { recordingLogger } from "./recording-logger";

/**
 * The HTTP capability, driven through its descriptors.
 *
 * These are the cases that used to live in the origin host's two route files,
 * where each of them also exercised that host's session, tenant lookup and
 * RBAC. Here the actor arrives resolved, so what is left is exactly the
 * package's own contract: which status, which envelope, which field a
 * rejected write names, and what reaches the store.
 */

const ACTOR: DiscountsActor = { clientId: "tenant-1" };

/** A wire body the schemas would have accepted, with the branch fields set. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Ten off",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    stackable: true,
    active: true,
    ...overrides,
  };
}

function record(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id: "d1",
    name: "Ten off",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: null,
    endsAt: null,
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    usageCount: 0,
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** A store that records what it was asked, so the routes' hand-off is visible. */
interface Calls {
  list: { clientId: string; input: unknown }[];
  get: { clientId: string; id: string }[];
  create: { clientId: string; write: DiscountWrite }[];
  update: { clientId: string; id: string; write: DiscountWrite }[];
  archive: { clientId: string; id: string }[];
}

function fakeStore(calls: Calls, found: DiscountRecord | null = record()): DiscountStore {
  const page: DiscountPage = {
    data: [record()],
    pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
  };
  return {
    list: async (clientId, input) => {
      calls.list.push({ clientId, input });
      return page;
    },
    get: async (clientId, id) => {
      calls.get.push({ clientId, id });
      return found;
    },
    create: async (clientId, write) => {
      calls.create.push({ clientId, write });
      return record();
    },
    update: async (clientId, id, write) => {
      calls.update.push({ clientId, id, write });
    },
    archive: async (clientId, id) => {
      calls.archive.push({ clientId, id });
    },
  };
}

let calls: Calls;

/**
 * One descriptor, by the pair that identifies it. Throws rather than returning
 * undefined so a renamed path fails here instead of as a confusing `undefined`
 * further down the case.
 */
function routeFor(
  store: DiscountStore,
  method: DiscountRoute["method"],
  wirePath: string,
): DiscountRoute {
  const { routes } = createApiDiscounts({
    store,
    copy: PT_BR_DISCOUNTS_SERVER_COPY,
    logger: recordingLogger(),
  });
  const route = routes.find((entry) => entry.method === method && entry.path === wirePath);
  if (!route) throw new Error(`no discounts route for ${method} ${wirePath}`);
  return route;
}

beforeEach(() => {
  calls = { list: [], get: [], create: [], update: [], archive: [] };
});

describe("createApiDiscounts", () => {
  it("refuses to build without every sentence it answers a human with", () => {
    expect(() =>
      createApiDiscounts({
        store: fakeStore(calls),
        copy: { ...PT_BR_DISCOUNTS_SERVER_COPY, notFound: "" },
        logger: recordingLogger(),
      }),
    ).toThrow(/notFound/);
  });

  it("names every missing key at once, rather than one per attempt", () => {
    expect(() =>
      createApiDiscounts({ store: fakeStore(calls), copy: undefined as never, logger: recordingLogger() }),
    ).toThrow(/invalidQuery.*notFound.*invalidPercent/s);
  });
});

describe("GET /discounts", () => {
  it("returns the page as-is — the envelope is the page, not a second wrapper", async () => {
    const endpoint = routeFor(fakeStore(calls), "GET", "/discounts");
    const response = await endpoint.handle({ actor: ACTOR, params: {}, query: {} });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("data");
    expect(response.body).toHaveProperty("pagination");
    expect(calls.list[0]?.clientId).toBe("tenant-1");
  });

  it("applies the search defaults so a bare request is still a valid page read", async () => {
    const endpoint = routeFor(fakeStore(calls), "GET", "/discounts");
    await endpoint.handle({ actor: ACTOR, params: {}, query: {} });
    expect(calls.list[0]?.input).toMatchObject({
      page: 1,
      // The engine parses the sort string into its own descriptor on the way
      // through, so the store never re-splits `field:direction`.
      sort: { field: "createdAt", direction: "desc" },
    });
  });

  it("refuses a query the schema rejects, without reaching the store", async () => {
    const endpoint = routeFor(fakeStore(calls), "GET", "/discounts");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: {},
      query: { type_in: "NOT_A_TYPE" },
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: PT_BR_DISCOUNTS_SERVER_COPY.invalidQuery });
    expect(calls.list).toEqual([]);
  });
});

describe("GET /discounts/:id", () => {
  it("wraps one discount in the data envelope", async () => {
    const endpoint = routeFor(fakeStore(calls), "GET", "/discounts/:id");
    const response = await endpoint.handle({ actor: ACTOR, params: { id: "d1" }, query: {} });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: record() });
    expect(calls.get).toEqual([{ clientId: "tenant-1", id: "d1" }]);
  });

  it("answers 404 for a stale, foreign or archived id — one indistinguishable miss", async () => {
    const endpoint = routeFor(fakeStore(calls, null), "GET", "/discounts/:id");
    const response = await endpoint.handle({ actor: ACTOR, params: { id: "gone" }, query: {} });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: PT_BR_DISCOUNTS_SERVER_COPY.notFound });
  });
});

describe("POST /discounts", () => {
  it("hands the store validated columns and scope-narrowed targets, never the body", async () => {
    const endpoint = routeFor(fakeStore(calls), "POST", "/discounts");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: {},
      query: {},
      // ORDER scope with targets attached: the write must drop them, or a
      // later flip back to CATEGORY would silently re-narrow the discount.
      body: body({ categoryIds: ["c1"], menuItemIds: ["m1"] }),
    });
    expect(response.status).toBe(200);
    expect(calls.create[0]?.write.targets).toEqual({
      categoryIds: [],
      menuItemIds: [],
      comboRequirements: [],
    });
    expect(calls.create[0]?.write.scalars).toMatchObject({
      name: "Ten off",
      percentOffBp: 1_000,
      // The other branch's column is forced to NULL rather than passed through.
      amountOffCents: null,
    });
  });

  it("carries a combo's slots and reward through to the store", async () => {
    const endpoint = routeFor(fakeStore(calls), "POST", "/discounts");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: {},
      query: {},
      body: body({
        name: "Combo pipoca",
        type: "BUNDLE_PRICE",
        percentOffBp: null,
        bundlePriceCents: 2_500,
        scope: "COMBO",
        comboRequirements: [
          { menuItemIds: ["popcorn-lg"], categoryIds: [], quantity: 1 },
          { menuItemIds: [], categoryIds: ["drinks"], quantity: 2 },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect(calls.create[0]?.write.targets.comboRequirements).toHaveLength(2);
    expect(calls.create[0]?.write.scalars).toMatchObject({
      type: "BUNDLE_PRICE",
      bundlePriceCents: 2_500,
      // Every column the other three types read is forced to NULL.
      percentOffBp: null,
      amountOffCents: null,
      freeUnits: null,
    });
  });

  it("rejects a combo reward on a discount that is not a combo, naming the scope", async () => {
    const endpoint = routeFor(fakeStore(calls), "POST", "/discounts");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: {},
      query: {},
      body: body({ type: "FREE_UNITS", percentOffBp: null, freeUnits: 1 }),
    });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: PT_BR_DISCOUNTS_SERVER_COPY.comboScopeRequired,
      issues: { scope: PT_BR_DISCOUNTS_SERVER_COPY.comboScopeRequired },
    });
    expect(calls.create).toEqual([]);
  });

  it("de-duplicates the targets it does keep", async () => {
    const endpoint = routeFor(fakeStore(calls), "POST", "/discounts");
    await endpoint.handle({
      actor: ACTOR,
      params: {},
      query: {},
      body: body({ scope: "CATEGORY", categoryIds: ["c1", "c1", "c2"] }),
    });
    expect(calls.create[0]?.write.targets.categoryIds).toEqual(["c1", "c2"]);
  });

  it("rejects a scope with no target — the rule no CHECK constraint can express", async () => {
    const endpoint = routeFor(fakeStore(calls), "POST", "/discounts");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: {},
      query: {},
      body: body({ scope: "CATEGORY", categoryIds: [] }),
    });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: PT_BR_DISCOUNTS_SERVER_COPY.categoryTargetRequired,
      issues: { targets: PT_BR_DISCOUNTS_SERVER_COPY.categoryTargetRequired },
    });
    expect(calls.create).toEqual([]);
  });

  it("names the form field for a window that closes before it opens", async () => {
    const endpoint = routeFor(fakeStore(calls), "POST", "/discounts");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: {},
      query: {},
      body: body({ startsAt: "2026-03-10", endsAt: "2026-03-10" }),
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      issues: { endsAt: PT_BR_DISCOUNTS_SERVER_COPY.endsBeforeStarts },
    });
  });

  it("lets a store's own failure through untouched — a conflict is the host's to word", async () => {
    const conflict = new Error("duplicate code");
    const store = { ...fakeStore(calls), create: async () => Promise.reject(conflict) };
    const endpoint = routeFor(store as DiscountStore, "POST", "/discounts");
    await expect(
      endpoint.handle({ actor: ACTOR, params: {}, query: {}, body: body() }),
    ).rejects.toBe(conflict);
  });
});

describe("PATCH and DELETE /discounts/:id", () => {
  it("acknowledges an update with the id, having re-stated the discount whole", async () => {
    const endpoint = routeFor(fakeStore(calls), "PATCH", "/discounts/:id");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: { id: "d1" },
      query: {},
      body: body({ trigger: "CODE", code: " bemvindo10 " }),
    });
    expect(response).toEqual({ status: 200, body: { data: { id: "d1" } } });
    // Normalized on the way in: codes are compared case- and space-insensitively.
    expect(calls.update[0]?.write.scalars.code).toBe("BEMVINDO10");
  });

  it("refuses a CODE-triggered discount with nothing to type", async () => {
    const endpoint = routeFor(fakeStore(calls), "PATCH", "/discounts/:id");
    const response = await endpoint.handle({
      actor: ACTOR,
      params: { id: "d1" },
      query: {},
      body: body({ trigger: "CODE", code: "   " }),
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      issues: { code: PT_BR_DISCOUNTS_SERVER_COPY.codeRequired },
    });
    expect(calls.update).toEqual([]);
  });

  it("archives rather than removes, and acknowledges with the id", async () => {
    const endpoint = routeFor(fakeStore(calls), "DELETE", "/discounts/:id");
    const response = await endpoint.handle({ actor: ACTOR, params: { id: "d1" }, query: {} });
    expect(response).toEqual({ status: 200, body: { data: { id: "d1" } } });
    expect(calls.archive).toEqual([{ clientId: "tenant-1", id: "d1" }]);
  });
});

describe("DiscountValidationError", () => {
  it("is always the 422 an operator can act on, and names the input to paint", () => {
    const error = new DiscountValidationError("percentOff", "…");
    expect(error.status).toBe(422);
    expect(error.field).toBe("percentOff");
    expect(error).toBeInstanceOf(Error);
  });
});
