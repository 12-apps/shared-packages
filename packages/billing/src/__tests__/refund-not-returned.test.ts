// @vitest-environment node
/**
 * A person's escape for a refund the provider accepted and never confirmed
 * (FUT-4864, owner 2026-11-13): "O provedor não devolveu". Only past the
 * deadline; one more read of the charge first (money back confirms it
 * instead); reopened under a NEW request with who and why for the host's
 * audit; never sends — and a confirm or a provider update that wins the race
 * leaves nothing to reopen.
 */
import { describe, expect, it } from "vitest";

import { harness, HOUR, T0_MS, WITHIN } from "./refund-world";

const BY = { by: "fin@paladira.com", reason: "Provedor não devolveu em 3 dias" };

async function overdueRefund(charge?: () => Promise<unknown>) {
  const h = harness(charge ? { charge } : {});
  await h.flow.refund("pay-1");
  h.later(WITHIN);
  return h;
}

describe("O provedor não devolveu", () => {
  it("past the deadline, reopens it as pending under a new request, with who and why, sending nothing", async () => {
    const h = await overdueRefund();
    const firstRequest = h.held.row.requestId;
    h.refund.mockClear();

    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "REOPENED", record: { reason: "NOT_RETURNED" } });
    const [, record] = h.confirmations.reopen.mock.calls[0] ?? [];
    expect(record).toMatchObject({ reason: "NOT_RETURNED", at: new Date(T0_MS + WITHIN), byHand: BY });
    expect(h.held.row).toMatchObject({ state: "REFUND_PENDING", pendingReason: "NOT_RETURNED" });
    expect(h.held.row.requestId).not.toBe(firstRequest);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("then a retry works as for any pending refund, consulting the charge first", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refund.mockClear();
    h.refund.mockResolvedValue({ providerRefundId: "rf-2", status: "REFUNDED", amount: { amountCents: 5900, currency: "BRL" } });
    await expect(h.flow.retry("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED" });
    expect(h.refreshCharge).toHaveBeenCalled();
    expect(h.refund).toHaveBeenCalledOnce();
  });

  it("is refused inside the deadline", async () => {
    const { flow, held, later } = harness();
    await flow.refund("pay-1");
    later(WITHIN - 1);
    await expect(flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "NOT_OVERDUE" });
    expect(held.row.state).toBe("REFUNDED");
  });

  it("reads the charge once more: money back confirms it instead", async () => {
    const h = await overdueRefund(async () => ({ status: "REFUNDED" }));
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "MONEY_BACK" });
    expect(h.held.confirmed).toBe(true);
    expect(h.confirmations.reopen).not.toHaveBeenCalled();
  });

  it("money back but confirmed by someone else first: says it was resolved, not that it confirmed", async () => {
    const h = await overdueRefund(async () => ({ status: "REFUNDED" }));
    h.confirmations.confirm.mockResolvedValueOnce(false);
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "ALREADY_RESOLVED" });
    expect(h.confirmations.reopen).not.toHaveBeenCalled();
  });

  it("says when the charge could not be read: the reopen rests on the person's word", async () => {
    const h = await overdueRefund(async () => {
      throw new Error("provider down");
    });
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "REOPENED", chargeRead: "UNREADABLE" });
  });

  it("reports a charge read that showed the money not back", async () => {
    const h = await overdueRefund();
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "REOPENED", chargeRead: "NOT_BACK" });
  });

  it.each([
    ["who", { by: "  ", reason: "Provedor não devolveu" }],
    ["why", { by: "fin@paladira.com", reason: "" }],
  ])("is refused with a blank %s, reading and writing nothing", async (_label, byHand) => {
    const h = await overdueRefund();
    h.refreshCharge.mockClear();
    await expect(h.flow.markNotReturned("pay-1", byHand)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "INCOMPLETE" });
    expect(h.refreshCharge).not.toHaveBeenCalled();
    expect(h.held.row.state).toBe("REFUNDED");
  });

  it("keeps the refund said never returned on the row", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    expect(h.confirmations.reopen.mock.calls[0]?.[1]).toMatchObject({ notReturnedRefundId: "rf-1" });
    expect(h.held.notReturnedRefundId).toBe("rf-1");
  });

  it("is refused for a refund confirmed meanwhile", async () => {
    const h = await overdueRefund();
    await h.flow.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "REFUNDED" });
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "NOT_FOUND" });
  });

  it("loses the race to a confirm landing between its read and its write: nothing reopened", async () => {
    const h = await overdueRefund();
    // The sweep confirms while this act reads the charge.
    h.refreshCharge.mockImplementationOnce(async () => {
      h.held.confirmed = true;
      return { status: "PAID" };
    });
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "ALREADY_RESOLVED" });
    expect(h.held.row.state).toBe("REFUNDED");
  });

  it("loses the race to the provider's FAILED reopening it first: reopened once", async () => {
    const h = await overdueRefund();
    h.refreshCharge.mockImplementationOnce(async () => {
      await h.flow.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "FAILED" });
      return { status: "PAID" };
    });
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "ALREADY_RESOLVED" });
    // The provider's reopen stands; this act's write found nothing to move.
    expect(h.held.row.pendingReason).toBe("REFUSED");
  });

  it("is refused for a payment with no refund", async () => {
    const { flow, later } = harness();
    later(HOUR);
    await expect(flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "NOT_FOUND" });
  });
});

