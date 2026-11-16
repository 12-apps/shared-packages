// @vitest-environment node
/**
 * The collection guard on a cycle's breakdown (FUT-5094) — the CONTRACT.
 *
 * A cycle that carries a breakdown is charged only when the breakdown sums to
 * the amount the host's cycle row will charge. A row whose lines and amount
 * disagree is a deployment bug, and the money boundary is the last place to
 * catch it before the customer is billed a number nobody can explain on the
 * receipt — so it THROWS (`BillingBreakdownError`) and nothing reaches the
 * provider, the same "a skip is an answer, only a fault throws" line the
 * collector draws.
 *
 * The port is optional, `breakdowns` on `createSubscriptionCollection`: a
 * cycle with no breakdown (null — every cycle before this ticket) charges
 * exactly as today. On `main` the port does not exist, so the dependency is
 * ignored and the mismatching cycles below are charged: those cases fail.
 */
import { describe, expect, it, vi } from "vitest";

import type { CycleStore } from "@12-apps/payments-backend";

import type { CycleCharge } from "../index";
import {
  BillingBreakdownError,
  createSubscriptionCollection,
  type CycleBreakdownLookup,
  type SubscriptionCollectionDeps,
} from "../server/index";

import { MERCHANT, fakeGateway, fakePayments } from "./fixtures";

const PERIOD = { start: new Date("2026-11-10T00:00:00.000Z"), end: new Date("2026-12-10T00:00:00.000Z") };
const ENDED = { start: new Date("2026-10-10T00:00:00.000Z"), end: PERIOD.start };

const CYCLE = {
  id: "cycle-1",
  groupId: "sub-1",
  amount: { amountCents: 41_750, currency: "BRL" },
  customer: { name: "Legal Entity Ltd", email: "billing@example.test", taxId: "1234" },
};

const SUMS: CycleCharge = {
  amountCents: 41_750,
  currency: "BRL",
  lines: [
    { kind: "BASE", amountCents: 29_900, period: PERIOD },
    {
      kind: "OVERAGE",
      meter: "units",
      period: ENDED,
      used: 1237,
      allowance: 1000,
      quantity: 237,
      unitPriceCents: 50,
      amountCents: 11_850,
    },
  ],
};

function collection(breakdown: CycleCharge | null) {
  const gateway = fakeGateway({
    charge: vi.fn(async () => ({
      provider: "acquirer-a",
      providerChargeId: "chg-1",
      snapshot: { status: "PAID", provider: "acquirer-a", providerChargeId: "chg-1" },
    })),
  });
  const { payments } = fakePayments(gateway);
  const store = {
    read: async () => ({ cycle: CYCLE, providerChargeId: null }),
    recordRaised: vi.fn(async () => undefined),
  } as unknown as CycleStore;
  const breakdowns: CycleBreakdownLookup = vi.fn(async () => breakdown);
  const deps = {
    payments,
    merchant: MERCHANT,
    enabled: async () => true,
    cycles: async () => store,
    instruments: async () => ({
      instrument: { provider: "acquirer-a", providerInstrumentId: "pm-1", providerCustomerId: "cus-1" },
      hasAny: true,
    }),
    breakdowns,
  } as SubscriptionCollectionDeps;
  return { gateway, breakdowns, collect: createSubscriptionCollection(deps) };
}

/** The name of what `run` rejected with, or null when it resolved. */
async function rejectedName(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.name : "non-error";
  }
  return null;
}

describe("a cycle whose breakdown disagrees with its amount", () => {
  it("is never charged by card", async () => {
    expect(BillingBreakdownError).toBeTypeOf("function");
    const { collect, gateway } = collection({ ...SUMS, amountCents: 29_900 });
    expect(await rejectedName(() => collect.collectByCard("cycle-1"))).toBe("BillingBreakdownError");
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it("is never charged by push", async () => {
    expect(BillingBreakdownError).toBeTypeOf("function");
    const lines = SUMS.lines.slice(0, 1);
    const { collect, gateway } = collection({ ...SUMS, lines });
    expect(await rejectedName(() => collect.collectByPush("cycle-1"))).toBe("BillingBreakdownError");
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it("is never charged in another currency than its lines", async () => {
    expect(BillingBreakdownError).toBeTypeOf("function");
    const { collect, gateway } = collection({ ...SUMS, currency: "USD" });
    expect(await rejectedName(() => collect.collectByCard("cycle-1"))).toBe("BillingBreakdownError");
    expect(gateway.charge).not.toHaveBeenCalled();
  });
});

describe("a cycle whose breakdown sums", () => {
  it("asks the port for THIS cycle, and charges the amount unchanged", async () => {
    const { collect, gateway, breakdowns } = collection(SUMS);
    await collect.collectByCard("cycle-1");
    expect(breakdowns).toHaveBeenCalledWith("cycle-1");
    expect(gateway.charge).toHaveBeenCalledTimes(1);
    const [, request] = gateway.charge.mock.calls[0] ?? [];
    expect(request).toMatchObject({ amount: { amountCents: 41_750, currency: "BRL" }, idempotencyKey: "cycle-1" });
  });
});
