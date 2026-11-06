import { describe, expect, it, vi } from "vitest";

import { DISCOUNTS_MCP_TOOLS } from "../mcp";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4482, review round 8: under an unknown zone the dates are locked and
 * everything else saves. Round 7 wrote a legacy row's changed days as legacy
 * UTC midnights, which lost meaning — a whole-day Término is inclusive, so the
 * last day was dropped, and equal days (a one-day promotion) were refused. So
 * every row reads `datesLocked` then, a legacy one with its UTC days still
 * shown, and a changed date on ANY row is the date-field 422.
 */

const SP = "America/Sao_Paulo";
const UNKNOWN = "Not/A_Zone";

const STARTS = "2026-11-10T00:00:00.000Z";
const ENDS = "2026-11-20T00:00:00.000Z";

function row(window: Partial<Pick<DiscountRecord, "startsAt" | "endsAt" | "windowInZone">>): DiscountRecord {
  return {
    id: "d1",
    name: "Semana",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: new Date(STARTS),
    endsAt: new Date(ENDS),
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

const LEGACY = row({ windowInZone: false });
/** A store that never mapped the column (B3): read as legacy, so locked with its days. */
const UNFLAGGED = row({});

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
  const store = {
    get: vi.fn(async () => stored),
    list: vi.fn(async () => ({
      data: [stored],
      pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
    })),
    update: async (_c: string, _i: string, write: DiscountWrite, condition?: DiscountUpdateCondition) => {
      writes.push({ write, condition });
      return { applied: true };
    },
  } as unknown as DiscountStore;
  const { routes } = createApiDiscounts({ store, copy: PT_BR_DISCOUNTS_SERVER_COPY, logger: recordingLogger(), ...extra });
  const call = (method: "GET" | "PATCH", body?: Record<string, unknown>) => {
    const route = routes.find((entry) => entry.method === method && (method !== "GET" || entry.path === "/discounts/:id"))!;
    return route.handle({ actor: { clientId: "tenant-1" }, params: { id: "d1" }, query: {}, body });
  };
  const list = () =>
    routes.find((entry) => entry.method === "GET" && entry.path === "/discounts")!.handle({
      actor: { clientId: "tenant-1" },
      params: {},
      query: {},
      body: undefined,
    });
  return { call, list, writes };
}

async function readOne(call: ReturnType<typeof surface>["call"]): Promise<Record<string, unknown>> {
  return ((await call("GET")).body as { data: Record<string, unknown> }).data;
}

describe("a read under an unknown zone locks every row's dates", () => {
  it("answers a legacy row with its UTC days AND datesLocked, never daysUnknown", async () => {
    const { call, list } = surface(LEGACY, { storeTimeZone: () => UNKNOWN });
    const data = await readOne(call);
    expect(data).toMatchObject({ startsOn: "2026-11-10", endsOn: "2026-11-20", datesLocked: true });
    expect(data).not.toHaveProperty("daysUnknown");
    const page = (await list()).body as { data: Record<string, unknown>[] };
    expect(page.data[0]).toMatchObject({ startsOn: "2026-11-10", endsOn: "2026-11-20", datesLocked: true });
  });

  it("answers a zoned row daysUnknown and datesLocked, with no days", async () => {
    const zoned = row({ startsAt: new Date("2026-11-10T03:00:00.000Z"), endsAt: new Date("2026-11-21T03:00:00.000Z"), windowInZone: true });
    const data = await readOne(surface(zoned, { storeTimeZone: () => UNKNOWN }).call);
    expect(data).toMatchObject({ daysUnknown: true, datesLocked: true });
    expect(data).not.toHaveProperty("startsOn");
  });

  it("locks nothing under a known zone", async () => {
    expect(await readOne(surface(LEGACY, { storeTimeZone: () => SP }).call)).not.toHaveProperty("datesLocked");
  });
});

describe("a write under an unknown zone", () => {
  it("refuses a legacy row's CHANGED date on the date field, writing nothing", async () => {
    const { call, writes } = surface(LEGACY, { storeTimeZone: () => UNKNOWN });
    expect(await call("PATCH", { ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-25" })).toMatchObject({
      status: 422,
      body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone } },
    });
    expect(writes).toEqual([]);
  });

  it("saves a pause with keepWindow over the stored bounds and flag, byte for byte", async () => {
    const { call, writes } = surface(LEGACY, { storeTimeZone: () => UNKNOWN });
    expect((await call("PATCH", { ...BODY, keepWindow: true })).status).toBe(200);
    const { scalars } = writes[0]!.write;
    expect(scalars.active).toBe(false);
    expect([scalars.startsAt?.toISOString(), scalars.endsAt?.toISOString(), scalars.windowInZone]).toEqual([
      STARTS,
      ENDS,
      false,
    ]);
  });
});

