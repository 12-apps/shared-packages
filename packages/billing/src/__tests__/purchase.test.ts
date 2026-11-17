// @vitest-environment node
/**
 * One-off purchases (FUT-5094) — the CONTRACT.
 *
 * A customer buys something from the platform once and pays in advance; the
 * host delivers it on CONFIRMED settlement, exactly once. Every case below is
 * a way that goes wrong on a money path: delivered twice for one payment,
 * delivered for a partial one, never delivered for a real one, or a retry that
 * can never be paid because the provider keeps answering the dead charge.
 *
 * Settlement runs through payments-backend's REAL webhook reactor, bound the
 * way a host binds it: `settlePlatformPayment` asks `settlePlatformCharge`
 * first and settles a cycle only on `"not-mine"`.
 */
import { describe, expect, it, vi } from "vitest";

import { createWebhookReactor, type ChargeSnapshot, type NormalizedWebhookEvent } from "@12-apps/payments-backend";

import {
  PURCHASE_REFERENCE_PREFIX,
  createOneOffPurchase,
  purchaseIdOf,
  purchaseReference,
  type OneOffPurchase,
} from "../server/index";
import { MERCHANT } from "./fixtures";
import { MINUTE, PURCHASE, T0, purchaseWorld, storedOf } from "./purchase-world";

/** The host's binding of the reactor: purchases first, then its own cycle settle. */
function hostReactor(purchases: OneOffPurchase) {
  const settleCycle = vi.fn<(input: unknown) => Promise<void>>(async () => undefined);
  const reactor = createWebhookReactor({
    settlePayable: vi.fn(async () => undefined),
    payableIsOpen: async () => false,
    parkReversal: vi.fn(async () => undefined),
    recordDispute: vi.fn(async () => undefined),
    async settlePlatformPayment(input) {
      if ((await purchases.settlePlatformCharge(input)) === "not-mine") await settleCycle(input);
    },
  });
  return { reactor, settleCycle };
}

function paidEvent(reference: string, amountCents = PURCHASE.amount.amountCents, eventId = "evt-1") {
  const snapshot = {
    provider: "acquirer-a",
    providerChargeId: `chg-${reference}`,
    reference,
    status: "PAID",
    amount: { amountCents, currency: "BRL" },
    method: "PIX",
  } as ChargeSnapshot;
  const event: NormalizedWebhookEvent = { provider: "acquirer-a", eventId, type: "CHARGE_UPDATED", charge: snapshot };
  return { event, stored: storedOf(reference, snapshot) };
}

describe("the purchase reference", () => {
  it("is a prefix the package owns, with the payments attempt suffix from the second attempt", () => {
    expect(purchaseReference("pur-1", 0)).toBe(`${PURCHASE_REFERENCE_PREFIX}pur-1`);
    expect(purchaseReference("pur-1", 2)).toBe("purchase:pur-1--2");
    expect(purchaseIdOf("purchase:pur-1--2")).toBe("pur-1");
  });

  it("names no purchase for a cycle's bare id", () => {
    expect(purchaseIdOf("cycle-1")).toBeNull();
    expect(purchaseIdOf("c1a2b3purchase:x")).toBeNull();
    expect(purchaseIdOf("purchase:")).toBeNull();
  });
});

describe("raising a purchase charge", () => {
  it("raises a push code at the platform merchant under the purchase reference, and records its expiry", async () => {
    const w = purchaseWorld();
    const result = await w.purchases.startByPush(PURCHASE.id);

    expect(result.skipped).toBeNull();
    expect(w.gateway.charge).toHaveBeenCalledWith(
      MERCHANT,
      expect.objectContaining({ reference: "purchase:pur-1", idempotencyKey: "purchase:pur-1", method: "PIX", amount: PURCHASE.amount }),
    );
    expect(w.held.raised).toEqual([
      expect.objectContaining({ attempt: 0, providerChargeId: "chg-purchase:pur-1", method: "PIX", expiresAt: new Date(T0.getTime() + 30 * MINUTE) }),
    ]);
    expect(w.granted).toEqual([]);
  });

  it("does not raise a second code while one is outstanding", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    const again = await w.purchases.startByPush(PURCHASE.id);
    expect(again.skipped).toBe("already-charged");
    expect(w.gateway.charge).toHaveBeenCalledTimes(1);
  });

  it("answers unknown and settled purchases with the collector's own skips", async () => {
    expect((await purchaseWorld({ exists: false }).purchases.startByPush(PURCHASE.id)).skipped).toBe("unknown-payment");
    const w = purchaseWorld();
    w.held.status = "paid";
    expect((await w.purchases.startByCard(PURCHASE.id)).skipped).toBe("already-paid");
    expect(w.gateway.charge).not.toHaveBeenCalled();
  });

  it("refuses an id the attempt convention cannot carry, before any read", async () => {
    const w = purchaseWorld();
    expect((await w.purchases.startByPush("pur--1")).skipped).toBe("unknown-payment");
    expect(w.store.read).not.toHaveBeenCalled();
    expect(w.logger.error).toHaveBeenCalled();
  });

  it("settles a card the provider answers PAID at once, delivering once", async () => {
    const w = purchaseWorld();
    const result = await w.purchases.startByCard(PURCHASE.id, { cardholderPresent: true });

    expect(result.snapshot?.status).toBe("PAID");
    expect(w.gateway.charge).toHaveBeenCalledWith(
      MERCHANT,
      expect.objectContaining({ method: "CARD", card: expect.objectContaining({ savedCardToken: "pm-1", merchantInitiated: false }) }),
    );
    expect(w.granted).toHaveLength(1);
    expect(w.held.status).toBe("paid");
  });
});

