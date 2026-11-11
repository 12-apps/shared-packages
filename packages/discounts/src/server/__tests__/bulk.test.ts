import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import type { DiscountsServerCopy } from "../copy";
import { createApiDiscounts, type DiscountsApiConfig } from "../routes";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "../store";
import { recordingLogger } from "./recording-logger";

/**
 * FUT-4420: the bulk route. "Now" is 2026-11-12 12:00 in Sao Paulo, so
 * "today" there is 2026-11-12 and an end of 2026-11-12T03:00Z (the end of
 * the 11th) has ended.
 */

const SP = "America/Sao_Paulo";
const NOW = new Date("2026-11-12T15:00:00.000Z");

function record(id: string, overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id,
    name: `Desconto ${id}`,
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: new Date("2026-11-01T03:00:00.000Z"),
    // Last day 2026-11-20, whole days in SP.
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
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

const sameInstant = (a: Date | null, b: Date | null): boolean => (a?.getTime() ?? null) === (b?.getTime() ?? null);

function memoryStore(rows: DiscountRecord[], hooks: { beforeUpdate?: (id: string) => void } = {}) {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]));
  const updates: { id: string; write: DiscountWrite; condition?: DiscountUpdateCondition }[] = [];
  const store: DiscountStore = {
    list: async () => {
      throw new Error("unused");
    },
    get: async (_client, id) => (byId.has(id) ? { ...byId.get(id)! } : null),
    create: async () => {
      throw new Error("unused");
    },
    update: async (_client, id, write, condition) => {
      hooks.beforeUpdate?.(id);
      const row = byId.get(id)!;
      const holds =
        condition === undefined ||
        (sameInstant(row.startsAt, condition.window.startsAt) &&
          sameInstant(row.endsAt, condition.window.endsAt) &&
          (row.windowInZone === true) === condition.window.windowInZone &&
          (condition.active === undefined || row.active === condition.active));
      if (!holds) return { applied: false };
      updates.push({ id, write, ...(condition ? { condition } : {}) });
      Object.assign(row, {
        active: write.scalars.active,
        startsAt: write.scalars.startsAt,
        endsAt: write.scalars.endsAt,
        windowInZone: write.scalars.windowInZone,
      });
      return { applied: true };
    },
    archive: async () => {},
  };
  return { store, byId, updates };
}

function harness(rows: DiscountRecord[], extra: Partial<DiscountsApiConfig> = {}, hooks = {}) {
  const memory = memoryStore(rows, hooks);
  const logger = recordingLogger();
  const { routes } = createApiDiscounts({
    store: memory.store,
    copy: PT_BR_DISCOUNTS_SERVER_COPY,
    logger,
    storeTimeZone: () => SP,
    ...extra,
  });
  const route = routes.find((entry) => entry.method === "POST" && entry.path === "/discounts/bulk")!;
  const call = (body: unknown, locale?: string) =>
    route.handle({ actor: { clientId: "tenant-1" }, params: {}, query: {}, body, ...(locale ? { locale } : {}) });
  return { ...memory, call, route, logger };
}