describe("a store row without windowInZone under an unknown zone (B3)", () => {
  it("reads as legacy: its UTC days, locked", async () => {
    const data = await readOne(surface(UNFLAGGED, { storeTimeZone: () => UNKNOWN }).call);
    expect(data).toMatchObject({ startsOn: "2026-11-10", endsOn: "2026-11-20", datesLocked: true });
    expect(data).not.toHaveProperty("daysUnknown");
  });

  it("keeps it legacy on a keepWindow save: flag false in the write and the condition", async () => {
    const { call, writes } = surface(UNFLAGGED, { storeTimeZone: () => UNKNOWN });
    expect((await call("PATCH", { ...BODY, keepWindow: true })).status).toBe(200);
    expect(writes[0]!.write.scalars.windowInZone).toBe(false);
    expect(writes[0]!.condition).toEqual({ window: { startsAt: new Date(STARTS), endsAt: new Date(ENDS), windowInZone: false } });
  });

  it("saves its legacy days sent back unchanged, and refuses them changed", async () => {
    const { call, writes } = surface(UNFLAGGED, { storeTimeZone: () => UNKNOWN });
    expect((await call("PATCH", { ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-20" })).status).toBe(200);
    expect(writes[0]!.write.scalars).toMatchObject({ startsAt: new Date(STARTS), endsAt: new Date(ENDS), windowInZone: false });
    expect((await call("PATCH", { ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-21" })).status).toBe(422);
  });
});

describe("a one-day legacy edit under a KNOWN zone", () => {
  it("still saves zoned: Início = Término is that whole day in the store's zone", async () => {
    const { call, writes } = surface(LEGACY, { storeTimeZone: () => SP });
    expect((await call("PATCH", { ...BODY, startsAt: "2026-11-15", endsAt: "2026-11-15" })).status).toBe(200);
    const { scalars } = writes[0]!.write;
    expect(scalars.windowInZone).toBe(true);
    expect(scalars.startsAt?.toISOString()).toBe("2026-11-15T03:00:00.000Z");
    expect(scalars.endsAt?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
  });
});

describe("the list envelope says the zone is unknown (CP8)", () => {
  // The create form has no row of its own to read the lock off, and the list
  // may be empty (a store's first promotion), so the page itself says it.
  it("carries datesLocked under an unknown zone", async () => {
    const page = (await surface(LEGACY, { storeTimeZone: () => UNKNOWN }).list()).body as Record<string, unknown>;
    expect(page.datesLocked).toBe(true);
  });

  it("keeps it through the advertised response schema, which a wired host parses with", async () => {
    // As it goes over the wire: the instants are strings there.
    const page: unknown = JSON.parse(JSON.stringify((await surface(LEGACY, { storeTimeZone: () => UNKNOWN }).list()).body));
    const listTool = DISCOUNTS_MCP_TOOLS.find((tool) => tool.operationId === "listDiscounts")!;
    expect((listTool.response!.parse(page) as Record<string, unknown>).datesLocked).toBe(true);
  });

  it("carries nothing under a known zone, or without whole days", async () => {
    expect((await surface(LEGACY, { storeTimeZone: () => SP }).list()).body).not.toHaveProperty("datesLocked");
    expect((await surface(LEGACY).list()).body).not.toHaveProperty("datesLocked");
  });
});
