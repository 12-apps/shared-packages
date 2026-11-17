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

  it("round-trips an id that itself contains a colon", () => {
    expect(purchaseIdOf(purchaseReference("tenant:42:pack", 0))).toBe("tenant:42:pack");
    expect(purchaseIdOf(purchaseReference("tenant:42:pack", 3))).toBe("tenant:42:pack");
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
    w.held.settlement = { amountCents: 4_990, currency: "BRL", providerChargeId: "chg-x", paidAt: T0 };
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
    expect(w.granted[0]?.settled).toEqual({ amountCents: 4_990, currency: "BRL", providerChargeId: "chg-purchase:pur-1", paidAt: T0, excessCents: 0 });
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
    expect(before).toEqual({ settled: 0, failed: 0, stillPending: 1, unreadable: 0, delivered: 0, undelivered: 0 });

    const after = await w.purchases.reconcileDue(new Date(T0.getTime() + 31 * MINUTE));
    expect(after).toEqual({ settled: 0, failed: 1, stillPending: 0, unreadable: 0, delivered: 0, undelivered: 0 });
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

  it("a refunded charge on an unsettled purchase fails the attempt as CANCELED, logged once, and a retry raises anew", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PARTIALLY_REFUNDED" };

    expect((await w.purchases.reconcileDue(T0)).failed).toBe(1);
    expect(w.held.failures).toEqual([{ attempt: 0, providerChargeId: "chg-purchase:pur-1", reason: "CANCELED" }]);
    expect(w.logger.error).toHaveBeenCalledTimes(1);
    expect(w.logger.error).toHaveBeenCalledWith(expect.stringContaining("PARTIALLY_REFUNDED"));
    expect((await w.purchases.reconcileDue(T0)).failed).toBe(0);
    expect(w.logger.error).toHaveBeenCalledTimes(1);

    expect((await w.purchases.startByPush(PURCHASE.id)).skipped).toBeNull();
    expect(w.held.providerChargeId).toBe("chg-purchase:pur-1--1");
    expect(w.granted).toEqual([]);
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

});

describe("reconcileDue", () => {
  it("settles a charge the provider reports paid", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PAID" };

    const pass = await w.purchases.reconcileDue(T0);

    expect(pass).toEqual({ settled: 1, failed: 0, stillPending: 0, unreadable: 0, delivered: 0, undelivered: 0 });
    expect(w.gateway.refreshCharge).toHaveBeenCalledWith(MERCHANT, "acquirer-a", "chg-purchase:pur-1");
    expect(w.granted).toHaveLength(1);
  });

  it("marks a provider refusal failed, and leaves an unreadable charge for the next pass", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.gateway.refreshCharge.mockRejectedValueOnce(new Error("timeout"));
    expect(await w.purchases.reconcileDue(T0)).toEqual({ settled: 0, failed: 0, stillPending: 0, unreadable: 1, delivered: 0, undelivered: 0 });

    w.provider.refresh = { status: "CANCELED" };
    expect(await w.purchases.reconcileDue(T0)).toEqual({ settled: 0, failed: 1, stillPending: 0, unreadable: 0, delivered: 0, undelivered: 0 });
    expect(w.held.failures[0]?.reason).toBe("CANCELED");
  });

  it("uses the provider's fresher deadline over the recorded one", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PENDING", pix: { qrText: "x", expiresAt: new Date(T0.getTime() + 60 * MINUTE).toISOString() } };
    expect((await w.purchases.reconcileDue(new Date(T0.getTime() + 45 * MINUTE))).stillPending).toBe(1);
  });
});

describe("paid twice", () => {
  it("an older attempt paid late after a newer one settled is a duplicate payment: logged, handed to the hook, nothing delivered again", async () => {
    const w = purchaseWorld();
    w.provider.answer = () => ({ status: "DECLINED" } as Partial<ChargeSnapshot>);
    await w.purchases.startByCard(PURCHASE.id);
    w.provider.answer = () => ({ status: "PAID" });
    await w.purchases.startByCard(PURCHASE.id);
    expect(w.held.settledBy).toEqual(["chg-purchase:pur-1--1"]);

    const { reactor } = hostReactor(w.purchases);
    const late = paidEvent("purchase:pur-1", 4_990, "evt-late");
    await reactor(late.event, late.stored, MERCHANT);
    const outcome = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 4_990,
      providerChargeId: "chg-purchase:pur-1",
    });

    expect(outcome).toBe("duplicate-payment");
    expect(w.granted).toHaveLength(1);
    expect(w.hooks.onDuplicatePayment).toHaveBeenCalledWith(PURCHASE, { amountCents: 4_990, providerChargeId: "chg-purchase:pur-1" });
    expect(w.logger.error).toHaveBeenCalledWith(expect.stringContaining("PAID AGAIN"));
  });

  it("a replay of the settling charge stays already-settled, with no hook", async () => {
    const w = purchaseWorld();
    await w.purchases.startByCard(PURCHASE.id);
    const again = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 4_990,
      providerChargeId: "chg-purchase:pur-1",
    });
    expect(again).toBe("already-settled");
    expect(w.hooks.onDuplicatePayment).not.toHaveBeenCalled();
  });

  it("settling by one attempt's charge voids the other attempt still open at the provider, best-effort", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.held.attempt = 1; // a newer attempt is current, its code still open
    w.held.providerChargeId = "chg-open";
    w.held.provider = "acquirer-a";
    w.gateway.cancelCharge.mockRejectedValueOnce(new Error("provider cannot void"));

    const outcome = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 4_990,
      providerChargeId: "chg-purchase:pur-1",
    });

    expect(outcome).toBe("granted");
    expect(w.gateway.cancelCharge).toHaveBeenCalledWith(MERCHANT, "acquirer-a", "chg-open");
    expect(w.logger.warn).toHaveBeenCalledWith(expect.stringContaining("could not void open charge chg-open: provider cannot void"));
  });
});

