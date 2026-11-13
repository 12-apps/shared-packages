// @vitest-environment node
/**
 * Following a refund the provider accepted but did not finish (FUT-4864):
 *
 *  - the sweep confirms it when the charge reads its money back, and only
 *    FLAGS it past the deadline — a slow refund is never reopened, so it can
 *    never be returned a second time by hand or by a retry;
 *  - the provider's own word (its webhook) confirms it, or — FAILED, the one
 *    piece of evidence — reopens it as a new request, whose retry is a new
 *    series and sends exactly once;
 *  - a series a 1.4.0 binding wrote (bound to the bare payment id) stays live.
 */
import { describe, expect, it, vi } from "vitest";

import { createMemoryRefundRetryStore, ProviderRequestError, type RefundSeriesRow } from "@12-apps/payments-backend";

import { BillingConfigError } from "../errors";
import { createSubscriptionRefund } from "../server/refund";
import type {
  RefundablePayment,
  RefundablePaymentStore,
  RefundConfirmationStore,
  RefundPendingRecord,
  RefundRecord,
  UnconfirmedRefund,
} from "../server/refund-ports";
import { MERCHANT } from "./fixtures";

const T0_ISO = "2026-11-12T12:00:00.000Z";
const T0_MS = Date.parse(T0_ISO);
const HOUR = 3_600_000;
const WITHIN = 24 * HOUR;

/** One payment's row, both ports over it, with the conditional writes the ports ask for. */
function world(start: Partial<RefundablePayment> = {}) {
  const held = {
    row: {
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
      ...start,
    } as RefundablePayment,
    refundedAt: null as Date | null,
    providerRefundId: null as string | null,
    confirmed: false,
    overdue: false,
  };
  const payments = {
    find: vi.fn(async () => ({ ...held.row })),
    claim: vi.fn(async (_id: string, at: Date, requestId: string) => {
      if (held.row.state !== "PAID") return false;
      held.row = { ...held.row, state: "REFUND_PENDING", requestedAt: at, requestId };
      return true;
    }),
    markRefunded: vi.fn(async (_id: string, record: RefundRecord) => {
      if (held.row.state !== "REFUND_PENDING") return false;
      held.row = { ...held.row, state: "REFUNDED" };
      held.refundedAt = record.at;
      held.providerRefundId = record.providerRefundId;
      held.confirmed = record.confirmed;
      return true;
    }),
    markRefundPending: vi.fn(async (_id: string, record: RefundPendingRecord) => {
      if (held.row.state !== "REFUND_PENDING") return false;
      held.row = { ...held.row, pendingReason: record.reason };
      return true;
    }),
  } satisfies RefundablePaymentStore;
  const unconfirmedNow = (): UnconfirmedRefund | null =>
    held.row.state === "REFUNDED" && !held.confirmed && held.refundedAt
      ? {
          id: held.row.id,
          provider: held.row.provider,
          providerChargeId: held.row.providerChargeId,
          providerRefundId: held.providerRefundId,
          refundedAt: held.refundedAt,
        }
      : null;
  const confirmations = {
    unconfirmed: vi.fn(async () => {
      const one = unconfirmedNow();
      return one ? [one] : [];
    }),
    findByCharge: vi.fn(async () => unconfirmedNow()),
    confirm: vi.fn(async () => {
      if (!unconfirmedNow()) return false;
      held.confirmed = true;
      return true;
    }),
    followed: vi.fn(async (_id: string, _at: Date, overdue: boolean) => {
      held.overdue = overdue;
    }),
    reopen: vi.fn(async (_id: string, record: RefundPendingRecord & { requestId: string }) => {
      if (!unconfirmedNow()) return false;
      held.row = { ...held.row, state: "REFUND_PENDING", requestedAt: record.at, requestId: record.requestId, pendingReason: record.reason };
      return true;
    }),
  } satisfies RefundConfirmationStore;
  return { held, payments, confirmations };
}

const ACCEPTED = async () => ({ providerRefundId: "rf-1", status: "PENDING", amount: { amountCents: 5900, currency: "BRL" } });

function harness(options: { charge?: () => Promise<unknown>; start?: Partial<RefundablePayment> } = {}) {
  const clock = { at: new Date(T0_MS) };
  const w = world(options.start);
  const providerRefund = vi.fn(ACCEPTED);
  const providerRead = vi.fn(options.charge ?? (async () => ({ status: "PAID" })));
  const series = createMemoryRefundRetryStore();
  const subject = createSubscriptionRefund({
    payments: async () => ({ gateway: { refund: providerRefund, refreshCharge: providerRead } as never }),
    merchant: MERCHANT,
    store: async () => w.payments,
    series: async () => series,
    now: () => clock.at,
    confirmations: { store: async () => w.confirmations, confirmWithinMs: WITHIN },
  });
  const later = (ms: number) => {
    clock.at = new Date(clock.at.getTime() + ms);
  };
  return { flow: subject, refund: providerRefund, refreshCharge: providerRead, series, later, ...w };
}