describe("exactly once", () => {
  it("a replayed webhook settles and delivers once", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    const { reactor, settleCycle } = hostReactor(w.purchases);
    const { event, stored } = paidEvent("purchase:pur-1");

    await reactor(event, stored, MERCHANT);
    await reactor(event, stored, MERCHANT);

    expect(w.granted).toHaveLength(1);
    expect(w.granted[0]?.settled).toEqual({ amountCents: 4_990, providerChargeId: "chg-purchase:pur-1", paidAt: T0, excessCents: 0 });
    expect(w.store.claimSettled).toHaveBeenCalledTimes(1);
    expect(settleCycle).not.toHaveBeenCalled();
  });

  it("concurrent confirmations deliver exactly once", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PAID" };
    const input = { reference: "purchase:pur-1", amountCents: 4_990, providerChargeId: "chg-purchase:pur-1" };

    const outcomes = await Promise.all([
      w.purchases.settlePlatformCharge(input),
      w.purchases.settlePlatformCharge(input),
      w.purchases.reconcileDue(T0).then(() => "sweep"),
    ]);

    expect(w.granted).toHaveLength(1);
    expect(outcomes.filter((o) => o === "granted")).toHaveLength(1);
  });
});

describe("a failed attempt", () => {
  it("a declined card delivers nothing, marks the attempt failed, and a retry raises a FRESH charge that can pay", async () => {
    const w = purchaseWorld();
    w.provider.answer = () => ({ status: "DECLINED", declineReason: "INSUFFICIENT_FUNDS" } as Partial<ChargeSnapshot>);
    const declined = await w.purchases.startByCard(PURCHASE.id);

    expect(declined.snapshot?.status).toBe("DECLINED");
    expect(w.granted).toEqual([]);
    expect(w.held.failures).toEqual([
      { attempt: 0, providerChargeId: "chg-purchase:pur-1", reason: "DECLINED", declineReason: "INSUFFICIENT_FUNDS" },
    ]);

    w.provider.answer = () => ({ status: "PAID" });
    const retried = await w.purchases.startByCard(PURCHASE.id);

    expect(w.gateway.charge).toHaveBeenLastCalledWith(
      MERCHANT,
      expect.objectContaining({ reference: "purchase:pur-1--1", idempotencyKey: "purchase:pur-1--1" }),
    );
    expect(retried.snapshot?.status).toBe("PAID");
    expect(w.granted).toHaveLength(1);
  });

  it("an expired push code delivers nothing and is marked failed by the sweep; a retry can still pay", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);

    const before = await w.purchases.reconcileDue(new Date(T0.getTime() + 29 * MINUTE));
    expect(before).toEqual({ settled: 0, failed: 0, stillPending: 1, unreadable: 0 });

    const after = await w.purchases.reconcileDue(new Date(T0.getTime() + 31 * MINUTE));
    expect(after).toEqual({ settled: 0, failed: 1, stillPending: 0, unreadable: 0 });
    expect(w.held.failures).toEqual([{ attempt: 0, providerChargeId: "chg-purchase:pur-1", reason: "EXPIRED" }]);
    expect(w.granted).toEqual([]);

    const retried = await w.purchases.startByPush(PURCHASE.id);
    expect(retried.skipped).toBeNull();
    expect(w.held.providerChargeId).toBe("chg-purchase:pur-1--1");

    const { reactor } = hostReactor(w.purchases);
    const { event, stored } = paidEvent("purchase:pur-1--1");
    await reactor(event, stored, MERCHANT);
    expect(w.granted).toHaveLength(1);
  });

  it("a lapsed code paid late still settles when nothing else has", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    await w.purchases.reconcileDue(new Date(T0.getTime() + 31 * MINUTE));

    const outcome = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 4_990,
      providerChargeId: "chg-purchase:pur-1",
    });
    expect(outcome).toBe("granted");
    expect(w.granted).toHaveLength(1);
  });
});

