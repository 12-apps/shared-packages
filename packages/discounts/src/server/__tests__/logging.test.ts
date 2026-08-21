import { describe, expect, it } from "vitest";

import { errorText } from "../logging";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountRoute, type DiscountsActor } from "../routes";
import type { DiscountPage, DiscountRecord, DiscountStore } from "../store";
import { recordingLogger, type RecordingLogger } from "./recording-logger";

/**
 * Unit: what this surface says out loud.
 *
 * The bug these cases exist to keep fixed is a SILENCE, not a wrong sentence:
 * the manifest declared `observability: { namespace: "discounts" }`, the host
 * built the namespaced logger and hung it on `assembled.loggers`, and the
 * package contained no log call at all — so a store that threw inside `list`
 * reached the host's catch-all with nothing naming discounts, and a refused
 * write reached nobody.
 *
 * What is asserted is the LEVEL and the facts a line carries, never its exact
 * wording: these sentences are read by a developer, so they are the package's
 * own English and free to improve. What must not drift is which outcome is
 * loud, which is quiet, and what a line is allowed to contain.
 */

const ACTOR: DiscountsActor = { clientId: "tenant-1" };

const RECORD: DiscountRecord = {
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
  perBuyerLimit: null,
  usageLimit: null,
  usageCount: 0,
  stackable: true,
  active: true,
  categoryIds: [],
  menuItemIds: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const PAGE: DiscountPage = {
  data: [RECORD],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    pageCount: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

/** A store whose every method answers, so only the surface's own logging shows. */
function workingStore(found: DiscountRecord | null = RECORD): DiscountStore {
  return {
    list: () => Promise.resolve(PAGE),
    get: () => Promise.resolve(found),
    create: () => Promise.resolve(RECORD),
    update: () => Promise.resolve(),
    archive: () => Promise.resolve(),
  };
}

/** A store that fails the way a database does: on every call, with a cause. */
function failingStore(error: unknown): DiscountStore {
  const fail = () => Promise.reject(error);
  return { list: fail, get: fail, create: fail, update: fail, archive: fail };
}

/**
 * One surface plus the log it wrote into, built per case.
 *
 * The recorder is created HERE rather than in a `beforeEach` over a shared
 * binding: a case that reads two routes (an update then an archive) wants both
 * lines in one log, and a module-level `let` reassigned per test is the
 * order-dependence this repo's flakiness gate refuses outright.
 */
interface DiscountsUnderTest {
  route(method: DiscountRoute["method"], wirePath: string): DiscountRoute;
  log: RecordingLogger;
}

function apiFor(store: DiscountStore): DiscountsUnderTest {
  const log = recordingLogger();
  const { routes } = createApiDiscounts({
    store,
    copy: PT_BR_DISCOUNTS_SERVER_COPY,
    logger: log,
  });
  return {
    log,
    route: (method, wirePath) => {
      const route = routes.find((entry) => entry.method === method && entry.path === wirePath);
      if (!route) throw new Error(`no discounts route for ${method} ${wirePath}`);
      return route;
    },
  };
}

/** A body the write rules accept, so a case can choose to fail a DIFFERENT one. */
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

describe("a surface with no logger cannot be built", () => {
  it("L1: refuses a config that omits it, naming what a wiring host passes", () => {
    expect(() =>
      createApiDiscounts({
        store: workingStore(),
        copy: PT_BR_DISCOUNTS_SERVER_COPY,
        logger: undefined as never,
      }),
    ).toThrow(/observability namespace/);
  });

  it("L2: refuses a logger missing one of the three methods", () => {
    // A pino-ish object with `error` renamed is the realistic version of this:
    // it would type-check nowhere but arrives happily through a host's `any`.
    expect(() =>
      createApiDiscounts({
        store: workingStore(),
        copy: PT_BR_DISCOUNTS_SERVER_COPY,
        logger: { info: () => {}, warn: () => {} } as never,
      }),
    ).toThrow(/info\/warn\/error/);
  });
});

describe("the quiet path", () => {
  it("L3: says nothing at all about a read that worked", async () => {
    const api = apiFor(workingStore());
    await api.route("GET", "/discounts").handle({ actor: ACTOR, params: {}, query: {} });
    expect(api.log.lines).toEqual([]);
  });
});

describe("a write leaves a line, because a discount is what a buyer is charged", () => {
  it("L4: records a creation at info, with the id and the tenant", async () => {
    const api = apiFor(workingStore());
    await api
      .route("POST", "/discounts")
      .handle({ actor: ACTOR, params: {}, query: {}, body: body() });
    expect(api.log.at("info")).toEqual(["created discount d1 for tenant tenant-1"]);
  });

  it("L5: records an update and an archive too, told apart by their verb", async () => {
    const api = apiFor(workingStore());
    await api
      .route("PATCH", "/discounts/:id")
      .handle({ actor: ACTOR, params: { id: "d9" }, query: {}, body: body() });
    await api
      .route("DELETE", "/discounts/:id")
      .handle({ actor: ACTOR, params: { id: "d9" }, query: {} });
    expect(api.log.at("info")).toEqual([
      "re-stated discount d9 for tenant tenant-1",
      "archived discount d9 for tenant tenant-1",
    ]);
  });
});

describe("a refusal is a warning — somebody typed something, nothing is broken", () => {
  it("L6: warns about a query the schema rejected, and still answers 400", async () => {
    const api = apiFor(workingStore());
    const response = await api.route("GET", "/discounts").handle({
      actor: ACTOR,
      params: {},
      query: { type_in: "NOT_A_TYPE" },
    });
    expect(response.status).toBe(400);
    expect(api.log.at("warn")).toEqual(["GET /discounts for tenant tenant-1 refused with 400"]);
    expect(api.log.at("error")).toEqual([]);
  });

  it("L7: warns about a read that found nothing, naming the id asked for", async () => {
    const api = apiFor(workingStore(null));
    const response = await api
      .route("GET", "/discounts/:id")
      .handle({ actor: ACTOR, params: { id: "gone" }, query: {} });
    expect(response.status).toBe(404);
    expect(api.log.at("warn")).toEqual([
      "GET /discounts/:id [gone] for tenant tenant-1 refused with 404",
    ]);
  });

  it("L8: warns about a refused write naming the FIELD, and still answers 422", async () => {
    const api = apiFor(workingStore());
    const response = await api.route("POST", "/discounts").handle({
      actor: ACTOR,
      params: {},
      query: {},
      body: body({ percentOffBp: 0 }),
    });
    expect(response.status).toBe(422);
    // The field is what a form paints red, and it is the one fact that makes a
    // logged refusal actionable — "refused with 422" alone names no input.
    expect(api.log.at("warn")[0]).toContain('field "percentOff"');
    expect(api.log.at("error")).toEqual([]);
  });
});

describe("anything else is an error, and the error still travels", () => {
  it("L9: logs a store failure at error, with the cause's message", async () => {
    const api = apiFor(failingStore(new Error("connection terminated")));
    await expect(
      api.route("POST", "/discounts").handle({ actor: ACTOR, params: {}, query: {}, body: body() }),
    ).rejects.toThrow("connection terminated");
    expect(api.log.at("error")).toEqual([
      "POST /discounts for tenant tenant-1 failed: connection terminated",
    ]);
  });

  it("L10: covers the READ routes too — the half that had no catch at all", async () => {
    const api = apiFor(failingStore(new Error("pool exhausted")));
    await expect(
      api.route("GET", "/discounts").handle({ actor: ACTOR, params: {}, query: {} }),
    ).rejects.toThrow("pool exhausted");
    expect(api.log.at("error")).toEqual([
      "GET /discounts for tenant tenant-1 failed: pool exhausted",
    ]);
  });

  it("L11: re-throws the store's own error rather than folding it into a response", async () => {
    // The host's error mapping is what turns a unique clash into the operator's
    // sentence. A surface that answered 500 here would take that away, and a
    // dead database would arrive as an ordinary refusal nobody investigates.
    class DuplicateCode extends Error {}
    const api = apiFor(failingStore(new DuplicateCode("code taken")));
    await expect(
      api.route("POST", "/discounts").handle({ actor: ACTOR, params: {}, query: {}, body: body() }),
    ).rejects.toBeInstanceOf(DuplicateCode);
  });

  it("L12: still logs a thrown value that is not an Error", async () => {
    const api = apiFor(failingStore("connection reset"));
    await expect(
      api.route("DELETE", "/discounts/:id").handle({ actor: ACTOR, params: { id: "d1" }, query: {} }),
    ).rejects.toBe("connection reset");
    expect(api.log.at("error")[0]).toContain("connection reset");
  });
});

describe("what a line may never carry", () => {
  it("L13: never logs the body, the coupon code or the operator's own words", async () => {
    const api = apiFor(workingStore());
    await api.route("POST", "/discounts").handle({
      actor: ACTOR,
      params: {},
      query: {},
      body: body({ name: "Segredo comercial", trigger: "CODE", code: "TOPSECRET" }),
    });
    const everything = api.log.lines.map((line) => line.message).join("\n");
    expect(everything).not.toContain("TOPSECRET");
    expect(everything).not.toContain("Segredo comercial");
  });

  it("L14: folds a cause into the sentence rather than handing over the object", () => {
    // Winston's formatter runs `util.inspect(…, { depth: 5 })` over an extra
    // argument, so an error object passed as one is how a provider payload —
    // buyer name, e-mail and CPF included — reaches a third party.
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText({ toString: () => "weird" })).toBe("weird");
  });
});
