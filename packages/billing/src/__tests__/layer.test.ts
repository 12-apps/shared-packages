// @vitest-environment node
/**
 * The billing → gating seam (FUT-132).
 *
 * The tables are the HOST's, so what is pinned here is the mechanism they hang
 * off: which state is aged, when the frozen snapshot wins over the live
 * fallback, and the two ways this returns `null` rather than guessing. The
 * fixture below deliberately uses a mapping no real platform would choose, so
 * a test that passed by accidentally agreeing with a default would fail.
 */
import { describe, expect, it } from "vitest";

import { BillingConfigError } from "../errors";
import { createBillingLayer, type SubscriptionBillingRow } from "../layer";
import { createBillingLifecycle, type BillingStatus } from "../status";

const GRACE_DAYS = 7;
const SUSPEND_AFTER_DAYS = 30;

function lifecycle() {
  return createBillingLifecycle({ graceDays: GRACE_DAYS, suspendAfterDays: SUSPEND_AFTER_DAYS });
}

type Plan = Readonly<Record<string, unknown>>;
type Gate = "open" | "held" | "closed";

const FREE_PLAN: Plan = { tier: "free" };

const lifecycleByStatus: Record<BillingStatus, Gate> = {
  trialing: "open",
  active: "open",
  past_due: "held",
  unpaid: "closed",
  canceled: "open",
};

const keepsItsTier: Record<BillingStatus, boolean> = {
  trialing: true,
  active: true,
  past_due: true,
  unpaid: true,
  canceled: false,
};

/**
 * A layer plus the counter its fallback increments — built per assertion so no
 * two tests share a reading, and the count lives on a container's property
 * rather than in a closed-over binding a stub reassigns.
 */
function makeLayer() {
  const calls = { defaultTier: 0 };
  const billingLayer = createBillingLayer<Plan, Gate>({
    lifecycle: createBillingLifecycle({
      graceDays: GRACE_DAYS,
      suspendAfterDays: SUSPEND_AFTER_DAYS,
    }),
    lifecycleByStatus,
    keepsItsTier,
    defaultTier: () => {
      calls.defaultTier += 1;
      return { planKey: "free", plan: FREE_PLAN };
    },
    // Coercion is the host's; here it only proves the row's column is passed
    // through untouched rather than read directly.
    frozenTier: (entitlements) => ({ frozen: entitlements }),
  });
  return { billingLayer, calls };
}

const PERIOD_END = new Date("2026-03-29T00:00:00.000Z");
const NOW = new Date("2026-03-15T00:00:00.000Z");

function row(over: Partial<SubscriptionBillingRow> = {}): SubscriptionBillingRow {
  return {
    status: "active",
    planKey: "pro",
    entitlements: { seats: 5 },
    currentPeriodEnd: PERIOD_END,
    pastDueSince: null,
    ...over,
  };
}

/** `NOW` shifted so the cycle that ended at PERIOD_END is `days` overdue. */
function overdueBy(days: number): Date {
  return new Date(PERIOD_END.getTime() + days * 86_400_000);
}

describe("the tables are required in full", () => {
  it("refuses a lifecycle map that omits a status", () => {
    expect(() =>
      createBillingLayer<Plan, Gate>({
        lifecycle: lifecycle(),
        lifecycleByStatus: { trialing: "open", active: "open" } as Record<BillingStatus, Gate>,
        keepsItsTier,
        defaultTier: () => ({ planKey: "free", plan: FREE_PLAN }),
        frozenTier: () => FREE_PLAN,
      }),
    ).toThrow(BillingConfigError);
  });

  it("refuses a tier-retention map that omits a status", () => {
    expect(() =>
      createBillingLayer<Plan, Gate>({
        lifecycle: lifecycle(),
        lifecycleByStatus,
        keepsItsTier: { canceled: false } as Record<BillingStatus, boolean>,
        defaultTier: () => ({ planKey: "free", plan: FREE_PLAN }),
        frozenTier: () => FREE_PLAN,
      }),
    ).toThrow(BillingConfigError);
  });
});

describe("statuses that keep their tier", () => {
  it("hands back the row's own key and its frozen snapshot", () => {
    const { billingLayer } = makeLayer();
    const layer = billingLayer(row(), NOW);
    expect(layer?.planKey).toBe("pro");
    expect(layer?.plan).toEqual({ frozen: { seats: 5 } });
    expect(layer?.status).toBe("open");
  });

  it("ages the stored status before reading either table", () => {
    // The row still says `active`; the dates say otherwise, and it is the AGED
    // status that selects the gate — which is what makes a stalled sweep
    // harmless rather than a free-service leak.
    const { billingLayer } = makeLayer();
    const held = billingLayer(row(), overdueBy(GRACE_DAYS));
    expect(held?.billingStatus).toBe("past_due");
    expect(held?.status).toBe("held");
    // Restricting is not downgrading: the tier they bought is still theirs.
    expect(held?.planKey).toBe("pro");

    const closed = billingLayer(row(), overdueBy(SUSPEND_AFTER_DAYS));
    expect(closed?.billingStatus).toBe("unpaid");
    expect(closed?.status).toBe("closed");
  });
});

describe("a status that does not keep its tier", () => {
  it("reads the fallback from the LIVE catalog, not the frozen snapshot", () => {
    // The snapshot is the tier they stopped paying for, so it must not be the
    // thing they keep.
    const { billingLayer, calls } = makeLayer();
    const layer = billingLayer(row({ status: "canceled", entitlements: { seats: 99 } }), NOW);
    expect(calls.defaultTier).toBe(1);
    expect(layer?.planKey).toBe("free");
    expect(layer?.plan).toEqual(FREE_PLAN);
  });

  it("still states an OPINION rather than deferring", () => {
    // THE regression this exists for: returning null here would send the
    // resolver back to a hand-assigned key, very often the paid tier the
    // account was put on BEFORE subscribing — handing a cancelled customer
    // their paid entitlements back indefinitely.
    const { billingLayer } = makeLayer();
    const layer = billingLayer(row({ status: "canceled" }), NOW);
    expect(layer).not.toBeNull();
    expect(layer?.billingStatus).toBe("canceled");
    expect(layer?.status).toBe("open");
  });
});

describe("statuses that defer", () => {
  it("returns null when there is no subscription at all", () => {
    expect(makeLayer().billingLayer(null, NOW)).toBeNull();
  });

  it("returns null for a status this build does not recognise", () => {
    // A row written by a newer deploy — or by hand — must be able to neither
    // take a paying customer's account down nor grant them anything, and must
    // not downgrade them either.
    expect(makeLayer().billingLayer(row({ status: "paused" }), NOW)).toBeNull();
  });
});
