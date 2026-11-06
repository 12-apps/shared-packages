import { describe, expect, it, vi } from "vitest";

import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4482, the ROLLBACK direction (review round 5). Release N+1 counts whole
 * days (`storeTimeZone`) and flags what it writes; roll back to N, which runs
 * with the zone off, and N cannot place a flagged row's days. An edit is never
 * refused for it: a pause, a rename or a new value with the dates the zone-off
 * form showed keeps the stored window and the flag; new dates are stored as
 * legacy, as any write of N stores them, and the id is logged so the
 * migration's rerun converts the row. Every write that copied what it read is
 * conditional on the row still holding it.
 */

const BODY = {
  name: "Semana",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  stackable: true,
  active: true,
  // The UTC dates of the stored bounds — what the zone-off form shows.
  startsAt: "2026-11-10",
  endsAt: "2026-11-21",
};

const STARTS = new Date("2026-11-10T03:00:00.000Z");
const ENDS = new Date("2026-11-21T03:00:00.000Z");

function stored(windowInZone: boolean | undefined, window = { startsAt: STARTS, endsAt: ENDS }): DiscountRecord {
  const row: DiscountRecord = {
    id: "d1",
    name: "Semana",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    ...window,
    windowInZone,
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
  if (windowInZone === undefined) delete row.windowInZone;
  return row;
}

type Applied = { applied: boolean } | undefined;

function patch(
  rows: DiscountRecord | null | (DiscountRecord | null)[],
  options: { extra?: Partial<DiscountsApiConfig>; body?: Record<string, unknown>; applied?: Applied[] } = {},
) {
  const writes: { write: DiscountWrite; condition: DiscountUpdateCondition | undefined }[] = [];
  const reads = Array.isArray(rows) ? [...rows] : [rows];
  const get = vi.fn(async () => (reads.length > 1 ? reads.shift()! : reads[0]!));
  const outcomes = [...(options.applied ?? [])];
  const store = {
    get,
    update: async (_clientId: string, _id: string, write: DiscountWrite, condition?: DiscountUpdateCondition) => {
      writes.push({ write, condition });
      return outcomes.length > 1 ? outcomes.shift() : outcomes[0];
    },
  } as unknown as DiscountStore;
  const recorder = recordingLogger();
  const { routes } = createApiDiscounts({ store, copy: PT_BR_DISCOUNTS_SERVER_COPY, logger: recorder, ...options.extra });
  const update = routes.find((entry) => entry.method === "PATCH")!;
  const response = update.handle({
    actor: { clientId: "tenant-1" },
    params: { id: "d1" },
    query: {},
    body: { ...BODY, ...options.body },
  });
  return { response, writes, get, log: recorder };
}

const applied = { applied: true };

describe("a write with the zone off on a row written in the zone (review round 5)", () => {
  it("pauses with unchanged dates: 200, the stored window and the flag kept", async () => {
    const { response, writes } = patch(stored(true), { body: { active: false }, applied: [applied] });
    expect((await response).status).toBe(200);
    expect(writes).toHaveLength(1);
    const { scalars } = writes[0]!.write;
    expect(scalars).toMatchObject({ active: false, windowInZone: true });
    expect(scalars.startsAt).toEqual(STARTS);
    expect(scalars.endsAt).toEqual(ENDS);
  });

  it("renames and changes the value the same way", async () => {
    const { response, writes } = patch(stored(true), { body: { name: "Semana nova", percentOffBp: 1_500 }, applied: [applied] });
    expect((await response).status).toBe(200);
    expect(writes[0]!.write.scalars).toMatchObject({ name: "Semana nova", percentOffBp: 1_500, windowInZone: true });
    expect(writes[0]!.write.scalars.endsAt).toEqual(ENDS);
  });

  it("keeps an open bound open: null against null is unchanged", async () => {
    const row = stored(true, { startsAt: STARTS, endsAt: null as unknown as Date });
    const { response, writes } = patch(row, { body: { endsAt: null }, applied: [applied] });
    expect((await response).status).toBe(200);
    expect(writes[0]!.write.scalars).toMatchObject({ windowInZone: true, endsAt: null });
    expect(writes[0]!.write.scalars.startsAt).toEqual(STARTS);
  });

  it("stores changed dates as legacy, as N's create would, and logs the id for the rerun", async () => {
    const result = patch(stored(true), { body: { endsAt: "2026-11-25" }, applied: [applied] });
    const { response, writes } = result;
    expect((await response).status).toBe(200);
    const { scalars } = writes[0]!.write;
    expect(scalars.windowInZone).toBe(false);
    expect(scalars.startsAt?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(scalars.endsAt?.toISOString()).toBe("2026-11-25T00:00:00.000Z");
    const named = result.log.at("warn").filter((line) => line.includes("rule d1"));
    expect(named.join("\n")).toMatch(/stored as legacy[^]*rerun the migration/u);
  });

  it("never answers 422 for the zone, whatever the dates", async () => {
    for (const body of [{}, { startsAt: "2026-11-01" }, { startsAt: null, endsAt: null }]) {
      const { response } = patch(stored(true), { body, applied: [applied] });
      expect((await response).status).toBe(200);
    }
  });

  it.each([false, undefined])("still re-states a row whose flag is %j, on UTC midnights", async (flag) => {
    const { response, writes } = patch(stored(flag), { applied: [applied] });
    expect((await response).status).toBe(200);
    expect(writes[0]?.write.scalars).toMatchObject({ windowInZone: false });
    expect(writes[0]?.write.scalars.startsAt?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("leaves a missing row to the store, as before, with no condition", async () => {
    const { response, writes } = patch(null);
    expect((await response).status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.condition).toBeUndefined();
  });

  it("asks the store nothing extra while the zone is on", async () => {
    const { response, writes, get } = patch(stored(true), { extra: { storeTimeZone: () => "America/Sao_Paulo" } });
    expect((await response).status).toBe(200);
    expect(get).not.toHaveBeenCalled();
    expect(writes[0]?.write.scalars.windowInZone).toBe(true);
    expect(writes[0]?.condition).toBeUndefined();
  });
});

describe("the read-then-write race (review round 5)", () => {
  it("writes only where the row still holds the window and the flag it read", async () => {
    const { response, writes } = patch(stored(true), { body: { active: false }, applied: [applied] });
    await response;
    expect(writes[0]!.condition).toEqual({ window: { startsAt: STARTS, endsAt: ENDS, windowInZone: true } });
  });

  it("conditions a legacy row's write on its flag staying false", async () => {
    const { response, writes } = patch(stored(false), { applied: [applied] });
    await response;
    expect(writes[0]!.condition).toEqual({ window: { startsAt: STARTS, endsAt: ENDS, windowInZone: false } });
  });

  it("re-reads and decides again when the condition did not hold", async () => {
    // Read as legacy; a zoned write flags it in between; the second read decides.
    const moved = stored(true, { startsAt: STARTS, endsAt: ENDS });
    const { response, writes, get } = patch([stored(false), moved], {
      body: { active: false },
      applied: [{ applied: false }, applied],
    });
    expect((await response).status).toBe(200);
    expect(get).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.write.scalars).toMatchObject({ windowInZone: true, active: false });
    expect(writes[1]!.condition?.window.windowInZone).toBe(true);
  });

  it("gives up loudly, never silently, when the row keeps moving", async () => {
    const { response, writes } = patch(stored(true), { applied: [{ applied: false }] });
    await expect(response).rejects.toThrow(/changed/u);
    expect(writes.length).toBeGreaterThan(1);
  });

  it("says so when the store answers nothing about the condition", async () => {
    const { response, log } = patch(stored(true), { applied: [undefined] });
    expect((await response).status).toBe(200);
    expect(log.at("warn").some((line) => /condition/u.test(line))).toBe(true);
  });
});

describe("a store with no windowInZone while the zone is off (review round 5)", () => {
  it("warns that the guard cannot tell a zoned rule, and saves", async () => {
    const { response, log } = patch(stored(undefined), { applied: [applied] });
    expect((await response).status).toBe(200);
    expect(log.at("warn").some((line) => line.includes("windowInZone") && line.includes("storeTimeZone is off"))).toBe(true);
  });

  it("says nothing when the store maps the column", async () => {
    const { response, log } = patch(stored(false), { applied: [applied] });
    await response;
    expect(log.at("warn").filter((line) => line.includes("windowInZone"))).toEqual([]);
  });
});

describe("the order of the checks (review round 5, N6)", () => {
  it("validates the body before it asks the store for the row", async () => {
    const { response, get, writes } = patch(stored(true), { body: { percentOffBp: null } });
    expect(await response).toMatchObject({ status: 422, body: { issues: { percentOff: PT_BR_DISCOUNTS_SERVER_COPY.invalidPercent } } });
    expect(get).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("checks the targets are the tenant's before it asks the store for the row", async () => {
    const foreign = {
      targetType: "CATEGORY" as const,
      slug: "categories",
      label: "Categorias",
      nests: false,
      ops: { list: async () => [], ownsAll: async () => false, parents: async () => new Map() },
    };
    const { response, get, writes } = patch(stored(true), {
      extra: { collections: [foreign] },
      body: { scope: "CATEGORY", categoryIds: ["c-other"] },
    });
    expect((await response).status).toBe(422);
    expect(get).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
