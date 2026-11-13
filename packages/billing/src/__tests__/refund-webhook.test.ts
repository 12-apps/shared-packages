// @vitest-environment node
/**
 * The subscription refund's webhook handler (FUT-4864): what a host hands to
 * ONE platform delivery (`handleWebhook(…, { onWebhookEvent })`). It acts only
 * on a REFUND_UPDATED event carrying a refund, verified against the binding's
 * own merchant, and its throw is the delivery's failure (the redelivery reruns it).
 */
import { describe, expect, it } from "vitest";

import type { NormalizedWebhookEvent } from "@12-apps/payments-backend";

import { MERCHANT } from "./fixtures";
import { harness, WITHIN } from "./refund-world";

function refundEvent(status: "PENDING" | "REFUNDED" | "FAILED"): NormalizedWebhookEvent {
  return {
    provider: "acquirer-a",
    eventId: `evt-${status}`,
    type: "REFUND_UPDATED",
    refund: {
      provider: "acquirer-a",
      providerChargeId: "chg-1",
      providerRefundId: "rf-1",
      status,
      amount: { amountCents: 5900, currency: "BRL" },
    },
  };
}

async function refunded() {
  const h = harness();
  await h.flow.refund("pay-1");
  return h;
}

describe("onWebhookEvent", () => {
  it("hands the platform's REFUNDED word to refundUpdated: the refund is confirmed", async () => {
    const h = await refunded();
    await h.flow.onWebhookEvent(refundEvent("REFUNDED"), null, MERCHANT);
    expect(h.held.confirmed).toBe(true);
  });

  it("hands FAILED on too: the refund is reopened as pending", async () => {
    const h = await refunded();
    await h.flow.onWebhookEvent(refundEvent("FAILED"), null, MERCHANT);
    expect(h.held.row).toMatchObject({ state: "REFUND_PENDING", pendingReason: "REFUSED" });
  });

  it("leaves a delivery verified against another merchant alone", async () => {
    const h = await refunded();
    await h.flow.onWebhookEvent(refundEvent("FAILED"), null, { kind: "TENANT", id: "store-1" });
    expect(h.confirmations.findByCharge).not.toHaveBeenCalled();
    expect(h.held.row.state).toBe("REFUNDED");
  });

  it.each([
    ["a charge update", { ...refundEvent("FAILED"), type: "CHARGE_UPDATED" as const }],
    ["a refund event with no refund", { ...refundEvent("FAILED"), refund: undefined }],
  ])("leaves %s alone", async (_label, event) => {
    const h = await refunded();
    await h.flow.onWebhookEvent(event, null, MERCHANT);
    expect(h.confirmations.findByCharge).not.toHaveBeenCalled();
  });

  it("throws when the host's write throws, so the delivery is marked failed and redelivered", async () => {
    const { flow, held, confirmations, later } = await refunded();
    later(WITHIN);
    confirmations.confirm.mockRejectedValueOnce(new Error("db down"));
    await expect(flow.onWebhookEvent(refundEvent("REFUNDED"), null, MERCHANT)).rejects.toThrow("db down");
    await flow.onWebhookEvent(refundEvent("REFUNDED"), null, MERCHANT);
    expect(held.confirmed).toBe(true);
  });
});
