// @vitest-environment node
/**
 * Usage past an allowance, billed on the next cycle (FUT-5094) — the CONTRACT.
 *
 * Written before the implementation, which failed every `it` here: the root
 * entry exported no usage pricing at all, and the cycle amount was whatever
 * the host passed (`subscription.priceCents`), with no breakdown. The shapes
 * are the root entry's own (`../usage-types.ts`).
 *
 * The acceptance this pins: a period with overage is followed by ONE charge
 * whose breakdown sums to its amount; with overage off, nothing past the
 * allowance is billed. The numbers are the host's (an allowance of 1000 units
 * at 50 centavos each is the first adopter's), passed in as config.
 *
 * The four commercial rules only the owner could make were decided on
 * 2026-11-16 and are pinned as "OWNER:" cases: the count's cutoff (by
 * commit, final at the boundary), a cancellation (one final overage-only
 * charge), a downgrade (the full allowance, no proration) and a refund (its
 * overage is waived, never billed again).
 */
import { describe, expect, it } from "vitest";

import {
  checkBreakdown,
  createUsagePricing,
  type ComposeInput,
  type CycleCharge,
  type UsagePeriod,
  type UsageReading,
} from "../index";

const METER = "units";

/** UTC midnight — every boundary here is an instant. */
function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** The period that just ended, and the cycle that starts where it ends. */
const ENDED: UsagePeriod = { start: utc("2026-10-10"), end: utc("2026-11-10") };
const NEXT: UsagePeriod = { start: utc("2026-11-10"), end: utc("2026-12-10") };

const POLICY = {
  currency: "BRL",
  meters: [{ meter: METER, allowance: 1000, unitPriceCents: 50 }],
};

function reading(over: Partial<UsageReading> = {}): UsageReading {
  return { meter: METER, period: ENDED, used: 0, final: true, overage: "BILLED", ...over };
}

function input(over: Partial<ComposeInput> = {}): ComposeInput {
  return {
    base: { amountCents: 29_900, currency: "BRL", period: NEXT },
    usagePeriod: ENDED,
    readings: [reading()],
    alreadyBilled: [],
    ...over,
  };
}

/** Compose and insist it is ready — the common path of most cases. */
function charge(over: Partial<ComposeInput> = {}): CycleCharge | null {
  const result = createUsagePricing(POLICY).compose(input(over));
  if (!result.ready) throw new Error(`expected a ready charge, waiting for ${result.waitingFor.join(", ")}`);
  return result.charge;
}

/** The name of what `run` threw, or null when it did not throw. */
function thrownName(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.name : "non-error";
  }
  return null;
}

function sum(c: CycleCharge): number {
  return c.lines.reduce((total, line) => total + line.amountCents, 0);
}

describe("a period with no overage", () => {
  it("charges the base alone, as one BASE line for the new cycle", () => {
    const c = charge({ readings: [reading({ used: 640 })] });
    expect(c).toEqual({
      amountCents: 29_900,
      currency: "BRL",
      lines: [{ kind: "BASE", amountCents: 29_900, period: NEXT }],
    });
  });

  it("bills nothing at exactly the allowance", () => {
    const c = charge({ readings: [reading({ used: 1000 })] });
    expect(c?.amountCents).toBe(29_900);
    expect(c?.lines.filter((line) => line.kind === "OVERAGE")).toEqual([]);
  });
});

describe("a period with overage", () => {
  it("adds the ended period's overage to the next cycle, in one charge that sums", () => {
    // THE acceptance case: 1237 used against 1000 → 237 × 50 = 11 850.
    const c = charge({ readings: [reading({ used: 1237 })] });
    expect(c).toEqual({
      amountCents: 29_900 + 11_850,
      currency: "BRL",
      lines: [
        { kind: "BASE", amountCents: 29_900, period: NEXT },
        {
          kind: "OVERAGE",
          meter: METER,
          period: ENDED,
          used: 1237,
          allowance: 1000,
          quantity: 237,
          unitPriceCents: 50,
          amountCents: 11_850,
        },
      ],
    });
    expect(sum(c as CycleCharge)).toBe(c?.amountCents);
  });

  it("bills the first unit past the allowance", () => {
    expect(charge({ readings: [reading({ used: 1001 })] })?.amountCents).toBe(29_950);
  });

  it("passes its own breakdown check", () => {
    const c = charge({ readings: [reading({ used: 4321 })] }) as CycleCharge;
    expect(() => checkBreakdown(c)).not.toThrow();
  });

  it("refuses an overage of a period that does not end where the cycle starts", () => {
    // The previous period's overage goes on the NEXT cycle — never on one a
    // month later, where it would be billed against the wrong period.
    const later = { amountCents: 29_900, currency: "BRL", period: { start: utc("2026-12-10"), end: utc("2027-01-10") } };
    expect(thrownName(() => createUsagePricing(POLICY).compose(input({ base: later, readings: [reading({ used: 1500 })] })))).toBe(
      "BillingUsageError",
    );
  });
});

