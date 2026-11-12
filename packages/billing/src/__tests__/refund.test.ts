// @vitest-environment node
/**
 * Subscription refund (FUT-4864) — the provider call, its three outcomes, and
 * which of them write.
 *
 * Pinned here: that a refund is raised at the PLATFORM merchant against the
 * stored charge in full; that a provider refusal, an unsupported provider and
 * a lost answer each record a PENDING refund instead of throwing; that
 * "nothing to refund" is adopted as done (the safe retry); and that a payment
 * nobody asked to refund can never be refunded through `retry`.
 */
import { describe, expect, it, vi } from "vitest";

import {
  CredentialsError,
  NOTHING_TO_REFUND,
  ProviderRequestError,
  UnsupportedOperationError,
} from "@12-apps/payments-backend";

import {
  createSubscriptionRefund,
  type RefundablePayment,
  type RefundablePaymentStore,
} from "../server/refund";
import { MERCHANT } from "./fixtures";

const AT = new Date("2026-11-12T12:00:00.000Z");

const PAID: RefundablePayment = {
  id: "pay-1",
  state: "PAID",
  provider: "acquirer-a",
  providerChargeId: "chg-1",
  method: "PIX",
  amountCents: 5900,
  currency: "BRL",
};

function harness(options: { payment?: RefundablePayment | null; refund?: () => Promise<unknown> } = {}) {
  const payment = options.payment === undefined ? PAID : options.payment;
  const refund = vi.fn(
    options.refund ??
      (async () => ({
        provider: "acquirer-a",
        providerChargeId: "chg-1",
        providerRefundId: "rf-1",
        status: "REFUNDED",
        amount: { amountCents: 5900, currency: "BRL" },
      })),
  );
  const store = {
    find: vi.fn(async () => payment),
    markRefunded: vi.fn(async () => undefined),
    markRefundPending: vi.fn(async () => undefined),
  } satisfies RefundablePaymentStore;
  const subject = createSubscriptionRefund({
    payments: async () => ({ gateway: { refund } as never }),
    merchant: MERCHANT,
    store: async () => store,
    now: () => AT,
  });
  return { refunds: subject, refund, store };
}

describe("a refund the provider takes", () => {
  it("refunds the stored charge in full at the platform merchant and records it", async () => {
    const { refunds, refund, store } = harness();
    const answer = await refunds.refund("pay-1", { reason: "withdrawal" });

    expect(refund).toHaveBeenCalledWith(MERCHANT, "acquirer-a", { providerChargeId: "chg-1", reason: "withdrawal" });
    // No amount: a full refund returns whatever the provider took, instalment interest included.
    expect((refund.mock.calls[0] as unknown[] | undefined)?.[2]).not.toHaveProperty("amount");
    expect(answer).toEqual({
      outcome: "REFUNDED",
      paymentId: "pay-1",
      method: "PIX",
      record: { providerRefundId: "rf-1", confirmed: true, at: AT },
    });
    expect(store.markRefunded).toHaveBeenCalledWith("pay-1", { providerRefundId: "rf-1", confirmed: true, at: AT });
    expect(store.markRefundPending).not.toHaveBeenCalled();
  });

  it("records a refund the provider is still processing as refunded, unconfirmed", async () => {
    const { refunds, store } = harness({
      refund: async () => ({ providerRefundId: "rf-2", status: "PENDING", provider: "acquirer-a" }),
    });
    const answer = await refunds.refund("pay-1");
    expect(answer.outcome).toBe("REFUNDED");
    expect(store.markRefunded).toHaveBeenCalledWith("pay-1", { providerRefundId: "rf-2", confirmed: false, at: AT });
  });

  it("adopts 'nothing left to refund' as done, so a retry never refunds twice", async () => {
    const { refunds, store } = harness({
      payment: { ...PAID, state: "REFUND_PENDING" },
      refund: async () => {
        throw new ProviderRequestError("acquirer-a", "already refunded", { providerCode: NOTHING_TO_REFUND });
      },
    });
    const answer = await refunds.retry("pay-1");
    expect(answer.outcome).toBe("REFUNDED");
    expect(store.markRefunded).toHaveBeenCalledWith("pay-1", { providerRefundId: null, confirmed: true, at: AT });
  });
});

