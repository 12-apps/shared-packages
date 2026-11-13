// @vitest-environment node
/**
 * Subscription refund (FUT-4864) — the BINDING of the payments package's refund
 * retrier to a subscription payment.
 *
 * The retrier's own schedule, claim and consult are pinned in
 * `@12-apps/payments-backend`'s suite. Pinned here is what this package adds
 * and could get wrong: that attempt 1 is sent ONCE (the host row's claim), at
 * the PLATFORM merchant, in full; that every answer lands on the payment row
 * as refunded or pending; that a person's retry consults the charge before it
 * sends; that a hand settlement waits for a running attempt; and that a lost
 * write is healed by the sweep rather than left wrong.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryRefundRetryStore,
  CredentialsError,
  NOTHING_TO_REFUND,
  ProviderRequestError,
  REFUND_CLAIM_TTL_MS,
  UnsupportedOperationError,
} from "@12-apps/payments-backend";

import { createSubscriptionRefund } from "../server/refund";
import {
  SUBSCRIPTION_REFUND_SUBJECT,
  type RefundablePayment,
  type RefundablePaymentStore,
  type RefundPendingRecord,
  type RefundRecord,
} from "../server/refund-ports";
import { MERCHANT } from "./fixtures";

const T0_ISO = "2026-11-12T12:00:00.000Z";
const T0 = new Date(T0_ISO);

const PAID: RefundablePayment = {
  id: "pay-1",
  state: "PAID",
  provider: "acquirer-a",
  providerChargeId: "chg-1",
  method: "PIX",
  amountCents: 5900,
  currency: "BRL",
  requestedAt: null,
  pendingReason: null,
  requestId: null,
};

/** The host's rows, with the conditional writes the port asks for. */
function paymentRows(initial: RefundablePayment | null) {
  const held: { row: RefundablePayment | null } = { row: initial ? { ...initial } : null };
  const refundedWith: RefundRecord[] = [];
  const pendingWith: RefundPendingRecord[] = [];
  const store = {
    find: vi.fn(async () => (held.row ? { ...held.row } : null)),
    claim: vi.fn(async (_id: string, at: Date, requestId: string) => {
      if (!held.row || held.row.state !== "PAID") return false;
      held.row = { ...held.row, state: "REFUND_PENDING", requestedAt: at, requestId };
      return true;
    }),
    markRefunded: vi.fn(async (_id: string, record: RefundRecord) => {
      if (!held.row || held.row.state !== "REFUND_PENDING") return false;
      held.row = { ...held.row, state: "REFUNDED" };
      refundedWith.push(record);
      return true;
    }),
    markRefundPending: vi.fn(async (_id: string, record: RefundPendingRecord) => {
      if (!held.row || held.row.state !== "REFUND_PENDING") return false;
      held.row = { ...held.row, pendingReason: record.reason };
      pendingWith.push(record);
      return true;
    }),
  } satisfies RefundablePaymentStore;
  return { store, refundedWith, pendingWith, current: () => held.row };
}

type Answer = () => Promise<unknown>;

const TAKEN: Answer = async () => ({
  provider: "acquirer-a",
  providerChargeId: "chg-1",
  providerRefundId: "rf-1",
  status: "REFUNDED",
  amount: { amountCents: 5900, currency: "BRL" },
});

const BACK: Answer = async () => ({ status: "REFUNDED", amount: { amountCents: 5900, currency: "BRL" } });

function harness(options: { payment?: RefundablePayment | null; refund?: Answer; charge?: Answer } = {}) {
  const clock = { at: T0 };
  const hostRows = paymentRows(options.payment === undefined ? PAID : options.payment);
  const refund = vi.fn(options.refund ?? TAKEN);
  const refreshCharge = vi.fn(options.charge ?? (async () => ({ status: "PAID" })));
  const series = createMemoryRefundRetryStore();
  const flow = createSubscriptionRefund({
    payments: async () => ({ gateway: { refund, refreshCharge } as never }),
    merchant: MERCHANT,
    store: async () => hostRows.store,
    series: async () => series,
    now: () => clock.at,
  });
  return {
    refunds: flow,
    refund,
    refreshCharge,
    series,
    rows: hostRows,
    advance: (ms: number) => {
      clock.at = new Date(clock.at.getTime() + ms);
    },
  };
}

const refusedWith = (status: number) => async () => {
  throw new ProviderRequestError("acquirer-a", "charge too old", { httpStatus: status });
};

