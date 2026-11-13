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

  it("then retry and settle by hand work as for any pending refund", async () => {
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
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "NOT_FOUND" });
    expect(h.held.row.state).toBe("REFUNDED");
  });

  it("loses the race to the provider's FAILED reopening it first: reopened once", async () => {
    const h = await overdueRefund();
    h.refreshCharge.mockImplementationOnce(async () => {
      await h.flow.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "FAILED" });
      return { status: "PAID" };
    });
    await expect(h.flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "NOT_FOUND" });
    // The provider's reopen stands; this act's write found nothing to move.
    expect(h.held.row.pendingReason).toBe("REFUSED");
  });

  it("is refused for a payment with no refund", async () => {
    const { flow, later } = harness();
    later(HOUR);
    await expect(flow.markNotReturned("pay-1", BY)).resolves.toMatchObject({ outcome: "NOT_REOPENED", why: "NOT_FOUND" });
  });
});
