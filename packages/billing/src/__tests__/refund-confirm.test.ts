// @vitest-environment node
/**
 * Following a refund the provider accepted but did not finish (FUT-4864):
 * confirmed when the charge reads refunded, reopened as pending for a person
 * once the host's deadline passes without it, left waiting inside it — and a
 * reopened refund is a NEW request, so a person's retry sends it again rather
 * than finding the first request's series settled.
 */
import { describe, expect, it, vi } from "vitest";

import { createMemoryRefundRetryStore } from "@12-apps/payments-backend";

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
const T0 = new Date(T0_ISO);
const HOUR = 3_600_000;
const WITHIN = 24 * HOUR;

/** One payment's row, both ports over it, with the conditional writes the ports ask for. */
function world() {
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
    } as RefundablePayment,
    refundedAt: null as Date | null,
    confirmed: false,
  };
  const reopened: RefundPendingRecord[] = [];
  const payments = {
    find: vi.fn(async () => ({ ...held.row })),
    claim: vi.fn(async (_id: string, at: Date) => {
      if (held.row.state !== "PAID") return false;
      held.row = { ...held.row, state: "REFUND_PENDING", requestedAt: at };
      return true;
    }),
    markRefunded: vi.fn(async (_id: string, record: RefundRecord) => {
      if (held.row.state !== "REFUND_PENDING") return false;
      held.row = { ...held.row, state: "REFUNDED" };
      held.refundedAt = record.at;
      held.confirmed = record.confirmed;
      return true;
    }),
    markRefundPending: vi.fn(async (_id: string, record: RefundPendingRecord) => {
      if (held.row.state !== "REFUND_PENDING") return false;
      held.row = { ...held.row, pendingReason: record.reason };
      return true;
    }),
  } satisfies RefundablePaymentStore;
  const confirmations = {
    unconfirmed: vi.fn(async (): Promise<UnconfirmedRefund[]> =>
      held.row.state === "REFUNDED" && !held.confirmed && held.refundedAt
        ? [{ id: held.row.id, provider: held.row.provider, providerChargeId: held.row.providerChargeId, refundedAt: held.refundedAt }]
        : [],
    ),
    confirm: vi.fn(async () => {
      if (held.row.state !== "REFUNDED" || held.confirmed) return false;
      held.confirmed = true;
      return true;
    }),
    reopen: vi.fn(async (_id: string, record: RefundPendingRecord) => {
      if (held.row.state !== "REFUNDED" || held.confirmed) return false;
      held.row = { ...held.row, state: "REFUND_PENDING", requestedAt: record.at, pendingReason: record.reason };
      reopened.push(record);
      return true;
    }),
  } satisfies RefundConfirmationStore;
  return { held, payments, confirmations, reopened };
}

function harness(charge: () => Promise<unknown> = async () => ({ status: "PAID" })) {
  const clock = { at: T0 };
  const w = world();
  const providerRefund = vi.fn(async () => ({ providerRefundId: "rf-1", status: "PENDING", amount: { amountCents: 5900, currency: "BRL" } }));
  const providerRead = vi.fn(charge);
  const subject = createSubscriptionRefund({
    payments: async () => ({ gateway: { refund: providerRefund, refreshCharge: providerRead } as never }),
    merchant: MERCHANT,
    store: async () => w.payments,
    series: async () => createMemoryRefundRetryStore(),
    now: () => clock.at,
    confirmations: { store: async () => w.confirmations, confirmWithinMs: WITHIN },
  });
  const later = (ms: number) => {
    clock.at = new Date(clock.at.getTime() + ms);
  };
  return { flow: subject, refund: providerRefund, refreshCharge: providerRead, later, ...w };
}

describe("a refund the provider accepted but did not finish", () => {
  it("is recorded refunded and unconfirmed, then confirmed once the charge reads refunded", async () => {
    const { flow, held, refreshCharge, later } = harness();
    await expect(flow.refund("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED", record: { confirmed: false } });

    await expect(flow.confirmDue()).resolves.toEqual({ confirmed: 0, reopened: 0, waiting: 1 });
    refreshCharge.mockResolvedValue({ status: "REFUNDED" });
    later(HOUR);
    await expect(flow.confirmDue()).resolves.toEqual({ confirmed: 1, reopened: 0, waiting: 0 });
    expect(held.confirmed).toBe(true);
    await expect(flow.confirmDue()).resolves.toEqual({ confirmed: 0, reopened: 0, waiting: 0 });
  });

  it("a voided charge confirms it too", async () => {
    const { flow, held } = harness(async () => ({ status: "CANCELED" }));
    await flow.refund("pay-1");
    await flow.confirmDue();
    expect(held.confirmed).toBe(true);
  });

  it("waits inside the deadline and reopens it as pending at the deadline", async () => {
    const { flow, held, reopened, later } = harness();
    await flow.refund("pay-1");
    later(WITHIN - 1);
    await expect(flow.confirmDue()).resolves.toMatchObject({ waiting: 1, reopened: 0 });
    later(1);
    await expect(flow.confirmDue()).resolves.toMatchObject({ reopened: 1 });
    expect(held.row).toMatchObject({ state: "REFUND_PENDING", pendingReason: "NOT_CONFIRMED" });
    expect(reopened).toEqual([{ reason: "NOT_CONFIRMED", message: null, at: new Date(Date.parse(T0_ISO) + WITHIN) }]);
  });

  it("a charge that cannot be read waits, and is reopened with what failed once overdue", async () => {
    const { flow, held, later } = harness(async () => {
      throw new Error("provider down");
    });
    await flow.refund("pay-1");
    await expect(flow.confirmDue()).resolves.toMatchObject({ waiting: 1 });
    later(WITHIN);
    await flow.confirmDue();
    expect(held.row.pendingReason).toBe("NOT_CONFIRMED");
  });

  it("a reopened refund is a new request: a person's retry consults the charge and sends it again", async () => {
    const { flow, refund, refreshCharge, later } = harness();
    await flow.refund("pay-1");
    later(WITHIN);
    await flow.confirmDue();
    refund.mockClear();
    refund.mockResolvedValue({ providerRefundId: "rf-2", status: "REFUNDED", amount: { amountCents: 5900, currency: "BRL" } });

    await expect(flow.retry("pay-1")).resolves.toMatchObject({ outcome: "REFUNDED" });
    expect(refreshCharge).toHaveBeenCalled();
    expect(refund).toHaveBeenCalledOnce();
  });

  it("sends nothing to the provider itself", async () => {
    const { flow, refund, later } = harness();
    await flow.refund("pay-1");
    refund.mockClear();
    later(WITHIN);
    await flow.confirmDue();
    expect(refund).not.toHaveBeenCalled();
  });
});

describe("configuration", () => {
  it("refuses a pass with no confirmations bound", async () => {
    const w = world();
    const unbound = createSubscriptionRefund({
      payments: async () => ({ gateway: {} as never }),
      merchant: MERCHANT,
      store: async () => w.payments,
      series: async () => createMemoryRefundRetryStore(),
    });
    await expect(unbound.confirmDue()).rejects.toBeInstanceOf(BillingConfigError);
  });

  it("refuses a deadline that is not positive", async () => {
    const w = world();
    const unbound = createSubscriptionRefund({
      payments: async () => ({ gateway: {} as never }),
      merchant: MERCHANT,
      store: async () => w.payments,
      series: async () => createMemoryRefundRetryStore(),
      confirmations: { store: async () => w.confirmations, confirmWithinMs: 0 },
    });
    await expect(unbound.confirmDue()).rejects.toBeInstanceOf(BillingConfigError);
  });
});