describe("the sweep follows an accepted refund", () => {
  it("is recorded refunded and unconfirmed, then confirmed once the charge reads its money back", async () => {
    const { flow, held, refreshCharge, later } = harness();
    await expect(flow.refund("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED", record: { confirmed: false } });

    await expect(flow.confirmDue()).resolves.toEqual({ confirmed: 0, overdue: 0, waiting: 1, failed: 0 });
    refreshCharge.mockResolvedValue({ status: "REFUNDED" });
    later(HOUR);
    await expect(flow.confirmDue()).resolves.toEqual({ confirmed: 1, overdue: 0, waiting: 0, failed: 0 });
    expect(held.confirmed).toBe(true);
  });

  it("a PAID charge voided confirms it too", async () => {
    const { flow, held } = harness({ charge: async () => ({ status: "CANCELED" }) });
    await flow.refund("pay-1");
    await flow.confirmDue();
    expect(held.confirmed).toBe(true);
  });

  it("a SLOW refund is flagged overdue, never reopened: no hand settlement and no retry can return it twice", async () => {
    const { flow, held, refund, refreshCharge, later } = harness();
    await flow.refund("pay-1");
    later(WITHIN - 1);
    await expect(flow.confirmDue()).resolves.toMatchObject({ waiting: 1, overdue: 0 });
    later(1);
    await expect(flow.confirmDue()).resolves.toMatchObject({ overdue: 1 });
    expect(held.overdue).toBe(true);
    expect(held.row.state).toBe("REFUNDED");

    await expect(flow.settleByHand("pay-1", { by: "u", via: "PIX", reason: "r" })).resolves.toMatchObject({ why: "ALREADY_REFUNDED" });
    await expect(flow.retry("pay-1")).resolves.toMatchObject({ why: "ALREADY_REFUNDED" });
    expect(refund).toHaveBeenCalledOnce();

    // …and it still lands: the next pass confirms it.
    refreshCharge.mockResolvedValue({ status: "REFUNDED" });
    await expect(flow.confirmDue()).resolves.toMatchObject({ confirmed: 1 });
  });

  it("an unreadable charge is waited for, then flagged — never taken as a failure", async () => {
    const { flow, held, later } = harness({
      charge: async () => {
        throw new Error("provider down");
      },
    });
    await flow.refund("pay-1");
    later(WITHIN);
    await expect(flow.confirmDue()).resolves.toMatchObject({ overdue: 1 });
    expect(held.row.state).toBe("REFUNDED");
  });

  it("goes on past a row whose own write throws", async () => {
    const { flow, confirmations } = harness();
    await flow.refund("pay-1");
    confirmations.followed.mockRejectedValueOnce(new Error("database down"));
    await expect(flow.confirmDue()).resolves.toEqual({ confirmed: 0, overdue: 0, waiting: 0, failed: 1 });
  });

  it("a store that cannot list rejects the pass", async () => {
    const { flow, confirmations } = harness();
    confirmations.unconfirmed.mockRejectedValueOnce(new Error("database down"));
    await expect(flow.confirmDue()).rejects.toThrow("database down");
  });
});

