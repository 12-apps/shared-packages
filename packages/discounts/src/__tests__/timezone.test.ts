import { describe, expect, it } from "vitest";

import { scheduleCovers } from "../engine/schedule";
import { resolveLocalClock } from "../timezone";

/**
 * Unit (FUT-996): the one place an IANA zone is read.
 *
 * The instants are chosen for the two things that actually go wrong here: the
 * Monday-first conversion (Intl reports Sunday-first, and an axis that is off
 * by one runs every promotion on the wrong day), and the UTC offset (São Paulo
 * is UTC-3, so a late-evening UTC instant is a different DAY there).
 */

const SP = "America/Sao_Paulo";

describe("resolveLocalClock", () => {
  it("reads the store's own wall clock, not the caller's", () => {
    // 2026-03-13T19:00Z is a Friday, 16:00 in São Paulo — the exact instant a
    // happy hour opens.
    expect(resolveLocalClock(new Date("2026-03-13T19:00:00.000Z"), SP)).toEqual({
      weekday: 4,
      minutes: 16 * 60,
    });
  });

  it("puts Monday at 0 and Sunday at 6", () => {
    // Intl says "Mon"/"Sun"; the schedule axis says 0/6. The table in the module
    // is the whole conversion and this is what pins it.
    expect(resolveLocalClock(new Date("2026-03-09T15:00:00.000Z"), SP)?.weekday).toBe(0);
    expect(resolveLocalClock(new Date("2026-03-15T15:00:00.000Z"), SP)?.weekday).toBe(6);
  });

  it("rolls the DAY back when the UTC instant is already tomorrow", () => {
    // 02:00Z Saturday is 23:00 FRIDAY in São Paulo. A resolver that read the
    // UTC weekday would miss the last hour of every Friday promotion.
    expect(resolveLocalClock(new Date("2026-03-14T02:00:00.000Z"), SP)).toEqual({
      weekday: 4,
      minutes: 23 * 60,
    });
  });

  it("reports local midnight as minute 0, never as 1440", () => {
    // `hour12: false` yields 24 for midnight in some ICU versions, which would
    // put every midnight instant outside every window — once a day, forever.
    const midnight = resolveLocalClock(new Date("2026-03-14T03:00:00.000Z"), SP);
    expect(midnight?.minutes).toBe(0);
    expect(midnight?.weekday).toBe(5);
  });

  it("answers null for a zone this runtime does not know", () => {
    expect(resolveLocalClock(new Date("2026-03-13T19:00:00.000Z"), "Mars/Olympus")).toBeNull();
  });

  it("feeds the schedule predicate directly", () => {
    // The two halves are only correct TOGETHER, so this is the assertion that
    // matters: a real instant, a real zone, and the promotion the ticket asks
    // for.
    const happyHour = { windows: [{ days: [4], from: "16:00", to: "20:00" }] };
    const inside = resolveLocalClock(new Date("2026-03-13T19:30:00.000Z"), SP);
    const outside = resolveLocalClock(new Date("2026-03-13T23:30:00.000Z"), SP);
    expect(scheduleCovers(happyHour, inside)).toBe(true);
    expect(scheduleCovers(happyHour, outside)).toBe(false);
  });
});
