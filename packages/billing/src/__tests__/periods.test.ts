// @vitest-environment node
/**
 * Billing period arithmetic (FUT-132).
 *
 * The interesting cases are all the same case: a billing day that does not
 * exist in the target month. Getting it wrong does not throw — it silently
 * moves a customer's renewal date, which is the kind of bug that is only found
 * in a support ticket months later.
 */
import { describe, expect, it } from "vitest";

import {
  anchorDayOf,
  isBillingInterval,
  nextPeriod,
  periodEnd,
  trialEnd,
} from "../periods";

/** UTC date literal — every assertion here is timezone-sensitive by nature. */
function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("periodEnd", () => {
  it("advances a monthly cycle by one month", () => {
    expect(periodEnd(utc("2026-03-10"), "MONTH", 10)).toEqual(utc("2026-04-10"));
  });

  it("advances a yearly cycle by twelve months, not 365 days", () => {
    // A 29 Feb subscription renews on 28 Feb, not on 1 March: counting days
    // would drift the anniversary by one every leap year.
    expect(periodEnd(utc("2028-02-29"), "YEAR", 29)).toEqual(utc("2029-02-28"));
  });

  it("clamps a 31st anchor into a shorter month", () => {
    expect(periodEnd(utc("2026-01-31"), "MONTH", 31)).toEqual(utc("2026-02-28"));
  });

  it("clamps into February of a leap year on the 29th", () => {
    expect(periodEnd(utc("2028-01-31"), "MONTH", 31)).toEqual(utc("2028-02-29"));
  });

  it("rolls the year over from December", () => {
    expect(periodEnd(utc("2026-12-15"), "MONTH", 15)).toEqual(utc("2027-01-15"));
  });

  it("preserves the time of day, not just the date", () => {
    const start = new Date("2026-03-10T13:45:30.250Z");
    expect(periodEnd(start, "MONTH", 10).toISOString()).toBe(
      "2026-04-10T13:45:30.250Z",
    );
  });
});

describe("the anchor day", () => {
  it("recovers a clamped billing day in the next long month", () => {
    // THE regression this parameter exists for. Advancing from the CLAMPED
    // date (28 Feb) with its own day-of-month would give 28 March and walk the
    // customer's billing day three days earlier, permanently.
    const february = periodEnd(utc("2026-01-31"), "MONTH", 31);
    expect(february).toEqual(utc("2026-02-28"));
    expect(periodEnd(february, "MONTH", 31)).toEqual(utc("2026-03-31"));
  });

  it("survives a full year of clamping without drifting", () => {
    // Twelve monthly cycles from 31 Jan land back on 31 Jan, having passed
    // through February, April, June, September and November on the way.
    const twelveMonths = Array.from({ length: 12 }).reduce<Date>(
      (cursor) => periodEnd(cursor, "MONTH", 31),
      utc("2026-01-31"),
    );
    expect(twelveMonths).toEqual(utc("2027-01-31"));
  });

  it("is read from the original subscribe instant", () => {
    expect(anchorDayOf(new Date("2026-01-31T23:59:59.999Z"))).toBe(31);
  });
});

describe("nextPeriod", () => {
  it("starts the new cycle exactly where the old one ended (no gap, no overlap)", () => {
    const { start, end } = nextPeriod(utc("2026-04-10"), "MONTH", 10);
    expect(start).toEqual(utc("2026-04-10"));
    expect(end).toEqual(utc("2026-05-10"));
  });
});

describe("trialEnd", () => {
  it("is a plain day count from the subscribe instant", () => {
    expect(trialEnd(new Date("2026-03-01T09:00:00.000Z"), 14).toISOString()).toBe(
      "2026-03-15T09:00:00.000Z",
    );
  });

  it("returns the start itself when there is no trial", () => {
    const now = new Date("2026-03-01T09:00:00.000Z");
    expect(trialEnd(now, 0)).toEqual(now);
  });
});

describe("isBillingInterval", () => {
  it("accepts the two stored values and rejects anything else", () => {
    expect(isBillingInterval("MONTH")).toBe(true);
    expect(isBillingInterval("YEAR")).toBe(true);
    expect(isBillingInterval("WEEK")).toBe(false);
    expect(isBillingInterval("month")).toBe(false);
  });
});
