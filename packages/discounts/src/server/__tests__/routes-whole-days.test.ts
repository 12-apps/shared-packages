import { describe, expect, it } from "vitest";

import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountRoute, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4482 through the HTTP descriptors: the HOST says which zone a tenant's
 * days are counted in (`storeTimeZone`), the package stores whole days on that
 * clock, and every record it answers with carries the days back
 * (`startsOn`/`endsOn`) so a form never has to guess them from instants.
 */

const SP = "America/Sao_Paulo";

function record(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id: "d1",
    name: "Semana",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: new Date("2026-11-10T03:00:00.000Z"),
    endsAt: new Date("2026-11-21T03:00:00.000Z"),
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    usageCount: 0,
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

const BODY = {
  name: "Semana",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  stackable: true,
  active: true,
  startsAt: "2026-11-10",
  endsAt: "2026-11-20",
};

function harness(extra: Partial<DiscountsApiConfig> = {}) {
  const writes: DiscountWrite[] = [];
  const zonesAsked: string[] = [];
  const store: DiscountStore = {
    list: async () => ({
      data: [record()],
      pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
    }),
    get: async () => record(),
    create: async (_clientId, write) => {
      writes.push(write);
      return record({ startsAt: write.scalars.startsAt, endsAt: write.scalars.endsAt });
    },
    update: async (_clientId, _id, write) => {
      writes.push(write);
    },
    archive: async () => {},
  };
  const { routes } = createApiDiscounts({
    store,
    copy: PT_BR_DISCOUNTS_SERVER_COPY,
    logger: recordingLogger(),
    storeTimeZone: (clientId) => {
      zonesAsked.push(clientId);
      return SP;
    },
    ...extra,
  });
  const route = (method: DiscountRoute["method"], path: string): DiscountRoute => {
    const found = routes.find((entry) => entry.method === method && entry.path === path);
    if (!found) throw new Error(`no route ${method} ${path}`);
    return found;
  };
  const call = (method: DiscountRoute["method"], path: string, body?: unknown) =>
    route(method, path).handle({ actor: { clientId: "tenant-1" }, params: { id: "d1" }, query: {}, body });
  return { call, writes, zonesAsked };
}

describe("createApiDiscounts with the store's zone (FUT-4482)", () => {
  it("asks the host for THIS tenant's zone and stores whole days on it", async () => {
    const { call, writes, zonesAsked } = harness();
    const response = await call("POST", "/discounts", BODY);
    expect(response.status).toBe(200);
    expect(zonesAsked).toContain("tenant-1");
    expect(writes[0]?.scalars.startsAt?.toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(writes[0]?.scalars.endsAt?.toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });

  it("answers the created rule with the days that were chosen", async () => {
    const { call } = harness();
    const response = await call("POST", "/discounts", BODY);
    expect(response.body).toMatchObject({ data: { startsOn: "2026-11-10", endsOn: "2026-11-20" } });
  });

  it("re-states an update on the same clock", async () => {
    const { call, writes } = harness();
    await call("PATCH", "/discounts/:id", { ...BODY, startsAt: "2026-11-20", endsAt: "2026-11-20" });
    expect(writes[0]?.scalars.startsAt?.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(writes[0]?.scalars.endsAt?.toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });

  it("reads one rule back as the same days", async () => {
    const { call } = harness();
    const response = await call("GET", "/discounts/:id");
    expect(response.body).toMatchObject({ data: { startsOn: "2026-11-10", endsOn: "2026-11-20" } });
  });

  it("reads every row of a page back as its days", async () => {
    const { call } = harness();
    const response = await call("GET", "/discounts");
    expect(response.body).toMatchObject({ data: [{ startsOn: "2026-11-10", endsOn: "2026-11-20" }] });
  });

  it("refuses Término before Início with the whole-day sentence, on Término", async () => {
    const { call } = harness();
    const response = await call("POST", "/discounts", { ...BODY, startsAt: "2026-11-20", endsAt: "2026-11-19" });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ issues: { endsAt: PT_BR_DISCOUNTS_SERVER_COPY.endsBeforeStartDay } });
  });

  it("fails the request loudly on a zone the runtime does not know", async () => {
    const { call, writes } = harness({ storeTimeZone: () => "Not/A_Zone" });
    await expect(call("POST", "/discounts", BODY)).rejects.toThrow(/Not\/A_Zone/);
    expect(writes).toEqual([]);
  });

  it("refuses to mount a zone with no sentence for the whole-day refusal", () => {
    const copy = { ...PT_BR_DISCOUNTS_SERVER_COPY, endsBeforeStartDay: undefined };
    expect(() => harness({ copy })).toThrow(/endsBeforeStartDay/);
  });

  it("without a zone, answers exactly what it always did: no days, UTC midnights", async () => {
    const { call, writes } = harness({ storeTimeZone: undefined });
    const created = await call("POST", "/discounts", BODY);
    expect(writes[0]?.scalars.endsAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect((created.body as { data: Record<string, unknown> }).data).not.toHaveProperty("startsOn");
    const read = await call("GET", "/discounts/:id");
    expect((read.body as { data: Record<string, unknown> }).data).not.toHaveProperty("endsOn");
  });
});

describe("createApiDiscounts when the store's zone is wrong (FUT-4482, review round 1)", () => {
  it.each([null, undefined, ""])("fails a write when the host answers %j for a tenant", async (zone) => {
    const { call, writes } = harness({ storeTimeZone: () => zone as unknown as string });
    await expect(call("POST", "/discounts", BODY)).rejects.toThrow(/storeTimeZone answered .* for tenant "tenant-1"/u);
    expect(writes).toEqual([]);
  });

  it("fails a read too when the host answers null, rather than answering UTC days", async () => {
    const { call } = harness({ storeTimeZone: async () => null as unknown as string });
    await expect(call("GET", "/discounts")).rejects.toThrow(/storeTimeZone answered null/u);
  });

  it("answers the list on an unknown zone, its days on UTC, and logs why", async () => {
    const logger = recordingLogger();
    const { call } = harness({ storeTimeZone: () => "Not/A_Zone", logger });
    const response = await call("GET", "/discounts");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [{ startsOn: "2026-11-10", endsOn: "2026-11-21" }] });
    expect(logger.at("warn").join("\n")).toMatch(/unknown store time zone "Not\/A_Zone" for tenant tenant-1/u);
  });

  it("answers one rule on an unknown zone the same way", async () => {
    const logger = recordingLogger();
    const { call } = harness({ storeTimeZone: () => "Not/A_Zone", logger });
    const response = await call("GET", "/discounts/:id");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { startsOn: "2026-11-10", endsOn: "2026-11-21" } });
    expect(logger.at("warn")).toHaveLength(1);
  });

  it("still refuses an update on an unknown zone", async () => {
    const { call, writes } = harness({ storeTimeZone: () => "Not/A_Zone" });
    await expect(call("PATCH", "/discounts/:id", BODY)).rejects.toThrow(/Not\/A_Zone/u);
    expect(writes).toEqual([]);
  });
});

