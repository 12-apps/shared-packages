// @vitest-environment node
/**
 * Subscription lifecycle (FUT-132) — the states, the ageing a READ performs so
 * a stalled sweep cannot hand out free service, and the refusal to accept a
 * pair of windows that would leave no dunning at all.
 *
 * The windows below are a FIXTURE, not this package's opinion: they exist so
 * the mechanism can be exercised, and a host's own numbers are pinned in the
 * host's own suite.
 */
import { describe, expect, it } from "vitest";

import { BillingConfigError } from "../errors";
import { createBillingLifecycle, isBillingStatus, type SubscriptionTiming } from "../status";

const GRACE_DAYS = 7;
const SUSPEND_AFTER_DAYS = 30;
/** A fresh lifecycle per assertion — see the flakiness lane's isolation rule. */
function lifecycle() {
  return createBillingLifecycle({ graceDays: GRACE_DAYS, suspendAfterDays: SUSPEND_AFTER_DAYS });
}

const DUE = new Date("2026-03-01T00:00:00.000Z");

/** `DUE` plus a whole number of days. */
function daysAfterDue(days: number): Date {
  return new Date(DUE.getTime() + days * 86_400_000);
}

/** A subscription whose current cycle ends at `DUE`, not yet in dunning. */
const current: SubscriptionTiming = { currentPeriodEnd: DUE, pastDueSince: null };

describe("isBillingStatus", () => {
  it("accepts every stored value and rejects anything else", () => {
    for (const status of ["trialing", "active", "past_due", "unpaid", "canceled"]) {
      expect(isBillingStatus(status)).toBe(true);
    }
    expect(isBillingStatus("paused")).toBe(false);
    expect(isBillingStatus("ACTIVE")).toBe(false);
  });
});

describe("the windows are the host's, and are checked", () => {
  it("refuses a suspension threshold that leaves no dunning window", () => {
    // Both count from the same origin, so an equal value does not shorten
    // dunning — it deletes the restricted state, and an account would go from
    // current straight to suspended with nobody having decided that.
    expect(() => createBillingLifecycle({ graceDays: 7, suspendAfterDays: 7 })).toThrow(
      BillingConfigError,
    );
    expect(() => createBillingLifecycle({ graceDays: 7, suspendAfterDays: 3 })).toThrow(
      BillingConfigError,
    );
  });

  it("refuses a fractional or negative window", () => {
    expect(() => createBillingLifecycle({ graceDays: 1.5, suspendAfterDays: 30 })).toThrow(
      BillingConfigError,
    );
    expect(() => createBillingLifecycle({ graceDays: -1, suspendAfterDays: 30 })).toThrow(
      BillingConfigError,
    );
  });

  it("accepts a platform that penalises immediately but still degrades first", () => {
    // graceDays: 0 is a legitimate policy — restrict on the due date — and it
    // is only legal because a suspension window still sits above it.
    const strict = createBillingLifecycle({ graceDays: 0, suspendAfterDays: 14 });
    expect(strict.effectiveStatus("active", current, DUE)).toBe("past_due");
  });

  it("echoes both back, so a report and the gate cannot disagree", () => {
    expect(lifecycle().graceDays).toBe(GRACE_DAYS);
    expect(lifecycle().suspendAfterDays).toBe(SUSPEND_AFTER_DAYS);
  });
});

describe("effectiveStatus while the cycle is still running", () => {
  it("leaves an active subscription alone before its due date", () => {
    expect(lifecycle().effectiveStatus("active", current, daysAfterDue(-1))).toBe("active");
  });

  it("leaves a trial alone before it runs out", () => {
    expect(lifecycle().effectiveStatus("trialing", current, daysAfterDue(-1))).toBe("trialing");
  });
});

