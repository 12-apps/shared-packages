import { describe, expect, it } from "vitest";

import {
  isUsableSchedule,
  nextWindowToday,
  scheduleCovers,
  toMinutes,
  type DiscountSchedule,
} from "../schedule";

import { clock, FRI, MON, SAT, SUN, THU, TUE, WED } from "./fixtures";

/**
 * Unit (FUT-996): the weekly schedule predicate on its own.
 *
 * The evaluator's behaviour is asserted through `evaluateDiscounts` next door
 * (`schedule-eligibility.test.ts`) for the reason the eligibility suite gives —
 * what the ticket promises is a PRICE, not a boolean. What is asserted HERE is
 * the arithmetic those cases would only reach indirectly: every weekday on the
 * Monday-first axis, both half-open boundaries, and the overnight wrap, which
 * is the one case a reader cannot check by eye.
 */

const HAPPY_HOUR: DiscountSchedule = {
  windows: [{ days: [FRI], from: "16:00", to: "20:00" }],
};

describe("toMinutes", () => {
  it.each([
    ["00:00", 0],
    ["09:05", 545],
    ["16:00", 960],
    ["23:59", 1_439],
  ])("reads %s as %i minutes", (value, expected) => {
    expect(toMinutes(value)).toBe(expected);
  });

  it.each(["", "9:05", "24:00", "16:60", "16h00", "sexta"])("refuses %o", (value) => {
    expect(toMinutes(value)).toBeNull();
  });
});

describe("scheduleCovers — the ordinary window", () => {
  it("covers an instant inside it", () => {
    expect(scheduleCovers(HAPPY_HOUR, clock(FRI, "17:30"))).toBe(true);
  });

  it("covers the opening instant — the bound is INCLUSIVE", () => {
    expect(scheduleCovers(HAPPY_HOUR, clock(FRI, "16:00"))).toBe(true);
  });

  it("does NOT cover the closing instant — the bound is EXCLUSIVE", () => {
    // Half-open [from, to), matching [startsAt, endsAt). A happy hour ending at
    // 20:00 is over the instant 20:00 begins; the alternative would price one
    // minute of every promotion twice at its own boundary.
    expect(scheduleCovers(HAPPY_HOUR, clock(FRI, "20:00"))).toBe(false);
  });

  it("does not cover a minute before it opens", () => {
    expect(scheduleCovers(HAPPY_HOUR, clock(FRI, "15:59"))).toBe(false);
  });

  it("does not cover the same hour on another day", () => {
    expect(scheduleCovers(HAPPY_HOUR, clock(THU, "17:30"))).toBe(false);
  });
});

describe("scheduleCovers — every weekday, Monday-first", () => {
  // The axis is the bug this pins: `Date#getDay()` is Sunday-first, so a
  // schedule read on the wrong axis runs a promotion one day early, every week,
  // and looks like a pricing fault rather than an off-by-one.
  it.each([
    ["monday", MON],
    ["tuesday", TUE],
    ["wednesday", WED],
    ["thursday", THU],
    ["friday", FRI],
    ["saturday", SAT],
    ["sunday", SUN],
  ])("covers %s when %s is the only day named", (_label, day) => {
    const only: DiscountSchedule = { windows: [{ days: [day], from: "12:00", to: "18:00" }] };
    expect(scheduleCovers(only, clock(day, "13:00"))).toBe(true);
    for (const other of [MON, TUE, WED, THU, FRI, SAT, SUN].filter((d) => d !== day)) {
      expect(scheduleCovers(only, clock(other, "13:00"))).toBe(false);
    }
  });

  it("Monday is 0 and Sunday is 6, not the other way round", () => {
    expect(MON).toBe(0);
    expect(SUN).toBe(6);
  });
});

describe("scheduleCovers — the overnight wrap", () => {
  // A bar shutting at 02:00 is the single most common happy hour, so `to`
  // earlier than `from` has to mean "into the next day" rather than "invalid".
  const LATE: DiscountSchedule = { windows: [{ days: [FRI], from: "22:00", to: "02:00" }] };

  it("covers the late half, on its own day", () => {
    expect(scheduleCovers(LATE, clock(FRI, "23:50"))).toBe(true);
  });

  it("covers the early half, on the day AFTER", () => {
    // The case no reader checks by eye: 00:10 Saturday belongs to FRIDAY's
    // window. Testing Saturday against `days` would never find it.
    expect(scheduleCovers(LATE, clock(SAT, "00:10"))).toBe(true);
  });

  it("stops at the exclusive end on the following day", () => {
    expect(scheduleCovers(LATE, clock(SAT, "02:00"))).toBe(false);
  });

  it("does not cover Friday morning, which is outside both halves", () => {
    expect(scheduleCovers(LATE, clock(FRI, "10:00"))).toBe(false);
  });

  it("does not leak into Saturday night", () => {
    expect(scheduleCovers(LATE, clock(SAT, "23:00"))).toBe(false);
  });
});