describe("the whole-day refusal in every locale the copy resolves (FUT-4482, review round 1)", () => {
  const callIn = (locale: string, copy: DiscountsApiConfig["copy"]) => {
    const { routes } = createApiDiscounts({
      store: { create: async () => record() } as unknown as DiscountStore,
      copy,
      logger: recordingLogger(),
      storeTimeZone: () => SP,
    });
    const create = routes.find((entry) => entry.method === "POST" && entry.path === "/discounts")!;
    return create.handle({
      actor: { clientId: "tenant-1" },
      params: {},
      query: {},
      locale,
      body: { ...BODY, startsAt: "2026-11-20", endsAt: "2026-11-19" },
    });
  };

  it("says the reader's own whole-day sentence when its pack has one", async () => {
    const own = { ...PT_BR_DISCOUNTS_SERVER_COPY, endsBeforeStartDay: "Término before Início, in en." };
    const response = await callIn("en-US", ({ locale }) => (locale === "en-US" ? own : PT_BR_DISCOUNTS_SERVER_COPY));
    expect(response.body).toMatchObject({ issues: { endsAt: own.endsBeforeStartDay } });
  });

  it("says the default rendering's whole-day sentence, never 'must be after', when the reader's pack lacks it", async () => {
    const without = { ...PT_BR_DISCOUNTS_SERVER_COPY, endsBeforeStartDay: undefined, endsBeforeStarts: "must be after" };
    const response = await callIn("en-US", ({ locale }) =>
      locale === "en-US" ? without : PT_BR_DISCOUNTS_SERVER_COPY,
    );
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ issues: { endsAt: PT_BR_DISCOUNTS_SERVER_COPY.endsBeforeStartDay } });
  });
});