interface Answer {
  status: number;
  body: { data: { counts: Record<string, number>; rows: Record<string, unknown>[] }; problems?: unknown[]; error?: string };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("POST /discounts/bulk", () => {
  it("is guarded by the single-row edit's permission", () => {
    expect(harness([]).route.permission).toBe("discounts:write");
  });

  describe("setActive", () => {
    it("changes the rows that differ and counts the ones that already held the value as unchanged", async () => {
      const { call, byId } = harness([record("a", { active: false }), record("b", { active: true })]);
      const answer = (await call({ operation: "setActive", ids: ["a", "b"], active: true })) as Answer;
      expect(answer.status).toBe(200);
      expect(answer.body.data.counts).toEqual({ ok: 1, unchanged: 1, skipped: 0, failed: 0 });
      expect(answer.body.data.rows[0]).toMatchObject({ id: "a", status: "ok", code: "activated", retryable: false });
      expect(answer.body.data.rows[1]).toMatchObject({ id: "b", status: "unchanged", code: "alreadyActive", message: "Já estava ativo." });
      expect(byId.get("a")?.active).toBe(true);
    });

    it("reports before and after exactly, for Desfazer", async () => {
      const { call } = harness([record("a", { active: true })]);
      const answer = (await call({ operation: "setActive", ids: ["a"], active: false })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({
        before: { active: true, endsAt: "2026-11-21T03:00:00.000Z", windowInZone: true },
        after: { active: false, endsAt: "2026-11-21T03:00:00.000Z", windowInZone: true },
      });
    });

    it("writes under the window AND the active flag it read", async () => {
      const { call, updates } = harness([record("a", { active: false })]);
      await call({ operation: "setActive", ids: ["a"], active: true });
      expect(updates[0]?.condition?.active).toBe(false);
      expect(updates[0]?.condition?.window.windowInZone).toBe(true);
    });

    it("re-reads a row changed between the read and the write, and does not overwrite it", async () => {
      let flipped = false;
      const { call, byId } = harness([record("a", { active: false })], {}, {
        beforeUpdate: (id: string) => {
          // Somebody else activates it between the batch's read and write.
          if (!flipped) {
            flipped = true;
            byId.get(id)!.active = true;
          }
        },
      });
      const answer = (await call({ operation: "setActive", ids: ["a"], active: true })) as Answer;
      // The second read finds it already active: unchanged, not a clobbering write.
      expect(answer.body.data.rows[0]).toMatchObject({ status: "unchanged", code: "alreadyActive" });
    });

    it("fails a row that keeps moving, retryable", async () => {
      let toggles = 0;
      const { call, byId } = harness([record("a", { active: false })], {}, {
        beforeUpdate: (id: string) => {
          toggles += 1;
          byId.get(id)!.endsAt = new Date(Date.UTC(2027, 0, toggles));
        },
      });
      const answer = (await call({ operation: "setActive", ids: ["a"], active: true })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "failed", code: "changedDuringBatch", retryable: true });
    });

    it("skips an id that no longer exists, and goes on", async () => {
      const { call } = harness([record("a", { active: false })]);
      const answer = (await call({ operation: "setActive", ids: ["gone", "a"], active: true })) as Answer;
      expect(answer.body.data.rows.map((row) => row.status)).toEqual(["skipped", "ok"]);
      expect(answer.body.data.rows[0]).toMatchObject({ code: "notFound", retryable: false });
    });

    it("reports a row the store threw on as failed and runs the rest", async () => {
      const { call, logger } = harness([record("a", { active: false }), record("b", { active: false })], {}, {
        beforeUpdate: (id: string) => {
          if (id === "a") throw new Error("connection reset");
        },
      });
      const answer = (await call({ operation: "setActive", ids: ["a", "b"], active: true })) as Answer;
      expect(answer.body.data.rows.map((row) => row.status)).toEqual(["failed", "ok"]);
      expect(logger.at("error").join("\n")).toContain("connection reset");
    });

    it("validateOnly writes nothing and says what would happen", async () => {
      const { call, updates, byId } = harness([record("a", { active: false })]);
      const answer = (await call({ operation: "setActive", ids: ["a"], active: true, validateOnly: true })) as Answer;
      expect(answer.body.data.rows[0]?.status).toBe("ok");
      expect(updates).toHaveLength(0);
      expect(byId.get("a")?.active).toBe(false);
    });

    it("de-duplicates ids and answers once per discount", async () => {
      const { call } = harness([record("a", { active: false })]);
      const answer = (await call({ operation: "setActive", ids: ["a", "a"], active: true })) as Answer;
      expect(answer.body.data.rows).toHaveLength(1);
    });
  });

  describe("extendWindow", () => {
    it("adds days to the current end day, as whole days on the store's clock", async () => {
      const { call, byId } = harness([record("a")]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], days: 7 })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "ok", code: "extended", endsOn: "2026-11-27" });
      // Last day 27/11 whole: the first instant of the 28th in Sao Paulo.
      expect(byId.get("a")?.endsAt?.toISOString()).toBe("2026-11-28T03:00:00.000Z");
      expect(byId.get("a")?.startsAt?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
      expect(byId.get("a")?.active).toBe(true);
    });

    it("counts an ended discount from today, re-activates it and says it is valid again", async () => {
      // Ended: last day 2026-11-05.
      const ended = record("a", { active: false, endsAt: new Date("2026-11-06T03:00:00.000Z") });
      const { call, byId } = harness([ended]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], days: 3 })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({
        status: "ok",
        code: "revived",
        revived: true,
        endsOn: "2026-11-15",
        message: "Estava encerrado: voltou a valer.",
      });
      expect(byId.get("a")?.active).toBe(true);
      expect(byId.get("a")?.endsAt?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    });

    it("does not activate a paused discount that has not ended", async () => {
      const { call, byId } = harness([record("a", { active: false })]);
      await call({ operation: "extendWindow", ids: ["a"], days: 1 });
      expect(byId.get("a")?.active).toBe(false);
    });