const LATE = { provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "REFUNDED" } as const;

describe("the refund said never returned lands after all", () => {
  it("still pending: recorded returned (ADOPTED), and the new request sends nothing more", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refund.mockClear();

    await expect(h.flow.refundUpdated(LATE)).resolves.toBe("ADOPTED");
    expect(h.held.row.state).toBe("REFUNDED");
    expect(h.payments.markRefunded.mock.calls.at(-1)?.[1]).toMatchObject({ how: "ADOPTED", providerRefundId: "rf-1", confirmed: true });
    await expect(h.flow.retry("pay-1")).resolves.toMatchObject({ why: "ALREADY_REFUNDED" });
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("after it was settled by hand: recorded once as a double return for a person", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    await expect(h.flow.settleByHand("pay-1", { ...BY, via: "PIX" })).resolves.toMatchObject({ outcome: "REFUNDED" });

    await expect(h.flow.refundUpdated(LATE)).resolves.toBe("DOUBLE_RETURN");
    expect(h.held.doubleReturn).toMatchObject({ providerRefundId: "rf-1" });
    // The provider's redelivery records nothing twice.
    await expect(h.flow.refundUpdated(LATE)).resolves.toBe("IGNORED");
    expect(h.confirmations.doubleReturned).toHaveBeenCalledTimes(2);
  });

  it("after a second refund was recorded: a double return, while that refund's own word still confirms it", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refund.mockResolvedValue({ providerRefundId: "rf-2", status: "PENDING", amount: { amountCents: 5900, currency: "BRL" } });
    await h.flow.retry("pay-1");

    await expect(h.flow.refundUpdated(LATE)).resolves.toBe("DOUBLE_RETURN");
    await expect(h.flow.refundUpdated({ ...LATE, providerRefundId: "rf-2" })).resolves.toBe("CONFIRMED");
  });

  it("adopted by a hand settlement's charge read: its own late word is no double return", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refreshCharge.mockResolvedValue({ status: "REFUNDED" });
    await expect(h.flow.settleByHand("pay-1", { ...BY, via: "PIX" })).resolves.toMatchObject({ why: "MONEY_BACK" });

    await expect(h.flow.refundUpdated(LATE)).resolves.toBe("IGNORED");
    expect(h.confirmations.doubleReturned).not.toHaveBeenCalled();
  });

  it("adopted by a retry's consult: its own late word is no double return", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refreshCharge.mockResolvedValue({ status: "REFUNDED" });
    h.refund.mockClear();
    await h.flow.retry("pay-1");
    expect(h.held.row.state).toBe("REFUNDED");
    expect(h.refund).not.toHaveBeenCalled();

    await expect(h.flow.refundUpdated(LATE)).resolves.toBe("IGNORED");
    expect(h.confirmations.doubleReturned).not.toHaveBeenCalled();
  });

  it("a redelivery of the word that adopted it is ignored", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    await h.flow.refundUpdated(LATE);
    await expect(h.flow.refundUpdated(LATE)).resolves.toBe("IGNORED");
    expect(h.confirmations.doubleReturned).not.toHaveBeenCalled();
  });
});

describe("settling by hand a refund said never returned", () => {
  it("reads the charge first: still not back (the first refund still processing), it settles", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refreshCharge.mockClear();

    await expect(h.flow.settleByHand("pay-1", { ...BY, via: "PIX" })).resolves.toMatchObject({ outcome: "REFUNDED", record: { how: "BY_HAND" } });
    expect(h.refreshCharge).toHaveBeenCalledOnce();
  });

  it("money back: recorded returned (ADOPTED) and the hand settlement refused", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refreshCharge.mockResolvedValue({ status: "REFUNDED" });

    await expect(h.flow.settleByHand("pay-1", { ...BY, via: "PIX" })).resolves.toMatchObject({ outcome: "NOT_REFUNDABLE", why: "MONEY_BACK" });
    expect(h.held.row.state).toBe("REFUNDED");
    expect(h.payments.markRefunded.mock.calls.at(-1)?.[1]).toMatchObject({ how: "ADOPTED" });
  });

  it("money back but recorded returned by someone else first: says so, not MONEY_BACK", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refreshCharge.mockResolvedValue({ status: "REFUNDED" });
    h.payments.markRefunded.mockResolvedValueOnce(false);

    await expect(h.flow.settleByHand("pay-1", { ...BY, via: "PIX" })).resolves.toMatchObject({ outcome: "NOT_REFUNDABLE", why: "ALREADY_REFUNDED" });
  });

  it("an unreadable charge refuses it: nothing settled", async () => {
    const h = await overdueRefund();
    await h.flow.markNotReturned("pay-1", BY);
    h.refreshCharge.mockRejectedValue(new Error("provider down"));

    await expect(h.flow.settleByHand("pay-1", { ...BY, via: "PIX" })).resolves.toMatchObject({ outcome: "NOT_REFUNDABLE", why: "CHARGE_UNREADABLE" });
    expect(h.held.row.state).toBe("REFUND_PENDING");
  });
});