describe("the provider's own word on the refund", () => {
  it("REFUNDED confirms it", async () => {
    const { flow, held } = harness();
    await flow.refund("pay-1");
    const update = { provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "REFUNDED" as const };
    await expect(flow.refundUpdated(update)).resolves.toBe("CONFIRMED");
    expect(held.confirmed).toBe(true);
  });

  it("PENDING changes nothing, and a word about another refund of the charge is not this one's", async () => {
    const { flow, held } = harness();
    await flow.refund("pay-1");
    await expect(flow.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "PENDING" })).resolves.toBe("IGNORED");
    await expect(flow.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-OTHER", status: "FAILED" })).resolves.toBe("IGNORED");
    expect(held.row.state).toBe("REFUNDED");
  });

  it("FAILED reopens it as a NEW request (reason REFUSED, asked again now) whose retry sends exactly once", async () => {
    const { flow, held, refund, confirmations, later } = harness();
    await flow.refund("pay-1");
    const firstRequest = held.row.requestId;
    later(HOUR);
    await expect(
      flow.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "FAILED" }),
    ).resolves.toBe("REOPENED");

    const record = confirmations.reopen.mock.calls[0]?.[1];
    expect(record).toMatchObject({ reason: "REFUSED", at: new Date(T0_MS + HOUR) });
    expect(record?.requestId).toEqual(expect.any(String));
    expect(held.row).toMatchObject({ state: "REFUND_PENDING", requestedAt: new Date(T0_MS + HOUR) });
    expect(held.row.requestId).not.toBe(firstRequest);

    refund.mockClear();
    refund.mockResolvedValue({ providerRefundId: "rf-2", status: "REFUNDED", amount: { amountCents: 5900, currency: "BRL" } });
    await expect(flow.retry("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED" });
    expect(refund).toHaveBeenCalledOnce();
  });

  it("FAILED, then settled by hand: recorded once, and nothing is sent", async () => {
    const { flow, refund } = harness();
    await flow.refund("pay-1");
    await flow.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "FAILED" });
    refund.mockClear();
    await expect(flow.settleByHand("pay-1", { by: "u", via: "PIX", reason: "r" })).resolves.toMatchObject({ outcome: "REFUNDED" });
    expect(refund).not.toHaveBeenCalled();
  });
});

describe("a refund request made under 1.4.0 (no stored request id)", () => {
  const LEGACY: Partial<RefundablePayment> = { state: "REFUND_PENDING", requestedAt: new Date(T0_MS - 10 * HOUR), pendingReason: "UNKNOWN", requestId: null };

  async function legacySeries(series: ReturnType<typeof createMemoryRefundRetryStore>, claimedAt: string | null) {
    const row = await series.insert({
      merchant: MERCHANT,
      provider: "acquirer-a",
      providerChargeId: "chg-1",
      reference: "pay-1",
      subject: "subscription-payment",
      boundTo: "pay-1",
      amountCents: null,
      cause: null,
      series: 1,
      attempt: 2,
      of: 4,
      nextAt: new Date(T0_MS + HOUR).toISOString(),
      exhausted: false,
      refusal: "UNKNOWN",
      claimedAt,
      reported: false,
      settledAt: null,
      settledHow: null,
    } as Omit<RefundSeriesRow, "id" | "version">);
    if (!row) throw new Error("no series");
    return row;
  }

  it("its live series (bound to the bare payment id) still answers a retry: nothing is sent twice", async () => {
    const h = harness({ start: LEGACY });
    await legacySeries(h.series, null);
    await expect(h.flow.retry("pay-1")).resolves.toMatchObject({ why: "IN_PROGRESS" });
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("a hand settlement waits while its attempt is in flight", async () => {
    const h = harness({ start: LEGACY });
    await legacySeries(h.series, T0_ISO);
    await expect(h.flow.settleByHand("pay-1", { by: "u", via: "PIX", reason: "r" })).resolves.toMatchObject({ why: "IN_PROGRESS" });
  });

  it("a host column that keeps less precision than the clock changes nothing: the request is its id", async () => {
    const h = harness();
    h.refund.mockRejectedValueOnce(new ProviderRequestError("acquirer-a", "bad gateway", { httpStatus: 502 }));
    await h.flow.refund("pay-1");
    const [row] = h.series.all();
    expect(row?.boundTo).toBe(`pay-1:${h.held.row.requestId}`);
    // The stored instant loses its milliseconds: the running series is still found.
    h.held.row = { ...h.held.row, requestedAt: new Date(Math.floor(T0_MS / 1000) * 1000) };
    h.refund.mockClear();
    await expect(h.flow.retry("pay-1")).resolves.toMatchObject({ why: "IN_PROGRESS" });
    expect(h.refund).not.toHaveBeenCalled();
  });
});

describe("configuration", () => {
  it.each([
    ["no confirmations bound", undefined],
    ["a deadline that is not positive", 0],
  ])("refuses following with %s", async (_label, within) => {
    const w = world();
    const unbound = createSubscriptionRefund({
      payments: async () => ({ gateway: {} as never }),
      merchant: MERCHANT,
      store: async () => w.payments,
      series: async () => createMemoryRefundRetryStore(),
      ...(within === undefined ? {} : { confirmations: { store: async () => w.confirmations, confirmWithinMs: within } }),
    });
    await expect(unbound.confirmDue()).rejects.toBeInstanceOf(BillingConfigError);
    await expect(
      unbound.refundUpdated({ provider: "acquirer-a", providerChargeId: "chg-1", providerRefundId: "rf-1", status: "FAILED" }),
    ).rejects.toBeInstanceOf(BillingConfigError);
  });
});
