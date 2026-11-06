import { describe, expect, it } from "vitest";

import { legacyUtcWindowToZoned, windowCalendarDays, wholeDayWindow } from "../../timezone";
import { withCalendarDays, type ReadZone } from "../calendar-days";

/**
 * FUT-4482, review round 3 (B1): a legacy row is told by its own flag,
 * `windowInZone`, never by `updatedAt`. These run the README's migration loop
 * over an in-memory table that behaves like the host's: raw SQL bumps
 * `updated_at` without touching the window, an `updateMany` matches only on its
 * `where`, and the previous release writes UTC windows with the flag false.
 */

interface Row {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  windowInZone: boolean;
  updatedAt: Date;
  usageCount: number;
}

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

class Table {
  rows: Row[];
  writes = 0;
  constructor(rows: Row[]) {
    this.rows = rows.map((row) => ({ ...row }));
  }
  findLegacy(): Row[] {
    return this.rows.filter((row) => !row.windowInZone).map((row) => ({ ...row }));
  }
  /** `updateMany({ where: { id, windowInZone: false }, data })`: the count it matched. */
  updateLegacy(id: string, data: Pick<Row, "startsAt" | "endsAt" | "windowInZone">, now: Date): number {
    const row = this.rows.find((candidate) => candidate.id === id && !candidate.windowInZone);
    if (row === undefined) return 0;
    Object.assign(row, data, { updatedAt: now });
    this.writes += 1;
    return 1;
  }
  /** `discount-usage.ts`'s raw UPDATE: the counter and `updated_at`, never the window. */
  redeem(id: string, now: Date): void {
    const row = this.rows.find((candidate) => candidate.id === id)!;
    row.usageCount += 1;
    row.updatedAt = now;
  }
}

/** The README's loop; `failAfter` writes in, it throws as a crashed run would. */
function migrate(table: Table, zone: string, now: Date, failAfter = Infinity): void {
  const before = table.writes;
  for (const rule of table.findLegacy()) {
    const migrated = legacyUtcWindowToZoned(rule, zone);
    if (migrated === null) continue;
    if (table.writes - before === failAfter) throw new Error("run died");
    table.updateLegacy(rule.id, migrated, now);
  }
}

const daysIn = (table: Table, zone: string) =>
  table.rows.map((row) => withCalendarDays(row, { kind: "zone", timeZone: zone }));

const LONDON = "Europe/London";
/** The instant the release that passes `storeTimeZone` went out, as epoch ms. */
const RELEASE_MS = Date.parse("2026-12-01T12:00:00.000Z");

const londonTable = (): Table =>
  new Table([
    { id: "a", startsAt: day("2026-12-10"), endsAt: day("2026-12-20"), windowInZone: false, updatedAt: day("2026-11-20"), usageCount: 0 },
    { id: "b", startsAt: day("2026-12-05"), endsAt: day("2026-12-06"), windowInZone: false, updatedAt: day("2026-11-21"), usageCount: 0 },
  ]);

describe("the migration, rerun in London (UTC+0: a migrated window is still two UTC midnights)", () => {
  it("converts each row once: a second run writes nothing and moves nothing", () => {
    const table = londonTable();
    migrate(table, LONDON, new Date("2026-12-02T00:00:00.000Z"));
    const once = structuredClone(table.rows);
    expect(windowCalendarDays(once[0]!.startsAt, once[0]!.endsAt, LONDON)).toEqual({ startsOn: "2026-12-10", endsOn: "2026-12-20" });
    migrate(table, LONDON, new Date("2026-12-03T00:00:00.000Z"));
    expect(table.rows).toEqual(once);
    expect(table.writes).toBe(2);
  });

  it("finishes a run that died half way without moving the row it already wrote", () => {
    const table = londonTable();
    expect(() => migrate(table, LONDON, new Date("2026-12-02T00:00:00.000Z"), 1)).toThrow("run died");
    migrate(table, LONDON, new Date("2026-12-02T01:00:00.000Z"));
    expect(daysIn(table, LONDON).map(({ startsOn, endsOn }) => ({ startsOn, endsOn }))).toEqual([
      { startsOn: "2026-12-10", endsOn: "2026-12-20" },
      { startsOn: "2026-12-05", endsOn: "2026-12-06" },
    ]);
  });

  it("leaves a row another run converted between the read and the write", () => {
    const table = londonTable();
    const stale = table.findLegacy();
    migrate(table, LONDON, new Date("2026-12-02T00:00:00.000Z"));
    const after = structuredClone(table.rows);
    // The first run's stale read, written back under the same condition: no match.
    for (const rule of stale) table.updateLegacy(rule.id, legacyUtcWindowToZoned(rule, LONDON)!, new Date(RELEASE_MS));
    expect(table.rows).toEqual(after);
  });
});

describe("a row redeemed by raw SQL after the release (it bumps updated_at, not the window)", () => {
  it("is still migrated: its flag says legacy, whatever its updatedAt", () => {
    const table = new Table([
      { id: "r", startsAt: day("2026-11-10"), endsAt: day("2026-11-20"), windowInZone: false, updatedAt: day("2026-11-01"), usageCount: 3 },
    ]);
    table.redeem("r", new Date(RELEASE_MS + 60_000));
    migrate(table, "America/Sao_Paulo", new Date(RELEASE_MS + 120_000));
    const [row] = table.rows;
    expect(row!.windowInZone).toBe(true);
    expect(row!.startsAt?.toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(row!.endsAt?.toISOString()).toBe("2026-11-21T03:00:00.000Z");
    expect(row!.usageCount).toBe(4);
  });
});

describe("reading a row by its flag", () => {
  const SP: ReadZone = { kind: "zone", timeZone: "America/Sao_Paulo" };

  it("reads an overlap write of the previous release (UTC window, flag false) on its UTC days", () => {
    // Written during the rollout, after the zone went on: 10/11 to 20/11 as the old form saved it.
    const overlap = { startsAt: day("2026-11-10"), endsAt: day("2026-11-20"), windowInZone: false };
    expect(withCalendarDays(overlap, SP)).toMatchObject({ startsOn: "2026-11-10", endsOn: "2026-11-20" });
    expect(withCalendarDays(overlap, SP)).not.toHaveProperty("daysUnknown");
  });

  it("reads a legacy row on its UTC days even where the zone is unknown", () => {
    const row = { startsAt: day("2026-11-10"), endsAt: null, windowInZone: false };
    expect(withCalendarDays(row, { kind: "unknown" })).toMatchObject({ startsOn: "2026-11-10", endsOn: null });
  });

  it("reads a flagged row in the store's zone", () => {
    const row = { ...wholeDayWindow("2026-11-10", "2026-11-20", "America/Sao_Paulo"), windowInZone: true };
    expect(withCalendarDays(row, SP)).toMatchObject({ startsOn: "2026-11-10", endsOn: "2026-11-20" });
  });

  it("answers a flagged row whose zone is now unknown as daysUnknown, with no days", () => {
    const row = { ...wholeDayWindow("2026-11-10", "2026-11-20", "Asia/Tokyo"), windowInZone: true };
    const read = withCalendarDays(row, { kind: "unknown" });
    expect(read).toMatchObject({ daysUnknown: true });
    expect(read).not.toHaveProperty("startsOn");
    expect(read).not.toHaveProperty("endsOn");
  });

  it("answers the record untouched where the host counts no whole days", () => {
    const row = { startsAt: day("2026-11-10"), endsAt: null, windowInZone: false };
    expect(withCalendarDays(row, { kind: "off" })).toBe(row);
  });
});
