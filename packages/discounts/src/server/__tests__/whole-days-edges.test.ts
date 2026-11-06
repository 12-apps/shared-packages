import { describe, expect, it } from "vitest";

import { legacyUtcWindowToZoned, windowCalendarDays, wholeDayWindow } from "../../timezone";

/**
 * FUT-4482, review round 1: the END bound across a clock change, in a zone
 * whose midnight disappears (Santiago) and one whose 01:00 happens twice (New
 * York), and the migration a host runs before it turns its zone on.
 */

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

describe("Término across a clock change", () => {
  it("ends the day before Santiago's spring-forward at the jump itself (00:00 → 01:00 on 06/09)", () => {
    const window = wholeDayWindow("2026-09-05", "2026-09-05", "America/Santiago");
    // 05/09 starts at 00:00 −04; 06/09 has no 00:00, so it starts at 01:00 −03.
    expect(iso(window.startsAt)).toBe("2026-09-05T04:00:00.000Z");
    expect(iso(window.endsAt)).toBe("2026-09-06T04:00:00.000Z");
    expect(windowCalendarDays(window.startsAt, window.endsAt, "America/Santiago")).toEqual({
      startsOn: "2026-09-05",
      endsOn: "2026-09-05",
    });
  });

  it("runs Santiago's fall-back day whole, 25 hours (04/04 at 00:00 −03 to 05/04 at 00:00 −04)", () => {
    const window = wholeDayWindow("2026-04-04", "2026-04-04", "America/Santiago");
    expect(iso(window.startsAt)).toBe("2026-04-04T03:00:00.000Z");
    expect(iso(window.endsAt)).toBe("2026-04-05T04:00:00.000Z");
  });

  it("ends New York's fall-back day at 00:00 EST, after the repeated hour (01/11)", () => {
    const window = wholeDayWindow("2026-10-31", "2026-11-01", "America/New_York");
    expect(iso(window.startsAt)).toBe("2026-10-31T04:00:00.000Z");
    expect(iso(window.endsAt)).toBe("2026-11-02T05:00:00.000Z");
    expect(windowCalendarDays(window.startsAt, window.endsAt, "America/New_York")).toEqual({
      startsOn: "2026-10-31",
      endsOn: "2026-11-01",
    });
  });

  it("ends New York's spring-forward day at 00:00 EDT (08/03, 23 hours)", () => {
    const window = wholeDayWindow("2026-03-08", "2026-03-08", "America/New_York");
    expect(iso(window.startsAt)).toBe("2026-03-08T05:00:00.000Z");
    expect(iso(window.endsAt)).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("legacyUtcWindowToZoned — the host's one-time migration", () => {
  const ZONE_ON = "2026-11-06T12:00:00.000Z";
  /** A row last written before the zone went on: still legacy. */
  const LEGACY = { updatedAt: "2026-11-01T09:00:00.000Z", zoneOnSince: ZONE_ON };

  it("keeps the days the old form showed, now whole in the store's zone", () => {
    const migrated = legacyUtcWindowToZoned(
      new Date("2026-11-10T00:00:00.000Z"),
      "2026-11-20T00:00:00.000Z",
      "America/Sao_Paulo",
      LEGACY,
    );
    expect(iso(migrated!.startsAt)).toBe("2026-11-10T03:00:00.000Z");
    expect(iso(migrated!.endsAt)).toBe("2026-11-21T03:00:00.000Z");
    expect(windowCalendarDays(migrated!.startsAt, migrated!.endsAt, "America/Sao_Paulo")).toEqual({
      startsOn: "2026-11-10",
      endsOn: "2026-11-20",
    });
  });

  it("is what a whole-day write of those days stores", () => {
    const migrated = legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", "2026-11-20T00:00:00.000Z", "Asia/Tokyo", LEGACY);
    const written = wholeDayWindow("2026-11-10", "2026-11-20", "Asia/Tokyo");
    expect(migrated).toEqual(written);
  });

  it("leaves an open bound open", () => {
    expect(legacyUtcWindowToZoned(null, "2026-11-20T00:00:00.000Z", "America/Sao_Paulo", LEGACY)!.startsAt).toBeNull();
    expect(legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", null, "America/Sao_Paulo", LEGACY)!.endsAt).toBeNull();
  });

  it("refuses a bound that is not a UTC midnight on a row the marker calls legacy", () => {
    const once = legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", "2026-11-20T00:00:00.000Z", "America/Sao_Paulo", LEGACY)!;
    expect(() => legacyUtcWindowToZoned(once.startsAt, once.endsAt, "America/Sao_Paulo", LEGACY)).toThrow(
      /not a UTC midnight/u,
    );
  });

  it("refuses a zone the runtime does not know", () => {
    expect(() => legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", null, "Not/A_Zone", LEGACY)).toThrow(/Not\/A_Zone/u);
  });

  it("refuses a marker that is not an instant", () => {
    expect(() =>
      legacyUtcWindowToZoned(null, null, "UTC", { updatedAt: "yesterday", zoneOnSince: ZONE_ON }),
    ).toThrow(/updatedAt is not an instant/u);
  });
});

describe("legacyUtcWindowToZoned rerun in London (UTC+0 in winter, review round 2)", () => {
  // At UTC+0 a migrated window is still two UTC midnights, so the values alone
  // cannot tell a migrated row from a legacy one: only the caller's marker can.
  const ZONE_ON = new Date("2026-12-01T12:00:00.000Z");
  const LONDON = "Europe/London";

  interface Row {
    id: string;
    startsAt: Date | null;
    endsAt: Date | null;
    updatedAt: Date;
  }

  /** The README's loop over an in-memory table whose updates move `updatedAt`. */
  function migrate(rows: Row[], now: Date, failAfter = Infinity): void {
    let written = 0;
    for (const row of rows.filter((candidate) => candidate.updatedAt < ZONE_ON)) {
      const migrated = legacyUtcWindowToZoned(row.startsAt, row.endsAt, LONDON, { updatedAt: row.updatedAt, zoneOnSince: ZONE_ON });
      if (migrated === null) continue;
      if (written === failAfter) throw new Error("connection lost");
      Object.assign(row, migrated, { updatedAt: now });
      written += 1;
    }
  }

  const table = (): Row[] => [
    { id: "a", startsAt: new Date("2026-12-10T00:00:00.000Z"), endsAt: new Date("2026-12-20T00:00:00.000Z"), updatedAt: new Date("2026-11-20T00:00:00.000Z") },
    { id: "b", startsAt: new Date("2026-12-05T00:00:00.000Z"), endsAt: new Date("2026-12-06T00:00:00.000Z"), updatedAt: new Date("2026-11-21T00:00:00.000Z") },
  ];

  it("answers null for a row written since the zone went on, so a second run changes nothing", () => {
    const rows = table();
    migrate(rows, new Date("2026-12-02T00:00:00.000Z"));
    const once = rows.map((row) => ({ ...row }));
    expect(windowCalendarDays(rows[0]!.startsAt, rows[0]!.endsAt, LONDON)).toEqual({ startsOn: "2026-12-10", endsOn: "2026-12-20" });
    migrate(rows, new Date("2026-12-03T00:00:00.000Z"));
    expect(rows).toEqual(once);
    expect(
      legacyUtcWindowToZoned(rows[0]!.startsAt, rows[0]!.endsAt, LONDON, { updatedAt: rows[0]!.updatedAt, zoneOnSince: ZONE_ON }),
    ).toBeNull();
  });

  it("finishes a run that failed half way without moving the rows it already wrote", () => {
    const rows = table();
    expect(() => migrate(rows, new Date("2026-12-02T00:00:00.000Z"), 1)).toThrow(/connection lost/u);
    migrate(rows, new Date("2026-12-02T01:00:00.000Z"));
    expect(rows.map((row) => windowCalendarDays(row.startsAt, row.endsAt, LONDON))).toEqual([
      { startsOn: "2026-12-10", endsOn: "2026-12-20" },
      { startsOn: "2026-12-05", endsOn: "2026-12-06" },
    ]);
  });
});