describe("scheduleCovers — multiple windows", () => {
  const TWO: DiscountSchedule = {
    windows: [
      { days: [FRI], from: "16:00", to: "20:00" },
      { days: [SAT], from: "12:00", to: "16:00" },
    ],
  };

  it("covers when ANY window is running", () => {
    expect(scheduleCovers(TWO, clock(FRI, "17:00"))).toBe(true);
    expect(scheduleCovers(TWO, clock(SAT, "13:00"))).toBe(true);
  });

  it("covers neither day's other hours", () => {
    expect(scheduleCovers(TWO, clock(FRI, "13:00"))).toBe(false);
    expect(scheduleCovers(TWO, clock(SAT, "17:00"))).toBe(false);
  });
});

describe("scheduleCovers — the fail-open directions", () => {
  it("a rule with NO schedule always covers", () => {
    // Every rule that predates FUT-996. This is what makes the change additive.
    expect(scheduleCovers(null, clock(MON, "03:00"))).toBe(true);
    expect(scheduleCovers(undefined, clock(MON, "03:00"))).toBe(true);
  });

  it("an unresolvable clock leaves a scheduled rule FIRING", () => {
    // The load-bearing direction. A host that cannot resolve a timezone must
    // not silently switch off every promotion in the store — the same reason
    // `inStoreZone` falls back rather than throwing, and `readStoreHours` keeps
    // a store selling. Nothing would be red if this went the other way.
    expect(scheduleCovers(HAPPY_HOUR, null)).toBe(true);
    expect(scheduleCovers(HAPPY_HOUR, undefined)).toBe(true);
  });

  it("a schedule with no windows covers NOTHING", () => {
    // The opposite direction, and deliberately so: an empty window list is a
    // half-built rule, not "no restriction". The validator refuses to save one.
    expect(scheduleCovers({ windows: [] }, clock(FRI, "17:00"))).toBe(false);
  });

  it.each([
    ["a malformed time", { days: [FRI], from: "16h", to: "20:00" }],
    ["an empty window", { days: [FRI], from: "16:00", to: "16:00" }],
    ["no days", { days: [], from: "16:00", to: "20:00" }],
  ])("%s covers nothing rather than everything", (_label, window) => {
    expect(scheduleCovers({ windows: [window] }, clock(FRI, "17:00"))).toBe(false);
  });
});

describe("nextWindowToday — the teaser's input", () => {
  it("finds a window that opens later today", () => {
    expect(nextWindowToday(HAPPY_HOUR, clock(FRI, "14:00"))).toEqual({
      days: [FRI],
      from: "16:00",
      to: "20:00",
    });
  });

  it("finds nothing once the window is RUNNING", () => {
    // The badge owns the card from here; a card must never carry both.
    expect(nextWindowToday(HAPPY_HOUR, clock(FRI, "17:00"))).toBeNull();
  });

  it("finds nothing after the window has closed", () => {
    expect(nextWindowToday(HAPPY_HOUR, clock(FRI, "21:00"))).toBeNull();
  });

  it("finds nothing on a day the promotion does not run", () => {
    // Scoped to TODAY on purpose: "das 16h às 20h" on a Tuesday is noise, and
    // it advertises a price the shopper cannot have for three days.
    expect(nextWindowToday(HAPPY_HOUR, clock(TUE, "14:00"))).toBeNull();
  });

  it("picks the EARLIEST of several, not the first declared", () => {
    const messy: DiscountSchedule = {
      windows: [
        { days: [MON], from: "18:00", to: "20:00" },
        { days: [MON], from: "15:00", to: "16:00" },
      ],
    };
    expect(nextWindowToday(messy, clock(MON, "10:00"))?.from).toBe("15:00");
  });

  it("teases nothing when there is no schedule or no clock", () => {
    expect(nextWindowToday(null, clock(FRI, "10:00"))).toBeNull();
    expect(nextWindowToday(HAPPY_HOUR, null)).toBeNull();
  });
});

describe("isUsableSchedule", () => {
  it("accepts the shapes the form can build", () => {
    expect(isUsableSchedule(HAPPY_HOUR)).toBe(true);
    expect(isUsableSchedule({ windows: [{ days: [MON, TUE], from: "12:00", to: "18:00" }] })).toBe(
      true,
    );
    expect(isUsableSchedule({ windows: [{ days: [FRI], from: "22:00", to: "02:00" }] })).toBe(true);
  });

  it.each([
    ["no windows", { windows: [] }],
    ["no days", { windows: [{ days: [], from: "16:00", to: "20:00" }] }],
    ["a day off the axis", { windows: [{ days: [7], from: "16:00", to: "20:00" }] }],
    ["a negative day", { windows: [{ days: [-1], from: "16:00", to: "20:00" }] }],
    ["a malformed time", { windows: [{ days: [FRI], from: "4pm", to: "20:00" }] }],
    ["an empty window", { windows: [{ days: [FRI], from: "16:00", to: "16:00" }] }],
  ])("refuses %s", (_label, value) => {
    expect(isUsableSchedule(value as DiscountSchedule)).toBe(false);
  });

  it("refuses more windows than the form can build", () => {
    const tooMany = {
      windows: Array.from({ length: 8 }, () => ({ days: [MON], from: "10:00", to: "11:00" })),
    };
    expect(isUsableSchedule(tooMany)).toBe(false);
  });
});
