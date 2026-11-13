import { vi } from "vitest";

import { createMemoryRefundRetryStore } from "@12-apps/payments-backend";

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

/**
 * One subscription payment's world for the refund-confirmation suites
 * (FUT-4864): its row, the payment and confirmation ports over it with the
 * conditional writes they ask for, and the flow bound to a fake provider.
 */

export const T0_ISO = "2026-11-12T12:00:00.000Z";
export const T0_MS = Date.parse(T0_ISO);
export const HOUR = 3_600_000;
export const WITHIN = 24 * HOUR;

/** One payment's row, both ports over it, with the conditional writes the ports ask for. */
export function world(start: Partial<RefundablePayment> = {}) {
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
    findUnconfirmed: vi.fn(async () => unconfirmedNow()),
    confirm: vi.fn(async () => {
      if (!unconfirmedNow()) return false;
      held.confirmed = true;
      return true;
    }),
    followed: vi.fn(async (_id: string, _at: Date, overdue: boolean) => {
      held.overdue = overdue;
    }),
    reopen: vi.fn(async (_id: string, record: RefundPendingRecord & { requestId: string; byHand?: { by: string; reason: string } }) => {
      if (!unconfirmedNow()) return false;
      held.row = { ...held.row, state: "REFUND_PENDING", requestedAt: record.at, requestId: record.requestId, pendingReason: record.reason };
      return true;
    }),
  } satisfies RefundConfirmationStore;
  return { held, payments, confirmations };
}

export const ACCEPTED = async () => ({ providerRefundId: "rf-1", status: "PENDING", amount: { amountCents: 5900, currency: "BRL" } });

export function harness(options: { charge?: () => Promise<unknown>; start?: Partial<RefundablePayment> } = {}) {
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

