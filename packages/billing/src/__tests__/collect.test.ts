// @vitest-environment node
/**
 * Subscription collection (FUT-132/FUT-760) — the BINDING, not the flow.
 *
 * The guard order, the idempotency key and the record-only-what-exists rule
 * belong to `@12-apps/payments-backend`'s collector and are pinned in its own
 * suite. What is pinned here is the part this package contributes and could
 * get wrong on its own: that every call collects into the PLATFORM's merchant,
 * that the deployment-wide guard is asked before anything reaches a provider,
 * and that both stores are resolved per call rather than captured once.
 */
import { describe, expect, it, vi } from "vitest";

import type { CycleStore } from "@12-apps/payments-backend";

import { createSubscriptionCollection } from "../server/collect";
import { MERCHANT, fakeGateway, fakePayments } from "./fixtures";

const CYCLE = {
  id: "cycle-1",
  groupId: "sub-1",
  amount: { amountCents: 5900, currency: "BRL" },
  customer: { name: "Legal Entity Ltd", email: "billing@example.test", taxId: "1234" },
};

function charged(status: "PAID" | "DECLINED" = "PAID") {
  return {
    provider: "acquirer-a",
    providerChargeId: "chg-1",
    snapshot: { status, provider: "acquirer-a", providerChargeId: "chg-1" },
  };
}

function collection(options: { enabled?: boolean; instrument?: boolean } = {}) {
  const gateway = fakeGateway({ charge: vi.fn(async () => charged()) });
  const { payments } = fakePayments(gateway);
  const recordRaised = vi.fn(async () => undefined);
  const store: CycleStore = {
    read: async () => ({ cycle: CYCLE, providerChargeId: null }),
    recordRaised,
  } as unknown as CycleStore;
  const cycles = vi.fn(async () => store);
  return {
    gateway,
    cycles,
    recordRaised,
    collection: createSubscriptionCollection({
      payments,
      merchant: MERCHANT,
      enabled: async () => options.enabled ?? true,
      cycles,
      instruments: async () =>
        options.instrument === false
          ? { instrument: null, hasAny: false }
          : {
              instrument: {
                provider: "acquirer-a",
                providerInstrumentId: "pm-1",
                providerCustomerId: "cus-1",
              },
              hasAny: true,
            },
    }),
  };
}

describe("the deployment-wide guard", () => {
  it("skips quietly when this deployment cannot collect", async () => {
    // Fail CLOSED and EARLY: a sweep on an environment with no platform
    // account should do nothing rather than throw once per customer deep
    // inside the gateway.
    const { collection: collect, gateway } = collection({ enabled: false });
    await expect(collect.collectByCard("cycle-1")).resolves.toEqual({
      skipped: "no-platform-account",
      snapshot: null,
    });
    expect(gateway.charge).not.toHaveBeenCalled();
  });
});

describe("collectByCard", () => {
  it("charges the card on file into the platform's own merchant", async () => {
    // The inversion the whole surface rests on. Collecting into the customer's
    // own connected account would take their money and hand it straight back.
    const { collection: collect, gateway } = collection();
    await collect.collectByCard("cycle-1");

    expect(gateway.charge).toHaveBeenCalledTimes(1);
    const call = gateway.charge.mock.calls[0] ?? [];
    const [merchant, input] = call;
    expect(merchant).toEqual(MERCHANT);
    expect(input).toMatchObject({
      reference: "cycle-1",
      method: "CARD",
      idempotencyKey: "cycle-1",
      card: { savedCardToken: "pm-1", merchantInitiated: true },
    });
  });

  it("reports a card at a provider the platform no longer collects through", async () => {
    const { collection: collect } = collection({ instrument: false });
    await expect(collect.collectByCard("cycle-1")).resolves.toMatchObject({
      skipped: "no-instrument",
    });
  });
});

describe("collectByPush", () => {
  it("raises a charge needing no stored instrument", async () => {
    const { collection: collect, gateway } = collection({ instrument: false });
    await collect.collectByPush("cycle-1");
    expect(gateway.charge.mock.calls[0]?.[1]).toMatchObject({ method: "PIX" });
  });
});

describe("the stores are resolved per call", () => {
  it("asks for a fresh cycle store on every collection", async () => {
    // A host builds its store over a database client it resolves lazily;
    // capturing one at construction would pin a process to whichever client
    // happened to exist first.
    const { collection: collect, cycles } = collection();
    await collect.collectByCard("cycle-1");
    await collect.collectByPush("cycle-1");
    expect(cycles).toHaveBeenCalledTimes(2);
  });
});
