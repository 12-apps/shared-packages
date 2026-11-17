import { vi } from "vitest";

import type { ChargeInput, ChargeSnapshot, StoredCharge } from "@12-apps/payments-backend";

import { createOneOffPurchase } from "../server/purchase";
import type {
  Purchase,
  PurchaseFailure,
  PurchaseSettled,
  PurchaseStore,
  RaisedPurchaseCharge,
} from "../server/purchase-ports";
import { MERCHANT } from "./fixtures";

/**
 * One purchase's world for the one-off purchase suite (FUT-5094): its row,
 * the store over it with the CONDITIONAL writes the port asks for, and a
 * gateway that is idempotent on its key exactly as payments-backend's is — a
 * known key is answered with the charge already stored under it.
 */

export const T0 = new Date("2026-11-17T12:00:00.000Z");
export const MINUTE = 60_000;

export const PURCHASE: Purchase = {
  id: "pur-1",
  groupId: "sub-1",
  amount: { amountCents: 4_990, currency: "BRL" },
  customer: { name: "Legal Entity Ltd", email: "billing@example.test", taxId: "1234" },
};

type Answer = (input: ChargeInput) => Partial<ChargeSnapshot>;

/** PIX: a code that lapses 30 minutes after T0. CARD: paid at once. */
const DEFAULT_ANSWER: Answer = (input) =>
  input.method === "PIX"
    ? { status: "PENDING", pix: { qrText: "000201", expiresAt: new Date(T0.getTime() + 30 * MINUTE).toISOString() } }
    : { status: "PAID" };

export function purchaseWorld(options: { exists?: boolean } = {}) {
  const held = {
    exists: options.exists ?? true,
    status: "pending" as "pending" | "failed" | "paid",
    attempt: 0,
    providerChargeId: null as string | null,
    expiresAt: null as Date | null,
    settledBy: [] as string[],
    failures: [] as PurchaseFailure[],
    raised: [] as RaisedPurchaseCharge[],
  };
  const store: PurchaseStore = {
    read: vi.fn(async () => {
      if (!held.exists) return "unknown" as const;
      if (held.status === "paid") return "settled" as const;
      return { purchase: PURCHASE, providerChargeId: held.providerChargeId, attempt: held.attempt };
    }),
    recordRaised: vi.fn(async (_id: string, charge: RaisedPurchaseCharge) => {
      held.raised.push(charge);
      if (held.status === "paid" || charge.attempt !== held.attempt) return;
      held.providerChargeId = charge.providerChargeId;
      held.expiresAt = charge.expiresAt;
      held.status = "pending";
    }),
    claimSettled: vi.fn(async (_id: string, settlement) => {
      if (held.status === "paid") return false;
      held.status = "paid";
      held.settledBy.push(settlement.providerChargeId);
      return true;
    }),
    markFailed: vi.fn(async (_id: string, failure: PurchaseFailure) => {
      if (held.status === "paid" || failure.attempt !== held.attempt) return false;
      held.failures.push(failure);
      held.status = "failed";
      held.attempt += 1;
      held.providerChargeId = null;
      held.expiresAt = null;
      return true;
    }),
    unanswered: vi.fn(async () =>
      held.status !== "paid" && held.providerChargeId
        ? [
            {
              purchaseId: PURCHASE.id,
              attempt: held.attempt,
              provider: "acquirer-a",
              providerChargeId: held.providerChargeId,
              expiresAt: held.expiresAt,
            },
          ]
        : [],
    ),
  };

  const charges = new Map<string, StoredCharge>();
  const provider = { answer: DEFAULT_ANSWER, refresh: { status: "PENDING" } as Partial<ChargeSnapshot> };
  const gateway = {
    charge: vi.fn(async (_merchant: unknown, input: ChargeInput) => {
      const known = input.idempotencyKey ? charges.get(input.idempotencyKey) : undefined;
      if (known) return known;
      const providerChargeId = `chg-${input.reference}`;
      const snapshot = {
        provider: "acquirer-a",
        providerChargeId,
        reference: input.reference,
        amount: input.amount,
        method: input.method,
        ...provider.answer(input),
      } as ChargeSnapshot;
      const stored = storedOf(input.reference, snapshot, input.idempotencyKey ?? null);
      if (input.idempotencyKey) charges.set(input.idempotencyKey, stored);
      return stored;
    }),
    refreshCharge: vi.fn(async (_merchant: unknown, _provider: string, chargeId: string) => ({
      provider: "acquirer-a",
      providerChargeId: chargeId,
      amount: PURCHASE.amount,
      method: "PIX",
      ...provider.refresh,
    }) as ChargeSnapshot),
  };
  const credentials = { defaultProvider: vi.fn(async () => "acquirer-a") };

  const granted: Array<{ purchase: Purchase; settled: PurchaseSettled }> = [];
  const logger = { warn: vi.fn(), error: vi.fn() };
  const purchases = createOneOffPurchase({
    payments: async () => ({ gateway, credentials }) as never,
    merchant: MERCHANT,
    enabled: async () => true,
    instruments: async () => ({
      instrument: { provider: "acquirer-a", providerInstrumentId: "pm-1", providerCustomerId: "cus-1" },
      hasAny: true,
    }),
    purchases: async () => store,
    onSettled: async (purchase, settled) => {
      granted.push({ purchase, settled });
    },
    logger,
    now: () => T0,
  });

  return { held, store, gateway, provider, charges, granted, logger, purchases };
}

/** A stored platform charge, as the gateway's charge store hands it to the webhook reactor. */
export function storedOf(reference: string, snapshot: ChargeSnapshot, idempotencyKey: string | null = reference): StoredCharge {
  return {
    id: `row-${snapshot.providerChargeId}`,
    merchant: MERCHANT,
    provider: snapshot.provider,
    providerChargeId: snapshot.providerChargeId,
    reference,
    idempotencyKey,
    snapshot,
    createdAt: T0,
    updatedAt: T0,
  };
}
