import { createMemoryTerminalCaptureStore, type MemoryTerminalCaptures } from '../memory-store';
import { createTerminalCaptureLedger, type TerminalCaptureLedger } from '../ledger';
import { CaptureError, type RecordCaptureInput } from '../model';
import type { SaleDirectory, TerminalCaptureStore, TerminalCaptureStoreFor, TerminalDirectory } from '../ports';
import type { StationCaptureWire } from '../readers';

/**
 * A tenant world over the in-memory store: two tenants, their terminals, their
 * sales and the sales' payment rows. What the host's tables answer through the
 * directory ports, held here as plain sets.
 */

export const TENANT = 'tenant-a';
export const OTHER_TENANT = 'tenant-b';
export const NOW = new Date('2026-11-03T15:00:00.000Z');
export const DAY = 24 * 60 * 60_000;
const MAX_CENTS = 100_000_000;

export interface World {
  captures: MemoryTerminalCaptures;
  ledger: TerminalCaptureLedger;
  devices: Map<string, string>;
  /** A sale and its payment row at `clientId`, as a settle path would have written them. */
  sale(clientId?: string): { orderId: string; paymentId: string };
  device(clientId?: string): string;
  directory: TerminalDirectory;
  sales: SaleDirectory;
  rows(): ReturnType<MemoryTerminalCaptures['all']>;
  row(code: string, clientId?: string): ReturnType<MemoryTerminalCaptures['all']>[number];
}

interface WorldOptions {
  /** Wrap the store every move uses — to land a write between a move's read and its write. */
  wrap?: (store: TerminalCaptureStore) => TerminalCaptureStore;
  now?: () => Date;
}

export function world(options: WorldOptions = {}): World {
  const clock = options.now ?? (() => NOW);
  const captures = createMemoryTerminalCaptureStore({ now: clock });
  const devices = new Map<string, string>();
  const orders = new Map<string, string>();
  const payments = new Map<string, string>();

  const directory: TerminalDirectory = {
    devicesBelong: async (clientId, deviceIds) => deviceIds.every((deviceId) => devices.get(deviceId) === clientId),
  };
  const sales: SaleDirectory = {
    saleBelongs: async (_tx, clientId, orderId) => orders.get(orderId) === clientId,
    paymentBelongs: async (_tx, clientId, orderId, paymentId) => payments.get(paymentId) === orderId && orders.get(orderId) === clientId,
  };
  const wrapped = options.wrap ? options.wrap(captures.store) : captures.store;
  const storeFor: TerminalCaptureStoreFor = () => wrapped;
  const ledger = createTerminalCaptureLedger({
    store: storeFor,
    directory,
    sales,
    maxAmountCents: MAX_CENTS,
    unboundRefundAfterMs: DAY,
    now: clock,
  });

  return {
    captures,
    ledger,
    devices,
    directory,
    sales,
    sale(clientId = TENANT) {
      const orderId = `order-${orders.size + 1}`;
      const paymentId = `payment-${payments.size + 1}`;
      orders.set(orderId, clientId);
      payments.set(paymentId, orderId);
      return { orderId, paymentId };
    },
    device(clientId = TENANT) {
      const deviceId = `device-${devices.size + 1}`;
      devices.set(deviceId, clientId);
      return deviceId;
    },
    rows: () => captures.all(),
    row(code, clientId = TENANT) {
      const found = captures.all().find((row) => row.transactionCode === code && row.clientId === clientId);
      if (!found) throw new Error(`no capture ${code} at ${clientId}`);
      return found;
    },
  };
}

export function capture(overrides: Partial<RecordCaptureInput> = {}): RecordCaptureInput {
  return {
    clientId: TENANT,
    transactionCode: 'TC-0001',
    kind: 'CREDIT',
    amountCents: 2500,
    source: 'DEVICE',
    capturedAt: NOW,
    transactionId: 'TID-0001',
    hostNsu: '000123',
    authorizationCode: 'A1B2C3',
    cardBrand: 'VISA',
    installments: 1,
    terminalSerial: 'PBA-SERIAL-1',
    entryMode: 'CHIP',
    ...overrides,
  };
}

export function wire(overrides: Partial<StationCaptureWire> = {}): StationCaptureWire {
  return {
    transactionCode: 'TC-0001',
    kind: 'CREDIT',
    amountCents: 2500,
    capturedAt: NOW.toISOString(),
    transactionId: 'TID-0001',
    hostNsu: '000123',
    authorizationCode: 'A1B2C3',
    cardBrand: 'VISA',
    installments: 1,
    terminalSerial: 'PBA-SERIAL-1',
    entryMode: 'CHIP',
    ...overrides,
  };
}

/** The `CaptureError` a promise rejects with; fails the test when it resolves or throws anything else. */
export async function refusal(promise: Promise<unknown>): Promise<CaptureError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof CaptureError)) throw new Error(`expected a CaptureError, got ${String(error)}`);
  return error;
}

/**
 * The store, except that right after its first read of a capture once
 * `armed()` is true, `flag` is written on that capture — a sweep or a cancel
 * landing between a move's read and its write.
 */
export function flagAfterFirstRead(
  flag: { reason: string; at: Date },
  armed: () => boolean,
): (store: TerminalCaptureStore) => TerminalCaptureStore {
  const fired = new Set<string>();
  return (store) => ({
    ...store,
    async find(clientId, transactionCode) {
      const row = await store.find(clientId, transactionCode);
      if (fired.size === 0 && row && armed()) {
        fired.add(row.id);
        await store.flagIfNotLive(clientId, transactionCode, flag, false);
      }
      return row;
    },
  });
}
