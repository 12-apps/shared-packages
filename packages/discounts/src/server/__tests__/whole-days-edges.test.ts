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
  it("keeps the days the old form showed, now whole in the store's zone", () => {
    const migrated = legacyUtcWindowToZoned(
      new Date("2026-11-10T00:00:00.000Z"),
      "2026-11-20T00:00:00.000Z",
      "America/Sao_Paulo",
    );
    expect(iso(migrated.startsAt)).toBe("2026-11-10T03:00:00.000Z");
    expect(iso(migrated.endsAt)).toBe("2026-11-21T03:00:00.000Z");
    expect(windowCalendarDays(migrated.startsAt, migrated.endsAt, "America/Sao_Paulo")).toEqual({
      startsOn: "2026-11-10",
      endsOn: "2026-11-20",
    });
  });

  it("is what a whole-day write of those days stores", () => {
    const migrated = legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", "2026-11-20T00:00:00.000Z", "Asia/Tokyo");
    const written = wholeDayWindow("2026-11-10", "2026-11-20", "Asia/Tokyo");
    expect(migrated).toEqual(written);
  });

  it("leaves an open bound open", () => {
    expect(legacyUtcWindowToZoned(null, "2026-11-20T00:00:00.000Z", "America/Sao_Paulo").startsAt).toBeNull();
    expect(legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", null, "America/Sao_Paulo").endsAt).toBeNull();
  });

  it("refuses a row that was already migrated, so a second run stops instead of shifting it", () => {
    const once = legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", "2026-11-20T00:00:00.000Z", "America/Sao_Paulo");
    expect(() => legacyUtcWindowToZoned(once.startsAt, once.endsAt, "America/Sao_Paulo")).toThrow(
      /not a UTC midnight/u,
    );
  });

  it("refuses a zone the runtime does not know", () => {
    expect(() => legacyUtcWindowToZoned("2026-11-10T00:00:00.000Z", null, "Not/A_Zone")).toThrow(/Not\/A_Zone/u);
  });
});