describe("what was paid against what is owed", () => {
  it("refuses a shortfall before claiming: nothing delivered, still payable", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    const outcome = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 4_989,
      providerChargeId: "chg-purchase:pur-1",
    });

    expect(outcome).toBe("shortfall");
    expect(w.store.claimSettled).not.toHaveBeenCalled();
    expect(w.granted).toEqual([]);
    expect(w.held.status).toBe("pending");
    expect(w.logger.error).toHaveBeenCalledWith(expect.stringContaining("short of 4990"));
  });

  it("settles an overpayment, delivers the purchase only, and reports the excess", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    const outcome = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 5_000,
      providerChargeId: "chg-purchase:pur-1",
    });

    expect(outcome).toBe("granted");
    expect(w.granted).toEqual([{ purchase: PURCHASE, settled: expect.objectContaining({ amountCents: 5_000, excessCents: 10 }) }]);
    expect(w.logger.warn).toHaveBeenCalledWith(expect.stringContaining("10 past what was owed"));
  });
});

describe("dispatch from the platform settle", () => {
  it("returns not-mine for a cycle reference, and the host's cycle settle runs untouched", async () => {
    const w = purchaseWorld();
    const { reactor, settleCycle } = hostReactor(w.purchases);
    const { event, stored } = paidEvent("cycle-1");

    await reactor(event, stored, MERCHANT);

    expect(await w.purchases.settlePlatformCharge({ reference: "cycle-1", amountCents: 1, providerChargeId: "c" })).toBe("not-mine");
    expect(settleCycle).toHaveBeenCalledWith({ reference: "cycle-1", amountCents: 4_990, providerChargeId: "chg-cycle-1" });
    expect(w.store.read).not.toHaveBeenCalled();
    expect(w.granted).toEqual([]);
  });

  it("reports a purchase reference with no row as unknown, never as a cycle", async () => {
    const w = purchaseWorld({ exists: false });
    const outcome = await w.purchases.settlePlatformCharge({ reference: "purchase:ghost", amountCents: 1, providerChargeId: "c" });
    expect(outcome).toBe("unknown");
    expect(w.logger.error).toHaveBeenCalled();
  });

  it("keeps the claim and rethrows when delivering throws", async () => {
    const w = purchaseWorld();
    const failing = vi.fn(async () => {
      throw new Error("grant failed");
    });
    const purchases = createOneOffPurchase({
      payments: async () => ({ gateway: w.gateway, credentials: { defaultProvider: async () => "acquirer-a" } }) as never,
      merchant: MERCHANT,
      enabled: async () => true,
      instruments: async () => ({ instrument: null, hasAny: false }),
      purchases: async () => w.store,
      onSettled: failing,
      logger: w.logger,
    });
    const input = { reference: "purchase:pur-1", amountCents: 4_990, providerChargeId: "chg-1" };

    await expect(purchases.settlePlatformCharge(input)).rejects.toThrow("grant failed");
    expect(w.held.status).toBe("paid");
    expect(await purchases.settlePlatformCharge(input)).toBe("already-settled");
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileDue", () => {
  it("settles a charge the provider reports paid", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PAID" };

    const pass = await w.purchases.reconcileDue(T0);

    expect(pass).toEqual({ settled: 1, failed: 0, stillPending: 0, unreadable: 0 });
    expect(w.gateway.refreshCharge).toHaveBeenCalledWith(MERCHANT, "acquirer-a", "chg-purchase:pur-1");
    expect(w.granted).toHaveLength(1);
  });

  it("marks a provider refusal failed, and leaves an unreadable charge for the next pass", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.gateway.refreshCharge.mockRejectedValueOnce(new Error("timeout"));
    expect(await w.purchases.reconcileDue(T0)).toEqual({ settled: 0, failed: 0, stillPending: 0, unreadable: 1 });

    w.provider.refresh = { status: "CANCELED" };
    expect(await w.purchases.reconcileDue(T0)).toEqual({ settled: 0, failed: 1, stillPending: 0, unreadable: 0 });
    expect(w.held.failures[0]?.reason).toBe("CANCELED");
  });

  it("uses the provider's fresher deadline over the recorded one", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PENDING", pix: { qrText: "x", expiresAt: new Date(T0.getTime() + 60 * MINUTE).toISOString() } };
    expect((await w.purchases.reconcileDue(new Date(T0.getTime() + 45 * MINUTE))).stillPending).toBe(1);
  });
});