describe("attempt 1", () => {
  it("refunds the stored charge in full at the platform merchant, once, and records what went back", async () => {
    const h = harness();
    const answer = await h.refunds.refund("pay-1", { reason: "withdrawal" });

    expect(h.refund).toHaveBeenCalledTimes(1);
    const [merchant, provider, input] = h.refund.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>];
    expect(merchant).toEqual(MERCHANT);
    expect(provider).toBe("acquirer-a");
    expect(input).toMatchObject({ providerChargeId: "chg-1", reason: "withdrawal", retriedByCaller: true });
    expect(input.signal).toBeInstanceOf(AbortSignal);
    // No amount: a full refund returns whatever the provider took, instalment interest included.
    expect(input).not.toHaveProperty("amount");
    expect(answer).toMatchObject({ outcome: "REFUNDED", method: "PIX" });
    expect(h.rows.refundedWith).toEqual([
      { how: "PROVIDER", providerRefundId: "rf-1", refundedCents: 5900, confirmed: true, at: T0 },
    ]);
    expect(h.rows.current()?.state).toBe("REFUNDED");
  });

  it("records a refund the provider accepted but is still processing as unconfirmed", async () => {
    const h = harness({
      refund: async () => ({ providerRefundId: "rf-2", status: "PENDING", amount: { amountCents: 5900, currency: "BRL" } }),
    });
    await expect(h.refunds.refund("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED", record: { confirmed: false } });
  });

  it("adopts 'nothing left to refund' with the amount the charge shows", async () => {
    const h = harness({
      refund: async () => {
        throw new ProviderRequestError("acquirer-a", "already refunded", { providerCode: NOTHING_TO_REFUND });
      },
      charge: BACK,
    });
    await expect(h.refunds.refund("pay-1")).resolves.toMatchObject({
      outcome: "REFUNDED",
      record: { how: "ADOPTED", refundedCents: 5900 },
    });
  });

  it.each([
    ["an answered refusal", refusedWith(422), "REFUSED"],
    ["a FAILED snapshot", async () => ({ providerRefundId: "rf-3", status: "FAILED" }), "REFUSED"],
    ["no answer (a 5xx)", refusedWith(502), "UNKNOWN"],
    [
      "the provider's 'not yet'",
      async () => {
        throw new ProviderRequestError("acquirer-a", "try later", { refundRefusal: "NOT_YET" });
      },
      "NOT_YET",
    ],
    [
      "a timeout",
      async () => {
        throw Object.assign(new Error("deadline"), { name: "TimeoutError" });
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
    [
      "an error nothing classifies",
      async () => {
        throw new TypeError("boom");
      },
      "UNKNOWN",
    ],
  ])("%s is recorded PENDING with why", async (_label, providerAnswer, reason) => {
    const h = harness({ refund: providerAnswer as Answer });
    const answer = await h.refunds.refund("pay-1");
    expect(answer).toMatchObject({ outcome: "PENDING", method: "PIX", record: { reason } });
    expect(h.rows.current()).toMatchObject({ state: "REFUND_PENDING", pendingReason: reason });
    expect(h.rows.refundedWith).toEqual([]);
  });

  it("keeps the provider's message for the operator", async () => {
    const h = harness({ refund: refusedWith(422) });
    await expect(h.refunds.refund("pay-1")).resolves.toMatchObject({ record: { message: "charge too old" } });
  });

  it("records a paid payment with no provider charge as pending without calling the provider", async () => {
    const h = harness({ payment: { ...PAID, providerChargeId: null } });
    await expect(h.refunds.refund("pay-1")).resolves.toMatchObject({ outcome: "PENDING", record: { reason: "NO_CHARGE" } });
    expect(h.refund).not.toHaveBeenCalled();
  });
});

describe("the claim: a refund is sent once", () => {
  it("two concurrent refunds send ONE provider refund", async () => {
    const h = harness();
    const [first, second] = await Promise.all([h.refunds.refund("pay-1"), h.refunds.refund("pay-1")]);
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect([first.outcome, second.outcome].sort()).toEqual(["NOT_REFUNDABLE", "REFUNDED"]);
  });

  it.each([
    ["no such payment", null, "NOT_FOUND"],
    ["a payment already refunded", { ...PAID, state: "REFUNDED" as const }, "ALREADY_REFUNDED"],
    ["a payment whose refund is already pending", { ...PAID, state: "REFUND_PENDING" as const, requestedAt: T0 }, "IN_PROGRESS"],
    ["a payment never paid", { ...PAID, state: "OTHER" as const }, "NOT_PAID"],
  ])("%s: nothing is sent and nothing written", async (_label, payment, why) => {
    const h = harness({ payment });
    await expect(h.refunds.refund("pay-1")).resolves.toEqual({ outcome: "NOT_REFUNDABLE", paymentId: "pay-1", why });
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.rows.store.markRefunded).not.toHaveBeenCalled();
    expect(h.rows.store.markRefundPending).not.toHaveBeenCalled();
  });
});