describe("overage off, or out of scope", () => {
  it("bills nothing past the allowance when the host's switch is OFF", () => {
    const c = charge({ readings: [reading({ used: 9999, overage: "OFF" })] });
    expect(c?.amountCents).toBe(29_900);
    expect(c?.lines).toEqual([{ kind: "BASE", amountCents: 29_900, period: NEXT }]);
  });

  it("bills nothing past the allowance for an EXEMPT customer (its own provider credentials)", () => {
    const c = charge({ readings: [reading({ used: 9999, overage: "EXEMPT" })] });
    expect(c?.amountCents).toBe(29_900);
    expect(c?.lines.some((line) => line.kind === "OVERAGE")).toBe(false);
  });

  it("never waits on a count it would not bill", () => {
    // A non-final count only matters when it could be billed; OFF and EXEMPT
    // must not hold a cycle open.
    const result = createUsagePricing(POLICY)
      .compose(input({ readings: [reading({ used: 5000, final: false, overage: "OFF" })] }));
    expect(result).toEqual({ ready: true, charge: { amountCents: 29_900, currency: "BRL", lines: [{ kind: "BASE", amountCents: 29_900, period: NEXT }] } });
  });
});

describe("a count that is not final when the next charge is composed", () => {
  it("answers not ready, naming the meter, and composes no partial charge", () => {
    const result = createUsagePricing(POLICY)
      .compose(input({ readings: [reading({ used: 1500, final: false })] }));
    expect(result).toEqual({ ready: false, waitingFor: [METER] });
  });

  it("OWNER: a count dated by commit is final at the boundary — no grace window holds the cycle", () => {
    // What committed by the period's end is billed on the cycle that starts
    // there, composed AT the boundary.
    const result = createUsagePricing(POLICY).compose(input({ readings: [reading({ used: 1200, final: true })] }));
    expect(result).toMatchObject({ ready: true, charge: { amountCents: 29_900 + 200 * 50 } });
  });

  it("OWNER: a late commit counts in the period it commits in — billed once, on the cycle after", () => {
    // 1000 committed by the boundary, so the ended period bills nothing. The
    // dating rule itself is the host's (a count is dated by its commit); this
    // test only composes what the host then hands in. The 10 that commit after
    // the boundary join the next period's own 1005, so its reading is 1015:
    // 15 over the allowance of 1000, billed on the cycle after it.
    expect(charge({ readings: [reading({ used: 1000 })] })?.amountCents).toBe(29_900);
    const AFTER: UsagePeriod = { start: NEXT.end, end: utc("2027-01-10") };
    const next = charge({
      base: { amountCents: 29_900, currency: "BRL", period: AFTER },
      usagePeriod: NEXT,
      readings: [reading({ period: NEXT, used: 1005 + 10 })],
    });
    expect(next?.lines[1]).toMatchObject({ kind: "OVERAGE", period: NEXT, quantity: 15, amountCents: 750 });
  });
});

describe("billed at most once", () => {
  it("leaves out an overage already carried by another live cycle", () => {
    const c = charge({
      readings: [reading({ used: 1500 })],
      alreadyBilled: [{ meter: METER, periodStart: ENDED.start }],
    });
    expect(c?.amountCents).toBe(29_900);
    expect(c?.lines.some((line) => line.kind === "OVERAGE")).toBe(false);
  });

  it("is deterministic: the charge job composing twice gets the same charge", () => {
    const pricing = createUsagePricing(POLICY);
    const once = pricing.compose(input({ readings: [reading({ used: 1500 })] }));
    const twice = pricing.compose(input({ readings: [reading({ used: 1500 })] }));
    expect(twice).toEqual(once);
  });

  it("carries the same overage onto the retry of a FAILED cycle", () => {
    // A failed cycle is not live (it is not in `alreadyBilled`), so the new
    // row for the same period carries the same overage — not none, not twice.
    const first = charge({ readings: [reading({ used: 1500 })] });
    const retry = charge({ readings: [reading({ used: 1500 })], alreadyBilled: [] });
    expect(retry).toEqual(first);
  });

  it("refuses two readings of one meter", () => {
    const pricing = createUsagePricing(POLICY);
    expect(thrownName(() => pricing.compose(input({ readings: [reading({ used: 1500 }), reading({ used: 1500 })] })))).toBe(
      "BillingUsageError",
    );
  });

  it("refuses a breakdown that repeats one meter's overage for one period", () => {
    const line = {
      kind: "OVERAGE" as const,
      meter: METER,
      period: ENDED,
      used: 1001,
      allowance: 1000,
      quantity: 1,
      unitPriceCents: 50,
      amountCents: 50,
    };
    expect(thrownName(() => checkBreakdown({ amountCents: 100, currency: "BRL", lines: [line, line] }))).toBe(
      "BillingBreakdownError",
    );
  });
});

