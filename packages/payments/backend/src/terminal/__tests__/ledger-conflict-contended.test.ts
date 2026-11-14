import { describe, expect, it, vi } from "vitest";

import {
  CaptureError,
  createMemoryTerminalCaptureStore,
  createTerminalCaptureLedger,
  type RecordCaptureInput,
  type TerminalCaptureLedger,
  type TerminalCaptureStore,
} from "../index";

/**
 * FUT-4996 (D7) contract, the package half of `@12-apps/payments-backend/terminal`
 * (built on FUT-5037 PR 1): Decision 6 and the CONTENDED bound, on the memory
 * store.
 *
 * - R29: a second report that disagrees on amount or kind is still refused as
 *   `CONFLICT`, but is KEPT (the first disagreement only); the stored row and
 *   its flag are untouched, and nothing is refunded.
 * - R33/R34: `resolveConflict` takes one report or flags the refund, once.
 * - R43: a move that keeps losing its compare-and-set tries exactly
 *   MOVE_ATTEMPTS (4) times, then answers `CONTENDED` with nothing written.
 *
 * Adapted to the FUT-5037 store as it landed: the memory store is
 * `createMemoryTerminalCaptureStore().store`, and the predicated write is
 * `writeIfUnchanged` (the contract's draft named the Prisma delegate's
 * `updateMany`). No assertion changed.
 *
 * R29, R33 and R34 are about a capture whose two reports disagree. They wait on
 * the owner's decision on FUT-4996 state 7b ("em conflito") and trade-off T1, so
 * they are skipped until that decision is taken and built.
 */

/** Why the conflict rows are skipped: the owner has not decided state 7b and T1 yet. */
const PENDING_7B = "pending owner decision on FUT-4996 state 7b and trade-off T1 (a capture whose two reports disagree)";

const NOW = new Date("2026-11-14T17:32:00.000Z");
const CONFIG = { maxAmountCents: 100_000_000, unboundRefundAfterMs: 24 * 60 * 60_000 };

function input(overrides: Partial<RecordCaptureInput> = {}): RecordCaptureInput {
  return { clientId: "store-1", transactionCode: "TC-1", kind: "CREDIT", amountCents: 4750, source: "DEVICE", capturedAt: NOW, ...overrides };
}

/**
 * The 7b surface the skipped rows describe. It is not built until the owner
 * decides state 7b and T1, so the skipped rows reach it through this view and
 * the file type-checks meanwhile. Drop the view when `resolveConflict` lands.
 */
interface PendingConflictLedger {
  resolveConflict(
    clientId: string,
    code: string,
    resolution: { act: "TAKE_TERMINAL" | "TAKE_STATION" | "REFUND"; refundReason?: string; actorId: string; reason: string; now: Date },
  ): Promise<unknown>;
}
const pendingConflict = (ledger: TerminalCaptureLedger): TerminalCaptureLedger & PendingConflictLedger =>
  ledger as TerminalCaptureLedger & PendingConflictLedger;

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

describe.skip(`R29: a disagreeing report is kept, never refunded (${PENDING_7B})`, () => {
  it("R29: the second report refuses as CONFLICT and is stored as the conflict; the row and its flag are unchanged", async () => {
    const ledger = ledgerOver(memoryStore());
    await ledger.record(input());

    await expect(ledger.record(input({ source: "STATION", kind: "DEBIT", amountCents: 4570 }))).rejects.toMatchObject({ code: "CONFLICT" });

    const [row] = await ledger.findByCodes("store-1", ["TC-1"]);
    expect(row).toMatchObject({
      kind: "CREDIT",
      amountCents: 4750,
      source: "DEVICE",
      refundFlaggedAt: null,
      conflict: { source: "STATION", kind: "DEBIT", amountCents: 4570, resolvedAt: null },
    });
  });

  it("R29: a third disagreeing report keeps the first disagreement", async () => {
    const ledger = ledgerOver(memoryStore());
    await ledger.record(input());
    await ledger.record(input({ source: "STATION", kind: "DEBIT", amountCents: 4570 })).catch(() => undefined);

    await ledger.record(input({ source: "STATION", kind: "PIX", amountCents: 1 })).catch(() => undefined);

    const [row] = await ledger.findByCodes("store-1", ["TC-1"]);
    expect((row as { conflict?: unknown } | undefined)?.conflict).toMatchObject({ kind: "DEBIT", amountCents: 4570 });
  });
});

describe.skip(`R33/R34: resolving a conflict (${PENDING_7B})`, () => {
  async function conflicted() {
    const ledger = ledgerOver(memoryStore());
    await ledger.record(input());
    await ledger.record(input({ source: "STATION", kind: "DEBIT", amountCents: 4570 })).catch(() => undefined);
    return pendingConflict(ledger);
  }

  it("R33: TAKE_STATION moves the row to the station's report; TAKE_TERMINAL keeps the terminal's; both record who, when and why", async () => {
    const station = await conflicted();
    const terminal = await conflicted();

    await station.resolveConflict("store-1", "TC-1", { act: "TAKE_STATION", actorId: "owner", reason: "conferido no extrato", now: NOW });
    await terminal.resolveConflict("store-1", "TC-1", { act: "TAKE_TERMINAL", actorId: "owner", reason: "conferido no extrato", now: NOW });

    expect((await station.findByCodes("store-1", ["TC-1"]))[0]).toMatchObject({ kind: "DEBIT", amountCents: 4570, refundFlaggedAt: null, conflict: { resolution: "TAKE_STATION", resolvedBy: "owner", resolvedAt: NOW } });
    expect((await terminal.findByCodes("store-1", ["TC-1"]))[0]).toMatchObject({ kind: "CREDIT", amountCents: 4750, conflict: { resolution: "TAKE_TERMINAL" } });
  });

  it("R34: REFUND flags the reason the host names, once; a second resolve is CONFLICT_RESOLVED", async () => {
    const ledger = await conflicted();

    await ledger.resolveConflict("store-1", "TC-1", { act: "REFUND", refundReason: "REPORTS_DISAGREED", actorId: "owner", reason: "conferido", now: NOW });

    expect((await ledger.findByCodes("store-1", ["TC-1"]))[0]).toMatchObject({ refundReason: "REPORTS_DISAGREED", refundFlaggedAt: NOW });
    await expect(ledger.resolveConflict("store-1", "TC-1", { act: "TAKE_TERMINAL", actorId: "owner", reason: "conferido", now: NOW })).rejects.toMatchObject({ code: "CONFLICT_RESOLVED" });
  });
});

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