describe("a person's retry", () => {
  it("is refused for a paid payment nobody asked to refund", async () => {
    const h = harness();
    await expect(h.refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "NOT_REFUNDABLE", why: "NOT_PAID" });
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("is refused while attempt 1 may still be running", async () => {
    const { refunds, advance } = harness({ payment: { ...PAID, state: "REFUND_PENDING", requestedAt: T0 } });
    await expect(refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "NOT_REFUNDABLE", why: "IN_PROGRESS" });
    advance(REFUND_CLAIM_TTL_MS + 1);
    await expect(refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED" });
  });

  it("consults the charge first: a refund whose answer was lost is adopted, not sent again", async () => {
    const h = harness({ refund: refusedWith(422) });
    await h.refunds.refund("pay-1");
    h.refund.mockClear();
    h.refreshCharge.mockImplementation(BACK);

    await expect(h.refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED" });
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.rows.refundedWith).toEqual([expect.objectContaining({ how: "ADOPTED", refundedCents: 5900 })]);
  });

  it("sends one refund when the charge still owes it", async () => {
    const h = harness({ refund: refusedWith(422) });
    await h.refunds.refund("pay-1");
    h.refund.mockImplementation(TAKEN);
    h.refund.mockClear();

    await expect(h.refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED", method: "PIX" });
    expect(h.refreshCharge).toHaveBeenCalled();
    expect(h.refund).toHaveBeenCalledTimes(1);
  });

  it("is told the series is running instead of sending a second refund", async () => {
    const h = harness({ refund: refusedWith(502) });
    await h.refunds.refund("pay-1");
    h.refund.mockClear();
    await expect(h.refunds.retry("pay-1")).resolves.toMatchObject({ outcome: "NOT_REFUNDABLE", why: "IN_PROGRESS" });
    expect(h.refund).not.toHaveBeenCalled();
  });
});

describe("the background series", () => {
  it("a lost answer is consulted by the sweep and adopted when the money went back", async () => {
    const h = harness({ refund: refusedWith(502) });
    await h.refunds.refund("pay-1");
    expect(h.series.all()).toEqual([
      expect.objectContaining({ subject: SUBSCRIPTION_REFUND_SUBJECT, reference: "pay-1" }),
    ]);
    h.refund.mockClear();
    h.refreshCharge.mockImplementation(BACK);
    const { advance } = h;
    advance(60_000);

    await h.refunds.runDue();
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.rows.current()?.state).toBe("REFUNDED");
  });

  it("a refund whose own write failed is healed by the sweep", async () => {
    const h = harness();
    h.rows.store.markRefunded.mockRejectedValueOnce(new Error("database down"));
    await expect(h.refunds.refund("pay-1")).rejects.toThrow("database down");
    expect(h.rows.current()?.state).toBe("REFUND_PENDING");
    h.refund.mockClear();
    h.refreshCharge.mockImplementation(BACK);

    await h.refunds.runDue();
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.rows.current()?.state).toBe("REFUNDED");
  });

  it("a gateway that cannot be built leaves the claim for a retry after its lifetime", async () => {
    const lonely = paymentRows(PAID);
    const broken = createSubscriptionRefund({
      payments: async () => {
        throw new Error("no gateway");
      },
      merchant: MERCHANT,
      store: async () => lonely.store,
      series: async () => createMemoryRefundRetryStore(),
      now: () => new Date("2026-11-12T12:00:00.000Z"),
    });
    await expect(broken.refund("pay-1")).rejects.toThrow("no gateway");
    expect(lonely.current()).toMatchObject({ state: "REFUND_PENDING", pendingReason: null });
  });
});

describe("settled by hand", () => {
  it("records who, how and why, and ends the series so nothing is sent after", async () => {
    const h = harness({ refund: refusedWith(422) });
    await h.refunds.refund("pay-1");
    h.refund.mockClear();
    const byHand = { by: "user-9", via: "Pix manual", reason: "provider refused" };

    await expect(h.refunds.settleByHand("pay-1", byHand)).resolves.toMatchObject({
      outcome: "REFUNDED",
      record: { how: "BY_HAND", byHand },
    });
    await h.refunds.runDue();
    await expect(h.refunds.retry("pay-1")).resolves.toMatchObject({ why: "ALREADY_REFUNDED" });
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("waits while a background attempt is in flight", async () => {
    const h = harness({ refund: refusedWith(502) });
    await h.refunds.refund("pay-1");
    const [row] = h.series.all();
    if (!row) throw new Error("no series");
    await h.series.saveIf({ ...row, claimedAt: T0_ISO }, row.version);

    await expect(h.refunds.settleByHand("pay-1", { by: "u", via: "v", reason: "r" })).resolves.toMatchObject({
      why: "IN_PROGRESS",
    });
    expect(h.rows.current()?.state).toBe("REFUND_PENDING");
  });

  it("re-opens the series when its own write fails", async () => {
    const h = harness({ refund: refusedWith(502) });
    await h.refunds.refund("pay-1");
    h.rows.store.markRefunded.mockRejectedValueOnce(new Error("database down"));

    await expect(h.refunds.settleByHand("pay-1", { by: "u", via: "v", reason: "r" })).rejects.toThrow("database down");
    expect(h.series.all()[0]).toMatchObject({ settledAt: null, settledHow: null });
  });

  it("is refused for a payment that is not pending", async () => {
    const h = harness();
    await expect(h.refunds.settleByHand("pay-1", { by: "u", via: "v", reason: "r" })).resolves.toMatchObject({
      why: "NOT_PAID",
    });
  });
});