describe("effectiveStatus ageing an unpaid cycle", () => {
  it("does not penalise inside the grace window", () => {
    // A card that expired on renewal day is the common case, not fraud: the
    // provider is still retrying and the owner has not been told yet.
    expect(lifecycle().effectiveStatus("active", current, daysAfterDue(GRACE_DAYS - 1))).toBe(
      "active",
    );
  });

  it("restricts the moment grace runs out", () => {
    expect(lifecycle().effectiveStatus("active", current, daysAfterDue(GRACE_DAYS))).toBe("past_due");
  });

  it("suspends once the dunning window is exhausted", () => {
    expect(lifecycle().effectiveStatus("active", current, daysAfterDue(SUSPEND_AFTER_DAYS))).toBe(
      "unpaid",
    );
  });

  it("ages a lapsed trial down the same path, with no separate branch", () => {
    // A trial running out IS a cycle that was not paid.
    expect(lifecycle().effectiveStatus("trialing", current, daysAfterDue(GRACE_DAYS))).toBe(
      "past_due",
    );
    expect(lifecycle().effectiveStatus("trialing", current, daysAfterDue(SUSPEND_AFTER_DAYS))).toBe(
      "unpaid",
    );
  });

  it("ages a STORED active row even when the sweep never ran", () => {
    // The property that makes the sweep a materialization rather than the
    // source of truth: a database frozen in `active` still stops entitling.
    expect(lifecycle().effectiveStatus("active", current, daysAfterDue(90))).toBe("unpaid");
  });
});

describe("effectiveStatus once dunning has started", () => {
  const dunning: SubscriptionTiming = {
    // A renewal moved the period end forward while the OLD cycle stayed
    // unpaid — the case `pastDueSince` exists to survive.
    currentPeriodEnd: daysAfterDue(30),
    pastDueSince: DUE,
  };

  it("measures from pastDueSince, not from the moved period end", () => {
    expect(lifecycle().effectiveStatus("past_due", dunning, daysAfterDue(SUSPEND_AFTER_DAYS))).toBe(
      "unpaid",
    );
  });

  it("does not forgive a debt just because a period was advanced", () => {
    // Inside the grace window measured from `pastDueSince`, a stored
    // `past_due` stays put. Only a recorded payment clears dunning.
    expect(lifecycle().effectiveStatus("past_due", dunning, daysAfterDue(1))).toBe("past_due");
  });
});

describe("effectiveStatus terminal states", () => {
  it("never resurrects a canceled subscription", () => {
    expect(lifecycle().effectiveStatus("canceled", current, daysAfterDue(-30))).toBe("canceled");
    expect(lifecycle().effectiveStatus("canceled", current, daysAfterDue(365))).toBe("canceled");
  });

  it("never softens an unpaid one back to past_due", () => {
    expect(lifecycle().effectiveStatus("unpaid", current, daysAfterDue(0))).toBe("unpaid");
  });
});

describe("daysWithoutPaying", () => {
  it("is zero while the customer is current", () => {
    expect(lifecycle().daysWithoutPaying(current, daysAfterDue(-5))).toBe(0);
  });

  it("counts through the grace window, which is a policy and not a fact", () => {
    // Grace decides whether we CHASE them, not whether they owe us. A card
    // that has been failing for three days is exactly what an early-warning
    // report wants to see.
    expect(lifecycle().daysWithoutPaying(current, daysAfterDue(3))).toBe(3);
  });

  it("does not count a partial day", () => {
    const halfway = new Date(daysAfterDue(9).getTime() + 43_200_000);
    expect(lifecycle().daysWithoutPaying(current, halfway)).toBe(9);
  });

  it("counts from pastDueSince when dunning is under way", () => {
    const dunning: SubscriptionTiming = {
      currentPeriodEnd: daysAfterDue(30),
      pastDueSince: DUE,
    };
    expect(lifecycle().daysWithoutPaying(dunning, daysAfterDue(45))).toBe(45);
  });
});

describe("the two thresholds", () => {
  it("share an origin, so 'how long do I have?' has one answer", () => {
    expect(lifecycle().graceEndsAt(current)).toEqual(daysAfterDue(GRACE_DAYS));
    expect(lifecycle().suspendsAt(current)).toEqual(daysAfterDue(SUSPEND_AFTER_DAYS));
  });
});
