import { describe, expect, it } from "vitest";

import {
  createMemoryTerminalCaptureStore,
  createTerminalCaptureLedger,
  type CaptureSource,
  type RecordCaptureInput,
  type TerminalCaptureStore,
} from "../index";

/**
 * A legacy `JOURNAL` row, kept by a host from a cashier-typed code before this
 * package, is filled by the terminal's report, and the report is the truth
 * (FUT-5037 A2; owner, 2026-11-14: the terminal is the only payment truth).
 */

const NOW = new Date("2026-11-14T22:00:00.000Z");
const CONFIG = { maxAmountCents: 100_000_000, unboundRefundAfterMs: 24 * 60 * 60_000 };
const NULL_TRACE = {
  transactionId: null,
  hostNsu: null,
  authorizationCode: null,
  cardBrand: null,
  installments: null,
  terminalSerial: null,
  entryMode: null,
};

function report(overrides: Partial<RecordCaptureInput> = {}): RecordCaptureInput {
  return {
    clientId: "store-1",
    transactionCode: "TC-1",
    kind: "CREDIT",
    amountCents: 4750,
    source: "DEVICE",
    deviceId: "pos-1",
    transactionId: "TX-9",
    authorizationCode: "AUTH-9",
    terminalSerial: "SN-9",
    capturedAt: NOW,
    ...overrides,
  };
}

async function withJournalRow(kind: "CREDIT" | "DEBIT", amountCents: number) {
  const { store } = createMemoryTerminalCaptureStore({ now: () => NOW });
  await store.insertIfAbsent({
    clientId: "store-1",
    transactionCode: "TC-1",
    kind,
    amountCents,
    // A legacy value the package never writes; only a host's old rows carry it.
    source: "JOURNAL" as unknown as CaptureSource,
    deviceId: null,
    ...NULL_TRACE,
    capturedAt: NOW,
  });
  return store;
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

describe("a legacy JOURNAL row and the terminal's report", () => {
  it("takes the report's trace and terminal when they agree, and flags nothing", async () => {
    const store = await withJournalRow("CREDIT", 4750);

    const { capture, created } = await ledgerOver(store).record(report());

    expect(created).toBe(false);
    expect(capture).toMatchObject({ transactionId: "TX-9", authorizationCode: "AUTH-9", terminalSerial: "SN-9", deviceId: "pos-1" });
    expect(capture.refundFlaggedAt).toBeNull();
    expect(capture.refundReason).toBeNull();
  });

  it("takes the report's kind and amount when they contradict the kept leg, flagged JOURNAL_CONFLICT, never refused", async () => {
    const store = await withJournalRow("DEBIT", 4000);

    const { capture } = await ledgerOver(store).record(report());

    expect(capture).toMatchObject({ kind: "CREDIT", amountCents: 4750, transactionId: "TX-9", refundReason: "JOURNAL_CONFLICT" });
    expect(capture.refundFlaggedAt).toEqual(NOW);
    expect(capture.refundClearedAt).toBeNull();
  });

  it("is idempotent: the same report again changes nothing", async () => {
    const store = await withJournalRow("DEBIT", 4000);
    const ledger = ledgerOver(store);
    const first = await ledger.record(report());

    const again = await ledger.record(report());

    expect(again.capture).toEqual(first.capture);
  });

  it("refuses a second, different report once the trace is filled: the terminal already spoke", async () => {
    const store = await withJournalRow("CREDIT", 4750);
    const ledger = ledgerOver(store);
    await ledger.record(report());

    await expect(ledger.record(report({ amountCents: 9999 }))).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
