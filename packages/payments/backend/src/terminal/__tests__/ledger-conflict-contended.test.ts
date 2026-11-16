import { describe, expect, it, vi } from "vitest";

import {
  CaptureError,
  createMemoryTerminalCaptureStore,
  createTerminalCaptureLedger,
  type RecordCaptureInput,
  type TerminalCaptureStore,
} from "../index";

/**
 * FUT-4996 (D7) contract, the package half of `@12-apps/payments-backend/terminal`
 * (built on FUT-5037 PR 1), on the memory store:
 *
 * - R43: a move that keeps losing its compare-and-set tries exactly
 *   MOVE_ATTEMPTS (4) times, then answers `CONTENDED` with nothing written.
 *
 * Adapted to the FUT-5037 store as it landed: the memory store is
 * `createMemoryTerminalCaptureStore().store`, and the predicated write is
 * `writeIfUnchanged` (the contract's draft named the Prisma delegate's
 * `updateMany`). No assertion changed.
 *
 * The contract's R29, R33 and R34 (a capture whose two reports disagree, and
 * State 7b's resolution) were dropped by the owner on 2026-11-14: the terminal
 * is the only source of payment truth, so there is nothing to disagree.
 */

const NOW = new Date("2026-11-14T17:32:00.000Z");
const CONFIG = { maxAmountCents: 100_000_000, unboundRefundAfterMs: 24 * 60 * 60_000 };

function input(overrides: Partial<RecordCaptureInput> = {}): RecordCaptureInput {
  return { clientId: "store-1", transactionCode: "TC-1", kind: "CREDIT", amountCents: 4750, source: "DEVICE", capturedAt: NOW, ...overrides };
}

function memoryStore(): TerminalCaptureStore {
  return createMemoryTerminalCaptureStore().store;
}

function ledgerOver(store: TerminalCaptureStore) {
  return createTerminalCaptureLedger({
    store: () => store,
    directory: { devicesBelong: async () => true },
    sales: { saleBelongs: async () => true, paymentBelongs: async () => true },
    ...CONFIG,
    now: () => NOW,
  });
}

describe("R43: CONTENDED", () => {
  it("R43: a bind whose compare-and-set never lands tries exactly 4 times, then answers CONTENDED, writing nothing", async () => {
    const real = memoryStore();
    const ledger = ledgerOver(real);
    await ledger.record(input());
    const losing: TerminalCaptureStore = { ...real, writeIfUnchanged: vi.fn(async () => false) };
    const contended = ledgerOver(losing);

    const bind = contended.bind(undefined, "store-1", ["TC-1"], { orderId: "order-1", paymentId: "payment-1" });

    await expect(bind).rejects.toBeInstanceOf(CaptureError);
    await expect(bind).rejects.toMatchObject({ code: "CONTENDED" });
    expect(losing.writeIfUnchanged).toHaveBeenCalledTimes(4);
    expect((await ledger.findByCodes("store-1", ["TC-1"]))[0]).toMatchObject({ state: "UNBOUND", orderId: null });
  });
});
