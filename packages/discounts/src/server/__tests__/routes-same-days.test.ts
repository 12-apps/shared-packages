import { describe, expect, it, vi } from "vitest";

import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4482, review round 6 (B1, B2): a save that does not change the dates
 * never moves them. When the days a PATCH sends are the days a read of that
 * row showed — a flag-false row's legacy UTC days, a flag-true row's days in
 * the store's zone — the stored `startsAt` / `endsAt` / `windowInZone` are
 * written unchanged, with the zone known, off or unknown. So a pause is never
 * refused over the zone, and a legacy row never turns zoned or grows a day
 * because somebody paused it.
 */

const SP = "America/Sao_Paulo";
const UNKNOWN = "Not/A_Zone";

const LEGACY_STARTS = new Date("2026-11-10T00:00:00.000Z");
const LEGACY_ENDS = new Date("2026-11-20T00:00:00.000Z");

function row(window: Pick<DiscountRecord, "startsAt" | "endsAt" | "windowInZone">): DiscountRecord {
  return {
    id: "d1",
    name: "Semana",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    ...window,
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    usageCount: 0,
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
  };
}

const LEGACY = row({ startsAt: LEGACY_STARTS, endsAt: LEGACY_ENDS, windowInZone: false });

const BODY = {
  name: "Semana",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  stackable: true,
  active: false,
};

function surface(stored: DiscountRecord, extra: Partial<DiscountsApiConfig> = {}) {
  const writes: { write: DiscountWrite; condition: DiscountUpdateCondition | undefined }[] = [];
  const created: DiscountWrite[] = [];
  const store = {
    get: vi.fn(async () => stored),
    update: async (_c: string, _i: string, write: DiscountWrite, condition?: DiscountUpdateCondition) => {
      writes.push({ write, condition });
      return { applied: true };
    },
    create: async (_c: string, write: DiscountWrite) => {
      created.push(write);
      return { ...stored, ...write.scalars, ...write.targets };
    },
  } as unknown as DiscountStore;
  const { routes } = createApiDiscounts({ store, copy: PT_BR_DISCOUNTS_SERVER_COPY, logger: recordingLogger(), ...extra });
  const call = (method: "GET" | "PATCH" | "POST", body?: Record<string, unknown>) => {
    const route = routes.find((entry) => entry.method === method && (method !== "GET" || entry.path === "/discounts/:id"))!;
    return route.handle({ actor: { clientId: "tenant-1" }, params: { id: "d1" }, query: {}, body });
  };
  return { call, writes, created };
}

/** The days a read answered for the row, as the form sends them back. */
async function readDays(call: ReturnType<typeof surface>["call"]): Promise<{ startsAt: string; endsAt: string }> {
  const { data } = (await call("GET")).body as { data: { startsOn: string; endsOn: string } };
  return { startsAt: data.startsOn, endsAt: data.endsOn };
}

describe("a legacy row while the store's zone is unknown (B1, round 8)", () => {
  it("saves (200) and writes the stored window and flag unchanged", async () => {
    const { call, writes } = surface(LEGACY, { storeTimeZone: () => UNKNOWN });
    const days = await readDays(call);
    expect(days).toEqual({ startsAt: "2026-11-10", endsAt: "2026-11-20" });
    const response = await call("PATCH", { ...BODY, ...days });
    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.write.scalars).toMatchObject({ active: false, windowInZone: false });
    expect(writes[0]!.write.scalars.startsAt).toBe(LEGACY_STARTS);
    expect(writes[0]!.write.scalars.endsAt).toBe(LEGACY_ENDS);
    expect(writes[0]!.condition).toEqual({ window: { startsAt: LEGACY_STARTS, endsAt: LEGACY_ENDS, windowInZone: false } });
  });

  // Review round 8: edited on purpose. Round 7 wrote these days as legacy UTC
  // midnights, which dropped an inclusive Término's last day and refused a
  // one-day promotion; with the zone unknown a changed day is refused on ANY row.
  it("refuses a legacy row's CHANGED day on the date field, writing nothing", async () => {
    const { call, writes } = surface(LEGACY, { storeTimeZone: () => UNKNOWN });
    expect(await call("PATCH", { ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-25" })).toMatchObject({
      status: 422,
      body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone } },
    });
    expect(writes).toEqual([]);
  });

  it("still refuses a ZONED row's changed day on the date field only", async () => {
    const zoned = row({ startsAt: new Date("2026-11-10T03:00:00.000Z"), endsAt: new Date("2026-11-21T03:00:00.000Z"), windowInZone: true });
    const { call, writes } = surface(zoned, { storeTimeZone: () => UNKNOWN });
    expect(await call("PATCH", { ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-25" })).toMatchObject({
      status: 422,
      body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone } },
    });
    expect(writes).toEqual([]);
  });

  it("still refuses a create's dates under the unknown zone", async () => {
    const { call, created } = surface(LEGACY, { storeTimeZone: () => UNKNOWN });
    expect(await call("POST", { ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-25" })).toMatchObject({
      status: 422,
      body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone } },
    });
    expect(created).toEqual([]);
  });

  it("still refuses a malformed day as a malformed day, before the zone", async () => {
    const { call } = surface(LEGACY, { storeTimeZone: () => UNKNOWN });
    expect(await call("PATCH", { ...BODY, startsAt: "2026-02-31", endsAt: null })).toMatchObject({
      status: 422,
      body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.invalidDate } },
    });
  });
});

describe("a legacy row saved unchanged under a KNOWN zone (B2)", () => {
  it("keeps its exact stored bounds and flag false — no zoning, no extra day", async () => {
    const { call, writes } = surface(LEGACY, { storeTimeZone: () => SP });
    const response = await call("PATCH", { ...BODY, ...(await readDays(call)) });
    expect(response.status).toBe(200);
    const { scalars } = writes[0]!.write;
    expect(scalars.windowInZone).toBe(false);
    expect(scalars.startsAt?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(scalars.endsAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });

  it("keeps a zoned row's exact bounds too when its days come back unchanged", async () => {
    // Odd instants on purpose: a re-derived window would land on 03:00Z.
    const zoned = row({
      startsAt: new Date("2026-11-10T03:00:07.000Z"),
      endsAt: new Date("2026-11-21T02:59:59.000Z"),
      windowInZone: true,
    });
    const { call, writes } = surface(zoned, { storeTimeZone: () => SP });
    await call("PATCH", { ...BODY, ...(await readDays(call)) });
    expect(writes[0]!.write.scalars).toMatchObject({ startsAt: zoned.startsAt, endsAt: zoned.endsAt, windowInZone: true });
  });
});

describe("keepWindow on a create (B3)", () => {
  it("is ignored: the dates sent are stored as whole days, never refused or kept", async () => {
    const { call, created } = surface(LEGACY, { storeTimeZone: () => SP });
    const response = await call("POST", { ...BODY, keepWindow: true, startsAt: "2026-12-01", endsAt: "2026-12-05" });
    expect(response.status).toBe(200);
    expect(created).toHaveLength(1);
    expect(created[0]!.scalars.startsAt?.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(created[0]!.scalars.endsAt?.toISOString()).toBe("2026-12-06T03:00:00.000Z");
    expect(created[0]!.scalars.windowInZone).toBe(true);
  });
});