    it("skips a discount with no end date, never retryable", async () => {
      const { call, updates } = harness([record("a", { endsAt: null })]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], days: 5 })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "skipped", code: "noEndDate", retryable: false });
      expect(answer.body.data.rows[0]?.message).toContain("Sem data de fim");
      expect(updates).toHaveLength(0);
    });

    it("sets a new last day with endsOn", async () => {
      const { call, byId } = harness([record("a")]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], endsOn: "2026-12-31" })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "ok", endsOn: "2026-12-31" });
      expect(byId.get("a")?.endsAt?.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    });

    it("leaves a discount that already ends on the new day as unchanged", async () => {
      const { call } = harness([record("a")]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], endsOn: "2026-11-20" })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "unchanged", code: "alreadyEndsThen" });
    });

    it("skips a new day that is not after the current end", async () => {
      const { call } = harness([record("a")]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], endsOn: "2026-11-15" })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "skipped", code: "notLater" });
    });

    it("skips an ended discount whose new day is still in the past", async () => {
      const { call } = harness([record("a", { endsAt: new Date("2026-11-06T03:00:00.000Z") })]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], endsOn: "2026-11-08" })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "skipped", code: "stillEnded" });
    });

    it("converts a legacy UTC window to whole days, as an edit of its dates does", async () => {
      const legacy = record("a", {
        windowInZone: false,
        startsAt: new Date("2026-11-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-21T00:00:00.000Z"),
      });
      const { call, byId } = harness([legacy]);
      const answer = (await call({ operation: "extendWindow", ids: ["a"], days: 2 })) as Answer;
      expect(answer.body.data.rows[0]?.status).toBe("ok");
      expect(byId.get("a")?.windowInZone).toBe(true);
      // Legacy shows 2026-11-21 as its Termino; +2 is the 23rd, whole.
      expect(byId.get("a")?.endsAt?.toISOString()).toBe("2026-11-24T03:00:00.000Z");
    });

    it("counts UTC days when the host counts none", async () => {
      const legacy = record("a", {
        windowInZone: false,
        startsAt: new Date("2026-11-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-21T00:00:00.000Z"),
      });
      const { call, byId } = harness([legacy], { storeTimeZone: undefined });
      await call({ operation: "extendWindow", ids: ["a"], days: 2 });
      expect(byId.get("a")?.endsAt?.toISOString()).toBe("2026-11-23T00:00:00.000Z");
      expect(byId.get("a")?.windowInZone).toBe(false);
    });

    it("skips every row while the store's zone is unknown", async () => {
      const { call, updates } = harness([record("a")], { storeTimeZone: () => "Mars/Olympus" });
      const answer = (await call({ operation: "extendWindow", ids: ["a"], days: 2 })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "skipped", code: "zoneUnknown" });
      expect(updates).toHaveLength(0);
    });

    it("answers in English for an English caller whose pack says no bulk sentence", async () => {
      const withoutBulk = Object.fromEntries(
        Object.entries(PT_BR_DISCOUNTS_SERVER_COPY).filter(([key]) => key !== "bulk"),
      ) as unknown as DiscountsServerCopy;
      const { call } = harness([record("a", { endsAt: null })], { copy: withoutBulk });
      const answer = (await call({ operation: "extendWindow", ids: ["a"], days: 2 }, "en-US")) as Answer;
      expect(answer.body.data.rows[0]?.message).toBe("No end date: nothing to extend.");
    });

    it("uses a host pack's own bulk sentence and fills the rest from the package", async () => {
      const copy = { ...PT_BR_DISCOUNTS_SERVER_COPY, bulk: { noEndDate: "Sem fim." } };
      const { call } = harness([record("a", { endsAt: null }), record("b", { active: true })], { copy });
      const answer = (await call({ operation: "setActive", ids: ["b"], active: true })) as Answer;
      expect(answer.body.data.rows[0]?.message).toBe("Já estava ativo.");
      const extended = (await call({ operation: "extendWindow", ids: ["a"], days: 1 })) as Answer;
      expect(extended.body.data.rows[0]?.message).toBe("Sem fim.");
    });
  });

  describe("undo", () => {
    it("restores exactly the rows the batch changed", async () => {
      const { call, byId } = harness([record("a", { active: false }), record("b", { active: true })]);
      const done = (await call({ operation: "setActive", ids: ["a", "b"], active: true })) as Answer;
      const changed = done.body.data.rows.filter((row) => row.status === "ok");
      const answer = (await call({
        operation: "undo",
        rows: changed.map((row) => ({ id: row.id, before: row.before, after: row.after })),
      })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ id: "a", status: "ok", code: "restored" });
      expect(byId.get("a")?.active).toBe(false);
      // The row that already held the value was never offered, and keeps its flag.
      expect(byId.get("b")?.active).toBe(true);
    });

    it("restores the previous end date of an extension, revived flag included", async () => {
      const ended = record("a", { active: false, endsAt: new Date("2026-11-06T03:00:00.000Z") });
      const { call, byId } = harness([ended]);
      const done = (await call({ operation: "extendWindow", ids: ["a"], days: 3 })) as Answer;
      const row = done.body.data.rows[0]!;
      await call({ operation: "undo", rows: [{ id: "a", before: row.before, after: row.after }] });
      expect(byId.get("a")?.active).toBe(false);
      expect(byId.get("a")?.endsAt?.toISOString()).toBe("2026-11-06T03:00:00.000Z");
    });

    it("leaves a row changed after the batch as it is, and says why", async () => {
      const { call, byId } = harness([record("a", { active: false })]);
      const done = (await call({ operation: "setActive", ids: ["a"], active: true })) as Answer;
      const row = done.body.data.rows[0]!;
      byId.get("a")!.endsAt = new Date("2027-05-05T03:00:00.000Z");
      const answer = (await call({ operation: "undo", rows: [{ id: "a", before: row.before, after: row.after }] })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "skipped", code: "changedSince", retryable: false });
      expect(byId.get("a")?.active).toBe(true);
      expect(byId.get("a")?.endsAt?.toISOString()).toBe("2027-05-05T03:00:00.000Z");
    });

    it("counts a row somebody already put back as unchanged", async () => {
      const { call, byId } = harness([record("a", { active: false })]);
      const done = (await call({ operation: "setActive", ids: ["a"], active: true })) as Answer;
      const row = done.body.data.rows[0]!;
      byId.get("a")!.active = false;
      const answer = (await call({ operation: "undo", rows: [{ id: "a", before: row.before, after: row.after }] })) as Answer;
      expect(answer.body.data.rows[0]).toMatchObject({ status: "unchanged", code: "alreadyRestored" });
    });
  });

  describe("the body", () => {
    it("refuses more than 500 discounts with a 422 and writes nothing", async () => {
      const { call, updates } = harness([]);
      const ids = Array.from({ length: 501 }, (_, index) => `d${index}`);
      const answer = (await call({ operation: "setActive", ids, active: true })) as Answer;
      expect(answer.status).toBe(422);
      expect(answer.body.error).toContain("500");
      expect(updates).toHaveLength(0);
    });

    it("takes exactly 500", async () => {
      const { call } = harness([]);
      const ids = Array.from({ length: 500 }, (_, index) => `d${index}`);
      expect(((await call({ operation: "setActive", ids, active: true })) as Answer).status).toBe(200);
    });

    it.each([
      ["no operation", { ids: ["a"], active: true }],
      ["unknown key", { operation: "setActive", ids: ["a"], active: true, extra: 1 }],
      ["no ids", { operation: "setActive", ids: [], active: true }],
      ["both days and endsOn", { operation: "extendWindow", ids: ["a"], days: 1, endsOn: "2026-12-01" }],
      ["neither days nor endsOn", { operation: "extendWindow", ids: ["a"] }],
      ["zero days", { operation: "extendWindow", ids: ["a"], days: 0 }],
      ["a fractional number of days", { operation: "extendWindow", ids: ["a"], days: 1.5 }],
      ["a malformed day", { operation: "extendWindow", ids: ["a"], endsOn: "12/01/2026" }],
      ["an undo row without its after", { operation: "undo", rows: [{ id: "a", before: {} }] }],
    ])("refuses %s with a 422 and problems", async (_name, body) => {
      const { call, updates } = harness([record("a")]);
      const answer = (await call(body)) as Answer;
      expect(answer.status).toBe(422);
      expect(Array.isArray(answer.body.problems)).toBe(true);
      expect(updates).toHaveLength(0);
    });

    it("logs one line per batch with the counts and no names", async () => {
      const { call, logger } = harness([record("a", { active: false })]);
      await call({ operation: "setActive", ids: ["a"], active: true });
      const line = logger.at("info").find((message) => message.startsWith("bulk setActive"));
      expect(line).toContain("1 changed, 0 unchanged, 0 skipped, 0 failed");
      expect(line).not.toContain("Desconto");
    });
  });
});
