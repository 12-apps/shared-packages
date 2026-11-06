import { describe, expect, it, vi } from "vitest";

import { EN_US_DISCOUNTS_SERVER_COPY } from "../en-US";
import { updateDiscountBody } from "../mcp";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { createApiDiscounts, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4482, review round 5 (B2): the store's zone is not one the runtime knows,
 * so a rule written in it reads `daysUnknown` and its form cannot show its
 * days. An edit is never refused for that: the form sends `keepWindow: true`
 * and no dates, and the server writes every other field over the STORED
 * window and flag, without asking the zone anything. A write that does send
 * dates in that zone cannot be placed; it is the one refusal left, a 422 on the
 * date field — never on the edit.
 */

const STARTS = new Date("2026-11-09T15:00:00.000Z");
const ENDS = new Date("2026-11-20T15:00:00.000Z");

const ROW: DiscountRecord = {
  id: "d1",
  name: "Semana",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  amountOffCents: null,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: null,
  startsAt: STARTS,
  endsAt: ENDS,
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
};

const BODY = {
  name: "Semana",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  stackable: true,
  active: true,
};

function patch(body: Record<string, unknown>, row: DiscountRecord | null = ROW, extra: Partial<DiscountsApiConfig> = {}) {
  const writes: { write: DiscountWrite; condition: DiscountUpdateCondition | undefined }[] = [];
  const zone = vi.fn(() => "Not/A_Zone");
  const store = {
    get: vi.fn(async () => row),
    update: async (_c: string, _i: string, write: DiscountWrite, condition?: DiscountUpdateCondition) => {
      writes.push({ write, condition });
      return { applied: true };
    },
  } as unknown as DiscountStore;
  const { routes } = createApiDiscounts({
    store,
    copy: PT_BR_DISCOUNTS_SERVER_COPY,
    logger: recordingLogger(),
    storeTimeZone: zone,
    ...extra,
  });
  const route = routes.find((entry) => entry.method === "PATCH")!;
  const response = route.handle({ actor: { clientId: "tenant-1" }, params: { id: "d1" }, query: {}, body });
  return { response, writes, zone };
}

describe("keepWindow while the store's zone is unknown (review round 5, B2)", () => {
  it.each([
    ["a pause", { active: false }, { active: false }],
    ["a rename", { name: "Semana nova" }, { name: "Semana nova" }],
    ["a new value", { percentOffBp: 2_000 }, { percentOffBp: 2_000 }],
  ])("saves %s over the stored window and flag", async (_what, change, expected) => {
    const { response, writes } = patch({ ...BODY, ...change, keepWindow: true });
    expect((await response).status).toBe(200);
    expect(writes).toHaveLength(1);
    const { scalars } = writes[0]!.write;
    expect(scalars).toMatchObject({ ...expected, windowInZone: true });
    expect(scalars.startsAt).toEqual(STARTS);
    expect(scalars.endsAt).toEqual(ENDS);
    expect(writes[0]!.condition).toEqual({ window: { startsAt: STARTS, endsAt: ENDS, windowInZone: true } });
  });

  // Review round 6 (N1): edited on purpose. Keeping the window and sending a
  // date is two answers to one question; dropping the date in silence would
  // lose an edit, so the combination is refused and named.
  it.each([
    ["Início", { startsAt: "2026-12-01", endsAt: null }],
    ["Término", { startsAt: "", endsAt: "2026-12-01" }],
  ])("refuses the marker beside %s with a 422 naming the combination", async (_which, dates) => {
    const { response, writes } = patch({ ...BODY, keepWindow: true, ...dates });
    expect(await response).toEqual({
      status: 422,
      body: {
        error: PT_BR_DISCOUNTS_SERVER_COPY.keepWindowWithDates,
        issues: { keepWindow: PT_BR_DISCOUNTS_SERVER_COPY.keepWindowWithDates },
      },
    });
    expect(writes).toEqual([]);
  });

  it("says that refusal in the package's en-US pack when the host's pack lacks it", async () => {
    const without = { ...EN_US_DISCOUNTS_SERVER_COPY, keepWindowWithDates: undefined };
    const { response } = patch({ ...BODY, keepWindow: true, startsAt: "2026-12-01" }, ROW, { copy: without });
    expect((await response).body).toMatchObject({ issues: { keepWindow: EN_US_DISCOUNTS_SERVER_COPY.keepWindowWithDates } });
  });

  it("takes blank dates beside the marker as none", async () => {
    const { response, writes } = patch({ ...BODY, keepWindow: true, startsAt: "", endsAt: null });
    expect((await response).status).toBe(200);
    expect(writes[0]!.write.scalars).toMatchObject({ startsAt: STARTS, endsAt: ENDS, windowInZone: true });
  });

  it("keeps the window with the zone known, and with it off, alike", async () => {
    for (const extra of [{ storeTimeZone: () => "America/Sao_Paulo" }, { storeTimeZone: undefined }]) {
      const { response, writes } = patch({ ...BODY, active: false, keepWindow: true }, ROW, extra);
      expect((await response).status).toBe(200);
      expect(writes[0]!.write.scalars).toMatchObject({ windowInZone: true, startsAt: STARTS, endsAt: ENDS });
    }
  });

  it("answers the plain not-found for a row that is gone, and writes nothing", async () => {
    const { response, writes } = patch({ ...BODY, keepWindow: true }, null);
    expect(await response).toMatchObject({ status: 404, body: { error: PT_BR_DISCOUNTS_SERVER_COPY.notFound } });
    expect(writes).toEqual([]);
  });

  it("is part of the advertised update body", () => {
    expect(updateDiscountBody.parse({ ...BODY, keepWindow: true })).toMatchObject({ keepWindow: true });
  });
});

describe("dates the server cannot place (review round 5, B2)", () => {
  it("refuses them on the date field, with a sentence — never a 500", async () => {
    const { response, writes } = patch({ ...BODY, startsAt: "2026-11-10", endsAt: "2026-11-20" });
    expect(await response).toMatchObject({
      status: 422,
      body: { issues: { startsAt: PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone } },
    });
    expect(writes).toEqual([]);
  });

  it("names Término when only Término is sent", async () => {
    const { response } = patch({ ...BODY, startsAt: null, endsAt: "2026-11-20" });
    expect(await response).toMatchObject({ status: 422, body: { issues: { endsAt: PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone } } });
  });

  it("needs the sentence at the mount once the zone is passed", () => {
    const store = {} as DiscountStore;
    expect(() =>
      createApiDiscounts({
        store,
        copy: { ...EN_US_DISCOUNTS_SERVER_COPY, datesNeedKnownZone: undefined },
        logger: recordingLogger(),
        storeTimeZone: () => "America/Sao_Paulo",
      }),
    ).toThrow(/datesNeedKnownZone/u);
  });
});
