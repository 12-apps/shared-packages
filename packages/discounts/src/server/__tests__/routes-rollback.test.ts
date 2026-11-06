import { describe, expect, it, vi } from "vitest";

import { EN_US_DISCOUNTS_SERVER_COPY } from "../en-US";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4482, review round 4: the ROLLBACK direction. Release N+1 counts whole
 * days (`storeTimeZone`) and flags what it writes; roll back to N, which runs
 * with the zone off, and N cannot place a flagged row's days. Reading one is
 * harmless — the engine prices instants, and N answers them as they are — but
 * re-saving one would store UTC midnights under `windowInZone: false`, a day's
 * shift once N+1 is back. So with the zone off, a write refuses to un-flag a
 * flagged row, and says so on Início.
 */

const BODY = {
  name: "Semana",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  stackable: true,
  active: true,
  startsAt: "2026-11-10",
  endsAt: "2026-11-21",
};

function stored(windowInZone: boolean | undefined): DiscountRecord {
  const row: DiscountRecord = {
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

function patch(row: DiscountRecord | null, extra: Partial<DiscountsApiConfig> = {}, locale?: string) {
  const writes: DiscountWrite[] = [];
  const get = vi.fn(async () => row);
  const store = {
    get,
    update: async (_clientId: string, _id: string, write: DiscountWrite) => void writes.push(write),
  } as unknown as DiscountStore;
  const { routes } = createApiDiscounts({ store, copy: PT_BR_DISCOUNTS_SERVER_COPY, logger: recordingLogger(), ...extra });
  const update = routes.find((entry) => entry.method === "PATCH")!;
  const response = update.handle({ actor: { clientId: "tenant-1" }, params: { id: "d1" }, query: {}, locale, body: BODY });
  return { response, writes, get };
}

describe("a write with the zone off on a row written in the zone (FUT-4482, review round 4)", () => {
  it("refuses to un-flag it, on Início, and writes nothing", async () => {
    const { response, writes } = patch(stored(true));
    expect(await response).toMatchObject({
      status: 422,
      body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.zonedWindowNeedsZone } },
    });
    expect(writes).toEqual([]);
  });

  it.each([false, undefined])("still re-states a row whose flag is %j, on UTC midnights", async (flag) => {
    const { response, writes } = patch(stored(flag));
    expect((await response).status).toBe(200);
    expect(writes[0]?.scalars).toMatchObject({ windowInZone: false });
    expect(writes[0]?.scalars.startsAt?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("leaves a missing row to the store, as before", async () => {
    const { response, writes } = patch(null);
    expect((await response).status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it("says the reader's own sentence, else the default rendering's", async () => {
    const without = { ...EN_US_DISCOUNTS_SERVER_COPY, zonedWindowNeedsZone: undefined };
    const own = patch(stored(true), { copy: ({ locale }) => (locale === "en-US" ? EN_US_DISCOUNTS_SERVER_COPY : PT_BR_DISCOUNTS_SERVER_COPY) }, "en-US");
    expect(await own.response).toMatchObject({ body: { issues: { startsAt: EN_US_DISCOUNTS_SERVER_COPY.zonedWindowNeedsZone } } });
    const fallback = patch(stored(true), { copy: ({ locale }) => (locale === "en-US" ? without : PT_BR_DISCOUNTS_SERVER_COPY) }, "en-US");
    expect(await fallback.response).toMatchObject({ body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.zonedWindowNeedsZone } } });
  });

  it("still refuses, loudly, when no pack has the sentence — never un-flags", async () => {
    const { response, writes } = patch(stored(true), { copy: { ...PT_BR_DISCOUNTS_SERVER_COPY, zonedWindowNeedsZone: undefined } });
    await expect(response).rejects.toThrow(/zonedWindowNeedsZone/u);
    expect(writes).toEqual([]);
  });

  it("asks the store nothing extra while the zone is on", async () => {
    const { response, writes, get } = patch(stored(true), { storeTimeZone: () => "America/Sao_Paulo" });
    expect((await response).status).toBe(200);
    expect(get).not.toHaveBeenCalled();
    expect(writes[0]?.scalars.windowInZone).toBe(true);
  });
});
