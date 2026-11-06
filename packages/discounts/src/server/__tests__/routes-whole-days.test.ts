import { describe, expect, it } from "vitest";

import { legacyUtcWindowToZoned } from "../../timezone";
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
    windowInZone: true,
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

function harness(
  extra: Partial<DiscountsApiConfig> = {},
  stored: DiscountRecord = record(),
  storeOverrides: Partial<DiscountStore> = {},
) {
  const writes: DiscountWrite[] = [];
  const zonesAsked: string[] = [];
  const store: DiscountStore = {
    list: async () => ({
      data: [stored],
      pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
    }),
    get: async () => stored,
    create: async (_clientId, write) => {
      writes.push(write);
      return record({
        startsAt: write.scalars.startsAt,
        endsAt: write.scalars.endsAt,
        windowInZone: write.scalars.windowInZone,
      });
    },
    update: async (_clientId, _id, write) => {
      writes.push(write);
    },
    archive: async () => {},
    ...storeOverrides,
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
    expect(writes[0]?.scalars.windowInZone).toBe(true);
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
    // Review round 4: the flag the PATCH stores is what the next read places
    // the days by — a re-save that dropped it would read a day early.
    expect(writes[0]?.scalars.windowInZone).toBe(true);
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
    expect(writes[0]?.scalars.windowInZone).toBe(false);
    expect((created.body as { data: Record<string, unknown> }).data).not.toHaveProperty("startsOn");
    const read = await call("GET", "/discounts/:id");
    expect((read.body as { data: Record<string, unknown> }).data).not.toHaveProperty("endsOn");
  });

  it("without a zone, an update stores the flag false, on UTC midnights (review round 4)", async () => {
    const legacy = record({ windowInZone: false });
    const { call, writes } = harness({ storeTimeZone: undefined }, legacy);
    await call("PATCH", "/discounts/:id", BODY);
    expect(writes[0]?.scalars.windowInZone).toBe(false);
    expect(writes[0]?.scalars.startsAt?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
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

  // Review round 2: days placed on UTC are other days than the store's, and a
  // form would show them as the store's. Edited on purpose: the round-1 cases
  // asserted the UTC days this now refuses to answer.
  it("answers the list on an unknown zone WITHOUT its days, and logs why", async () => {
    const logger = recordingLogger();
    const { call } = harness({ storeTimeZone: () => "Not/A_Zone", logger });
    const response = await call("GET", "/discounts");
    expect(response.status).toBe(200);
    const row = (response.body as { data: Record<string, unknown>[] }).data[0]!;
    expect(row).not.toHaveProperty("startsOn");
    expect(row).not.toHaveProperty("endsOn");
    expect(row).toHaveProperty("startsAt");
    expect(row).toMatchObject({ daysUnknown: true });
    expect(logger.at("warn").join("\n")).toMatch(/unknown store time zone "Not\/A_Zone" for tenant tenant-1/u);
  });

  it("answers one rule on an unknown zone the same way", async () => {
    const logger = recordingLogger();
    const { call } = harness({ storeTimeZone: () => "Not/A_Zone", logger });
    const response = await call("GET", "/discounts/:id");
    expect(response.status).toBe(200);
    const data = (response.body as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("startsOn");
    expect(data).not.toHaveProperty("endsOn");
    expect(data).toMatchObject({ daysUnknown: true });
    expect(logger.at("warn")).toHaveLength(1);
  });

  // Review round 3 (B1/B2): a legacy row needs no zone to be read — its days
  // are the UTC ones the old form showed — so it is never "unknown".
  it("still answers a legacy row's UTC days on an unknown zone", async () => {
    const legacy = record({ startsAt: new Date("2026-11-10T00:00:00.000Z"), endsAt: new Date("2026-11-20T00:00:00.000Z"), windowInZone: false });
    const { call } = harness({ storeTimeZone: () => "Not/A_Zone" }, legacy);
    const data = (await call("GET", "/discounts/:id")).body as { data: Record<string, unknown> };
    expect(data.data).toMatchObject({ startsOn: "2026-11-10", endsOn: "2026-11-20" });
    expect(data.data).not.toHaveProperty("daysUnknown");
  });

  it("refuses a whitespace-only zone like an empty one", async () => {
    const { call, writes } = harness({ storeTimeZone: () => "   " });
    await expect(call("POST", "/discounts", BODY)).rejects.toThrow(/storeTimeZone answered .* for tenant "tenant-1"/u);
    await expect(call("GET", "/discounts")).rejects.toThrow(/storeTimeZone answered/u);
    expect(writes).toEqual([]);
  });

  it("still refuses an update on an unknown zone", async () => {
    const { call, writes } = harness({ storeTimeZone: () => "Not/A_Zone" });
    await expect(call("PATCH", "/discounts/:id", BODY)).rejects.toThrow(/Not\/A_Zone/u);
    expect(writes).toEqual([]);
  });
});

describe("reading by the row's flag through the routes (FUT-4482, review round 3)", () => {
  it("reads the previous release's overlap write (UTC window, flag false) on its UTC days, in São Paulo", async () => {
    const overlap = record({ startsAt: new Date("2026-11-10T00:00:00.000Z"), endsAt: new Date("2026-11-20T00:00:00.000Z"), windowInZone: false });
    const { call } = harness({}, overlap);
    expect((await call("GET", "/discounts")).body).toMatchObject({ data: [{ startsOn: "2026-11-10", endsOn: "2026-11-20" }] });
  });

  it("warns when the store answers no windowInZone, and reads the row as legacy", async () => {
    const logger = recordingLogger();
    const unmapped = record({ startsAt: new Date("2026-11-10T00:00:00.000Z"), endsAt: null });
    delete unmapped.windowInZone;
    const { call } = harness({ logger }, unmapped);
    expect((await call("GET", "/discounts/:id")).body).toMatchObject({ data: { startsOn: "2026-11-10", endsOn: null } });
    expect(logger.at("warn").join("\n")).toMatch(/without windowInZone/u);
  });

  // Review round 4: the create twin — the record a create answers is mapped by
  // the same store, so an unmapped column shows there first.
  it("warns when the store's created record has no windowInZone", async () => {
    const logger = recordingLogger();
    const { call } = harness({ logger }, record(), {
      create: async (_clientId, write) => {
        const created = record({ startsAt: write.scalars.startsAt, endsAt: write.scalars.endsAt });
        delete created.windowInZone;
        return created;
      },
    });
    const response = await call("POST", "/discounts", BODY);
    expect(response.status).toBe(200);
    expect(logger.at("warn").join("\n")).toMatch(/without windowInZone/u);
  });

  // Review round 4: an operator who opens a legacy rule and saves it with the
  // days the form showed stores exactly what the host's migration would have —
  // the same whole days, flag true — so a save and the migration never disagree.
  it("re-saves a legacy row on the days it was read as, equal to the migration's answer", async () => {
    const legacy = record({
      startsAt: new Date("2026-11-10T00:00:00.000Z"),
      endsAt: new Date("2026-11-20T00:00:00.000Z"),
      windowInZone: false,
    });
    const { call, writes } = harness({}, legacy);
    const read = (await call("GET", "/discounts/:id")).body as { data: { startsOn: string; endsOn: string } };
    await call("PATCH", "/discounts/:id", { ...BODY, startsAt: read.data.startsOn, endsAt: read.data.endsOn });
    expect(writes[0]?.scalars).toMatchObject(legacyUtcWindowToZoned(legacy, SP)!);
    expect(writes[0]?.scalars.windowInZone).toBe(true);
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