describe("the readings the host owes", () => {
  it("refuses a missing reading for a declared meter rather than billing it as zero", () => {
    const pricing = createUsagePricing(POLICY);
    expect(thrownName(() => pricing.compose(input({ readings: [] })))).toBe("BillingUsageError");
  });

  it("refuses a reading of a meter the policy does not declare", () => {
    const pricing = createUsagePricing(POLICY);
    expect(thrownName(() => pricing.compose(input({ readings: [reading(), reading({ meter: "other" })] })))).toBe(
      "BillingUsageError",
    );
  });

  it("refuses a reading of another period", () => {
    const pricing = createUsagePricing(POLICY);
    expect(thrownName(() => pricing.compose(input({ readings: [reading({ period: NEXT, used: 1500 })] })))).toBe(
      "BillingUsageError",
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses a used count of %s", (used) => {
    const pricing = createUsagePricing(POLICY);
    expect(thrownName(() => pricing.compose(input({ readings: [reading({ used })] })))).toBe("BillingUsageError");
  });
});

describe("currency and rounding, in centavos", () => {
  it("multiplies exactly, with no floating point", () => {
    // 1000 + 3 units at 50 → 150, never 149.99999.
    const c = charge({ readings: [reading({ used: 1003 })] });
    expect(c?.lines[1]?.amountCents).toBe(150);
    expect(Number.isInteger(c?.amountCents)).toBe(true);
  });

  it("refuses an overage that would leave safe integers", () => {
    const used = Number.MAX_SAFE_INTEGER;
    expect(thrownName(() => createUsagePricing(POLICY).compose(input({ readings: [reading({ used })] })))).toBe(
      "BillingUsageError",
    );
  });

  it("refuses a base in another currency than the policy's", () => {
    const base = { amountCents: 29_900, currency: "USD", period: NEXT };
    expect(thrownName(() => createUsagePricing(POLICY).compose(input({ base })))).toBe("BillingUsageError");
  });

  it.each([
    ["a fractional unit price", { meter: METER, allowance: 1000, unitPriceCents: 0.5 }],
    ["a negative unit price", { meter: METER, allowance: 1000, unitPriceCents: -50 }],
    ["a fractional allowance", { meter: METER, allowance: 999.5, unitPriceCents: 50 }],
    ["a negative allowance", { meter: METER, allowance: -1, unitPriceCents: 50 }],
    ["a blank meter", { meter: " ", allowance: 1000, unitPriceCents: 50 }],
  ])("refuses %s at construction", (_what, meter) => {
    expect(thrownName(() => createUsagePricing({ currency: "BRL", meters: [meter] }))).toBe("BillingConfigError");
  });

  it("refuses one meter declared twice, and a blank currency, at construction", () => {
    const meter = { meter: METER, allowance: 1000, unitPriceCents: 50 };
    expect(thrownName(() => createUsagePricing({ currency: "BRL", meters: [meter, meter] }))).toBe("BillingConfigError");
    expect(thrownName(() => createUsagePricing({ currency: "", meters: [meter] }))).toBe("BillingConfigError");
  });
});

describe("the breakdown check", () => {
  const base = { kind: "BASE" as const, amountCents: 29_900, period: NEXT };

  it("refuses lines that do not sum to the amount", () => {
    expect(thrownName(() => checkBreakdown({ amountCents: 30_000, currency: "BRL", lines: [base] }))).toBe(
      "BillingBreakdownError",
    );
  });

  it("refuses an amount with no lines at all", () => {
    expect(thrownName(() => checkBreakdown({ amountCents: 29_900, currency: "BRL", lines: [] }))).toBe(
      "BillingBreakdownError",
    );
  });

  it("refuses a negative or fractional line even when the sum holds", () => {
    const minus = { ...base, amountCents: -100 };
    const plus = { ...base, amountCents: 30_000 };
    expect(thrownName(() => checkBreakdown({ amountCents: 29_900, currency: "BRL", lines: [plus, minus] }))).toBe(
      "BillingBreakdownError",
    );
    const half = { ...base, amountCents: 0.5 };
    expect(thrownName(() => checkBreakdown({ amountCents: 29_900.5, currency: "BRL", lines: [base, half] }))).toBe(
      "BillingBreakdownError",
    );
  });

  it("refuses an overage line whose own arithmetic is wrong", () => {
    const overage = {
      kind: "OVERAGE" as const,
      meter: METER,
      period: ENDED,
      used: 1237,
      allowance: 1000,
      quantity: 200, // should be 237
      unitPriceCents: 50,
      amountCents: 10_000,
    };
    expect(thrownName(() => checkBreakdown({ amountCents: 39_900, currency: "BRL", lines: [base, overage] }))).toBe(
      "BillingBreakdownError",
    );
  });
});

describe("a final settlement (no further cycle)", () => {
  it("charges the overage alone, in a breakdown that sums", () => {
    const c = charge({ base: null, readings: [reading({ used: 1100 })] });
    expect(c).toEqual({
      amountCents: 5000,
      currency: "BRL",
      lines: [
        {
          kind: "OVERAGE",
          meter: METER,
          period: ENDED,
          used: 1100,
          allowance: 1000,
          quantity: 100,
          unitPriceCents: 50,
          amountCents: 5000,
        },
      ],
    });
  });

  it("charges nothing — never a zero-amount charge — when there is no overage", () => {
    expect(charge({ base: null, readings: [reading({ used: 10 })] })).toBeNull();
    expect(charge({ base: null, readings: [reading({ used: 9999, overage: "OFF" })] })).toBeNull();
  });

  it("OWNER: a cancellation with overage pending bills ONE final overage-only charge", () => {
    const c = charge({ base: null, readings: [reading({ used: 1237 })] }) as CycleCharge;
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toMatchObject({ kind: "OVERAGE", period: ENDED, quantity: 237, amountCents: 11_850 });
    expect(c.amountCents).toBe(11_850);
    expect(() => checkBreakdown(c)).not.toThrow();
  });

  it("OWNER: a cancellation whose overage is already carried composes no charge, never a zero one", () => {
    const c = charge({
      base: null,
      readings: [reading({ used: 1237 })],
      alreadyBilled: [{ meter: METER, periodStart: ENDED.start }],
    });
    expect(c).toBeNull();
    expect(thrownName(() => checkBreakdown({ amountCents: 0, currency: "BRL", lines: [] }))).toBe("BillingBreakdownError");
  });
});

describe("a plan change mid-period", () => {
  it("bills against the allowance the host adjusted for this period, when it states one", () => {
    // The mechanism for whichever rule the owner picks: a prorated allowance
    // arrives on the reading and wins over the meter's.
    const c = charge({ readings: [reading({ used: 700, allowance: 500 })] });
    expect(c?.lines[1]).toMatchObject({ kind: "OVERAGE", allowance: 500, quantity: 200, amountCents: 10_000 });
  });

  it("OWNER: a downgrade mid-period bills the overage counted so far against the FULL allowance", () => {
    // The count stops at the downgrade (1300 so far); no allowance on the
    // reading, so the meter's full 1000 applies — no proration by days. The
    // next cycle's base is whatever the new plan costs.
    const c = charge({
      base: { amountCents: 9_900, currency: "BRL", period: NEXT },
      readings: [reading({ used: 1300 })],
    });
    expect(c).toMatchObject({ amountCents: 9_900 + 300 * 50 });
    expect(c?.lines[1]).toMatchObject({ kind: "OVERAGE", allowance: 1000, quantity: 300, amountCents: 15_000 });
  });
});

describe("a refund or chargeback of a charge that carried overage", () => {
  it("OWNER: a refunded cycle's overage is waived — listed as already billed, never billed again", () => {
    // The refund returns the whole charge, overage included. The refunded
    // cycle stays in `alreadyBilled` (unlike a FAILED one), so the next
    // composition for that period carries no overage.
    const refunded = [{ meter: METER, periodStart: ENDED.start }];
    const c = charge({ readings: [reading({ used: 1237 })], alreadyBilled: refunded });
    expect(c?.amountCents).toBe(29_900);
    expect(c?.lines.some((line) => line.kind === "OVERAGE")).toBe(false);
    expect(charge({ base: null, readings: [reading({ used: 1237 })], alreadyBilled: refunded })).toBeNull();
  });
});

describe("the guards behind compose", () => {
  const expectUsageError = (over: Partial<ComposeInput>) =>
    expect(thrownName(() => createUsagePricing(POLICY).compose(input(over)))).toBe("BillingUsageError");

  it("refuses a fractional or negative base", () => {
    for (const amountCents of [299.5, -100]) {
      expectUsageError({ base: { amountCents, currency: "BRL", period: NEXT } });
    }
  });

  it("refuses a fractional or negative allowance on a reading", () => {
    for (const allowance of [10.5, -1]) expectUsageError({ readings: [reading({ used: 1500, allowance })] });
  });

  it("refuses a usage period that does not start before it ends", () => {
    expectUsageError({ usagePeriod: { start: ENDED.end, end: ENDED.start }, base: null, readings: [] });
    const empty: UsagePeriod = { start: ENDED.end, end: ENDED.end };
    expectUsageError({ usagePeriod: empty, readings: [reading({ period: empty })] });
  });

  it("refuses a sum past safe integers", () => {
    const policy = { currency: "BRL", meters: [{ meter: METER, allowance: 0, unitPriceCents: 1 }] };
    const run = () =>
      createUsagePricing(policy).compose(input({
        base: { amountCents: Number.MAX_SAFE_INTEGER, currency: "BRL", period: NEXT },
        readings: [reading({ used: 1 })],
      }));
    expect(thrownName(run)).toBe("BillingUsageError");
  });

  it("returns charge null, not a cancellation, for a base of 0 with no overage", () => {
    const result = createUsagePricing(POLICY).compose(
      input({ base: { amountCents: 0, currency: "BRL", period: NEXT }, readings: [reading({ used: 10 })] }),
    );
    expect(result).toEqual({ ready: true, charge: null });
  });
});

describe("several meters", () => {
  const MULTI = {
    currency: "BRL",
    meters: [
      { meter: "a", allowance: 0, unitPriceCents: 10 },
      { meter: "b", allowance: 10, unitPriceCents: 30 },
    ],
  };
  const a = (used: number) => reading({ meter: "a", used });
  const b = (used: number) => reading({ meter: "b", used });

  it("sums every meter's overage, with an allowance of 0, whatever the readings' order", () => {
    // base 29900 + a: 10 x 10 = 100 + b: 15 over 10 = 5 x 30 = 150 -> 30150
    const forward = createUsagePricing(MULTI).compose(input({ readings: [a(10), b(15)] }));
    const reversed = createUsagePricing(MULTI).compose(input({ readings: [b(15), a(10)] }));
    expect(reversed).toEqual(forward);
    expect(forward).toMatchObject({ ready: true, charge: { amountCents: 29_900 + 100 + 150 } });
    if (forward.ready && forward.charge) {
      expect(forward.charge.lines.map((line) => (line.kind === "BASE" ? "BASE" : line.meter))).toEqual(["BASE", "a", "b"]);
    }
  });
});

describe("the breakdown check, branch by branch", () => {
  const BASE_LINE = { kind: "BASE" as const, amountCents: 100, period: NEXT };
  const overage = (over: object) => ({
    kind: "OVERAGE" as const, meter: METER, period: ENDED, used: 20, allowance: 10, quantity: 10,
    unitPriceCents: 5, amountCents: 50, ...over,
  });
  const name = (c: CycleCharge) => thrownName(() => checkBreakdown(c));

  it("refuses a blank currency", () => {
    expect(name({ amountCents: 100, currency: " ", lines: [BASE_LINE] })).toBe("BillingBreakdownError");
  });

  it("refuses an overage line of quantity 0", () => {
    const line = overage({ used: 10, quantity: 0, amountCents: 0 });
    expect(name({ amountCents: 100, currency: "BRL", lines: [BASE_LINE, line] })).toBe("BillingBreakdownError");
  });

  it("refuses a second BASE line", () => {
    const other = { ...BASE_LINE, period: ENDED };
    expect(name({ amountCents: 200, currency: "BRL", lines: [BASE_LINE, other] })).toBe("BillingBreakdownError");
  });
});
