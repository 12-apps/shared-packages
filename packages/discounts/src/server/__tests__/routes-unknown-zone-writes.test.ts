import { describe, expect, it } from "vitest";

import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountRoute, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4482, review round 9 (B1): every read a write answers with, under a zone
 * the runtime does not know. A create with no dates needs no clock and is
 * stored — and its answer used to place days on that zone and throw, so the
 * operator saw a 500 for a row that WAS written, and a retry wrote a second
 * promotion. Each path below writes once and answers without throwing.
 */

const UNKNOWN = "Not/A_Zone";

function record(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id: "d1",
    name: "Sem prazo",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: null,
    endsAt: null,
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
  name: "Sem prazo",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  stackable: true,
  active: true,
};

function surface(stored: DiscountRecord, extra: Partial<DiscountsApiConfig> = {}) {
  const created: DiscountWrite[] = [];
  const updated: { write: DiscountWrite; condition: DiscountUpdateCondition | undefined }[] = [];
  const store: DiscountStore = {
    list: async () => ({
      data: [stored],
      pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
    }),
    get: async () => stored,
    create: async (_clientId, write) => {
      created.push(write);
      return record({ startsAt: write.scalars.startsAt, endsAt: write.scalars.endsAt, windowInZone: write.scalars.windowInZone });
    },
    update: async (_clientId, _id, write, condition) => {
      updated.push({ write, condition });
      return { applied: true };
    },
    archive: async () => {},
  };
  const { routes } = createApiDiscounts({
    store,
    copy: PT_BR_DISCOUNTS_SERVER_COPY,
    logger: recordingLogger(),
    storeTimeZone: () => UNKNOWN,
    ...extra,
  });
  const route = (method: DiscountRoute["method"], path: string): DiscountRoute =>
    routes.find((entry) => entry.method === method && entry.path === path)!;
  const call = (method: DiscountRoute["method"], path: string, body?: unknown) =>
    route(method, path).handle({ actor: { clientId: "tenant-1" }, params: { id: "d1" }, query: {}, body });
  return { call, created, updated };
}

describe("a create under an unknown zone (round 9, B1)", () => {
  it("stores a dateless promotion ONCE and answers 200 with its dates locked, never a 500", async () => {
    const { call, created } = surface(record());
    const response = await call("POST", "/discounts", BODY);
    expect(created).toHaveLength(1);
    expect(response.status).toBe(200);
    const data = (response.body as { data: Record<string, unknown> }).data;
    // No dates to place: "sem prazo" is said as such, never "Datas indisponíveis".
    expect(data).toMatchObject({ startsOn: null, endsOn: null, datesLocked: true });
    expect(data).not.toHaveProperty("daysUnknown");
  });

  it("still refuses a create that SENDS dates on the date field, storing nothing", async () => {
    const { call, created } = surface(record());
    const response = await call("POST", "/discounts", { ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-20" });
    expect(response).toMatchObject({ status: 422, body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone } } });
    expect(created).toEqual([]);
  });
});

describe("every other read after a write under an unknown zone (round 9, B1)", () => {
  it("answers an update that clears the dates 200, written once", async () => {
    const { call, updated } = surface(record({ startsAt: new Date("2026-11-10T00:00:00.000Z"), windowInZone: false }));
    expect((await call("PATCH", "/discounts/:id", { ...BODY, startsAt: null, endsAt: null })).status).toBe(200);
    expect(updated).toHaveLength(1);
  });

  it("answers a keepWindow update 200, written once", async () => {
    const { call, updated } = surface(record({ startsAt: new Date("2026-11-10T03:00:00.000Z") }));
    expect((await call("PATCH", "/discounts/:id", { ...BODY, active: false, keepWindow: true })).status).toBe(200);
    expect(updated).toHaveLength(1);
  });

  it("answers the list and one rule of a dateless zoned row with no days to place, locked", async () => {
    const { call } = surface(record());
    const one = ((await call("GET", "/discounts/:id")).body as { data: Record<string, unknown> }).data;
    const page = ((await call("GET", "/discounts")).body as { data: Record<string, unknown>[] }).data;
    for (const row of [one, page[0]!]) {
      expect(row).toMatchObject({ startsOn: null, endsOn: null, datesLocked: true });
      expect(row).not.toHaveProperty("daysUnknown");
    }
  });
});