describe("a refund the provider does not take is recorded PENDING", () => {
  const cases: Array<[string, () => Promise<unknown>, string]> = [
    [
      "an answered refusal",
      async () => {
        throw new ProviderRequestError("acquirer-a", "charge too old", { httpStatus: 422 });
      },
      "REFUSED",
    ],
    [
      "no answer (a 5xx)",
      async () => {
        throw new ProviderRequestError("acquirer-a", "bad gateway", { httpStatus: 502 });
      },
      "UNKNOWN",
    ],
    [
      "a provider that does not refund",
      async () => {
        throw new UnsupportedOperationError("acquirer-a", "refunds");
      },
      "UNSUPPORTED",
    ],
    [
      "credentials that are gone",
      async () => {
        throw new CredentialsError("acquirer-a", "not connected");
      },
      "NO_CREDENTIALS",
    ],
    ["a FAILED snapshot", async () => ({ providerRefundId: "rf-3", status: "FAILED" }), "REFUSED"],
  ];

  it.each(cases)("%s", async (_label, providerAnswer, reason) => {
    const { refunds, store } = harness({ refund: providerAnswer });
    const answer = await refunds.refund("pay-1");
    expect(answer.outcome).toBe("PENDING");
    expect(answer).toMatchObject({ method: "PIX", record: { reason, at: AT } });
    expect(store.markRefundPending).toHaveBeenCalledWith("pay-1", expect.objectContaining({ reason, at: AT }));
    expect(store.markRefunded).not.toHaveBeenCalled();
  });

  it("keeps the provider's message for the operator", async () => {
    const { refunds } = harness({
      refund: async () => {
        throw new ProviderRequestError("acquirer-a", "  charge too old  ", { httpStatus: 422 });
      },
    });
    await expect(refunds.refund("pay-1")).resolves.toMatchObject({ record: { message: "charge too old" } });
  });

  it("records a paid payment with no provider charge as pending without calling the provider", async () => {
    const { refunds, refund, store } = harness({ payment: { ...PAID, providerChargeId: null } });
    const answer = await refunds.refund("pay-1");
    expect(answer).toMatchObject({ outcome: "PENDING", record: { reason: "NO_CHARGE" } });
    expect(refund).not.toHaveBeenCalled();
    expect(store.markRefundPending).toHaveBeenCalledOnce();
  });
});

describe("what is never refunded", () => {
  it.each([
    ["no such payment", null, "NOT_FOUND"],
    ["a payment already refunded", { ...PAID, state: "REFUNDED" as const }, "ALREADY_REFUNDED"],
    ["a payment never paid", { ...PAID, state: "OTHER" as const }, "NOT_PAID"],
  ])("%s: nothing is called and nothing written", async (_label, payment, why) => {
    const { refunds, refund, store } = harness({ payment });
    await expect(refunds.refund("pay-1")).resolves.toEqual({ outcome: "NOT_REFUNDABLE", paymentId: "pay-1", why });
    expect(refund).not.toHaveBeenCalled();
    expect(store.markRefunded).not.toHaveBeenCalled();
    expect(store.markRefundPending).not.toHaveBeenCalled();
  });

  it("retry refuses a paid payment nobody asked to refund", async () => {
    const { refunds, refund } = harness();
    await expect(refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "NOT_REFUNDABLE", why: "NOT_PAID" });
    expect(refund).not.toHaveBeenCalled();
  });

  it("retry asks the provider again for a pending refund", async () => {
    const { refunds, refund } = harness({ payment: { ...PAID, state: "REFUND_PENDING", method: "CARD" } });
    await expect(refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED", method: "CARD" });
    expect(refund).toHaveBeenCalledOnce();
  });
});