describe("delivery is at-least-once", () => {
  it("an onSettled that throws once is delivered by the sweep, once", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    const deliver = w.hooks.onSettled;
    w.hooks.onSettled = vi.fn().mockRejectedValueOnce(new Error("grant failed")).mockImplementation(deliver);

    const outcome = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 4_990,
      providerChargeId: "chg-purchase:pur-1",
    });
    expect(outcome).toBe("delivery-pending");
    expect(w.held.status).toBe("paid");
    expect(w.granted).toEqual([]);
    expect(w.logger.error).toHaveBeenCalledWith(expect.stringContaining("delivery threw: grant failed"));

    expect((await w.purchases.reconcileDue(T0)).delivered).toBe(1);
    expect((await w.purchases.reconcileDue(T0)).delivered).toBe(0);
    expect(w.granted).toHaveLength(1);
    expect(w.held.delivered).toBe(true);
  });

  it("a card paid at the screen whose delivery throws does not throw; the sweep delivers it", async () => {
    const w = purchaseWorld();
    const deliver = w.hooks.onSettled;
    w.hooks.onSettled = vi.fn().mockRejectedValueOnce(new Error("grant failed")).mockImplementation(deliver);

    const result = await w.purchases.startByCard(PURCHASE.id);
    expect(result.snapshot?.status).toBe("PAID");
    expect(w.granted).toEqual([]);

    const pass = await w.purchases.reconcileDue(T0);
    expect(pass).toEqual({ settled: 0, failed: 0, stillPending: 0, unreadable: 0, delivered: 1, undelivered: 0 });
    expect(w.granted).toHaveLength(1);
  });

  it("keeps retrying while delivery keeps throwing", async () => {
    const w = purchaseWorld();
    w.hooks.onSettled = vi.fn().mockRejectedValue(new Error("down"));
    await w.purchases.startByCard(PURCHASE.id);
    expect((await w.purchases.reconcileDue(T0)).undelivered).toBe(1);
    expect((await w.purchases.reconcileDue(T0)).undelivered).toBe(1);
    expect(w.held.delivered).toBe(false);
  });
});

describe("currency", () => {
  it("refuses a payment in another currency than owed, like a shortfall", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    const outcome = await w.purchases.settlePlatformCharge({
      reference: "purchase:pur-1",
      amountCents: 4_990,
      currency: "USD",
      providerChargeId: "chg-purchase:pur-1",
    });
    expect(outcome).toBe("currency-mismatch");
    expect(w.store.claimSettled).not.toHaveBeenCalled();
    expect(w.granted).toEqual([]);
  });

  it("reads the currency off the stored charge when the webhook input carries none", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    const stored = w.charges.get("purchase:pur-1");
    if (!stored) throw new Error("no stored charge");
    w.charges.set("purchase:pur-1", { ...stored, snapshot: { ...stored.snapshot, amount: { amountCents: 4_990, currency: "USD" } } });

    const { reactor } = hostReactor(w.purchases);
    const { event, stored: row } = paidEvent("purchase:pur-1");
    await reactor(event, row, MERCHANT);

    expect(w.chargeStore.findByIdempotencyKey).toHaveBeenCalledWith(MERCHANT, "purchase:pur-1");
    expect(w.held.status).toBe("pending");
    expect(w.granted).toEqual([]);
  });

  it("refuses a sweep-read payment in another currency", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PAID", amount: { amountCents: 4_990, currency: "USD" } };
    expect((await w.purchases.reconcileDue(T0)).stillPending).toBe(1);
    expect(w.granted).toEqual([]);
  });
});

describe("log noise", () => {
  it("logs a PAID shortfall at error once per charge, then at warn on later passes", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.provider.refresh = { status: "PAID", amount: { amountCents: 100, currency: "BRL" } };
    await w.purchases.reconcileDue(T0);
    await w.purchases.reconcileDue(T0);
    expect(w.logger.error).toHaveBeenCalledTimes(1);
    expect(w.logger.warn).toHaveBeenCalledWith(expect.stringContaining("short of 4990"));
  });

  it("logs the provider's error message when a charge cannot be read", async () => {
    const w = purchaseWorld();
    await w.purchases.startByPush(PURCHASE.id);
    w.gateway.refreshCharge.mockRejectedValueOnce(new Error("upstream 503"));
    await w.purchases.reconcileDue(T0);
    expect(w.logger.warn).toHaveBeenCalledWith(expect.stringContaining("unreadable: upstream 503"));
  });
});
