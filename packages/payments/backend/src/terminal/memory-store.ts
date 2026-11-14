import { refundLive, type TerminalCaptureRecord } from './model';
import type {
  CapturePatch,
  CaptureVersion,
  NewTerminalCapture,
  RefundFlag,
  Savepoint,
  TerminalCaptureStore,
  TerminalCaptureStoreFor,
} from './ports';

/**
 * The in-memory capture table, for tests and a host with no database. Every
 * predicate is checked and written with no await between, so in one process it
 * is the same fence the database store's single statements are.
 *
 * It keeps the store's own clock per row (`recordedAt`, the database's
 * `created_at`) beside the terminal's `capturedAt`, because the sweep reads
 * both. `transaction` and `savepoint` roll the whole table back to a snapshot,
 * which is what a database transaction and a SQL savepoint do for these rows.
 */
export interface MemoryTerminalCaptures {
  store: TerminalCaptureStore;
  /** The same store for any handle: the memory table has one. */
  storeFor: TerminalCaptureStoreFor<unknown>;
  /** Every row, in insertion order. */
  all(): TerminalCaptureRecord[];
  /** Set when the store recorded a row: its own clock, which the sweep also reads. */
  setRecordedAt(clientId: string, transactionCode: string, at: Date): void;
  /** Run `fn`, and put every row back as it was when it throws. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  savepoint: Savepoint<unknown>;
}

interface Row extends TerminalCaptureRecord {
  recordedAt: Date;
}

const keyOf = (clientId: string, code: string): string => `${clientId}\u0000${code}`;

function answer(row: Row): TerminalCaptureRecord {
  const record: Partial<Row> = { ...row };
  delete record.recordedAt;
  return record as TerminalCaptureRecord;
}

const sameTime = (a: Date | null, b: Date | null): boolean => (a === null || b === null ? a === b : a.getTime() === b.getTime());

function matches(row: Row, seen: CaptureVersion): boolean {
  return (
    row.id === seen.id &&
    row.state === seen.state &&
    row.orderId === seen.orderId &&
    sameTime(row.refundFlaggedAt, seen.refundFlaggedAt) &&
    sameTime(row.refundClearedAt, seen.refundClearedAt)
  );
}

function definedOnly(patch: CapturePatch): Partial<Row> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<Row>;
}

function flagRow(row: Row, flag: RefundFlag): void {
  row.refundFlaggedAt = flag.at;
  row.refundReason = flag.reason;
  row.refundClearedAt = null;
}

/** The table, swapped whole when a transaction or a savepoint rolls back. */
interface Table {
  rows: Map<string, Row>;
  ids: number;
  clock: () => Date;
}

const byId = (table: Table, id: string): Row | undefined => [...table.rows.values()].find((row) => row.id === id);

function staleRows(table: Table, cutoff: Date, limit: number): Row[] {
  return [...table.rows.values()]
    .filter(
      (row) =>
        row.state === 'UNBOUND' &&
        row.refundFlaggedAt === null &&
        row.capturedAt.getTime() <= cutoff.getTime() &&
        row.recordedAt.getTime() <= cutoff.getTime(),
    )
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function insertInto(table: Table, row: NewTerminalCapture): boolean {
  const key = keyOf(row.clientId, row.transactionCode);
  if (table.rows.has(key)) return false;
  table.ids += 1;
  table.rows.set(key, {
    ...row,
    id: `capture-${table.ids}`,
    state: 'UNBOUND',
    orderId: null,
    paymentId: null,
    refundFlaggedAt: null,
    refundReason: null,
    refundClearedAt: null,
    recordedAt: table.clock(),
  });
  return true;
}

function memoryStore(table: Table): TerminalCaptureStore {
  const rows = (): Row[] => [...table.rows.values()];
  return {
    insertIfAbsent: async (row) => insertInto(table, row),
    async find(clientId, transactionCode) {
      const row = table.rows.get(keyOf(clientId, transactionCode));
      return row ? answer(row) : null;
    },
    async findMany(clientId, transactionCodes) {
      const codes = new Set(transactionCodes);
      return rows().filter((row) => row.clientId === clientId && codes.has(row.transactionCode)).map(answer);
    },
    async writeIfUnchanged(seen, patch) {
      const row = byId(table, seen.id);
      if (!row || !matches(row, seen)) return false;
      Object.assign(row, definedOnly(patch));
      return true;
    },
    async flagIfNotLive(clientId, transactionCode, flag, unboundOnly) {
      const row = table.rows.get(keyOf(clientId, transactionCode));
      if (!row || refundLive(row) || (unboundOnly && row.state !== 'UNBOUND')) return false;
      flagRow(row, flag);
      return true;
    },
    async flagHeldBy(clientId, orderId, flag) {
      const held = rows().filter((row) => row.clientId === clientId && row.orderId === orderId && !refundLive(row));
      for (const row of held) flagRow(row, flag);
      return held.length;
    },
    async flagStaleUnbound(now, cutoff, limit) {
      const stale = staleRows(table, cutoff, limit);
      for (const row of stale) Object.assign(row, { refundFlaggedAt: now, refundReason: 'UNBOUND_TIMEOUT' });
      return stale.length;
    },
    async findUnclaimed(clientId, deviceIds) {
      const devices = new Set(deviceIds);
      return rows()
        .filter(
          (row) =>
            row.clientId === clientId &&
            row.state === 'UNBOUND' &&
            row.deviceId !== null &&
            devices.has(row.deviceId) &&
            (!refundLive(row) || row.refundReason === 'UNBOUND_TIMEOUT'),
        )
        .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime() || a.id.localeCompare(b.id))
        .map(answer);
    },
    async findCreatedFor(clientId, orderIds) {
      const orders = new Set(orderIds);
      return rows()
        .filter((row) => row.clientId === clientId && row.state === 'ORDER_CREATED' && row.orderId !== null && orders.has(row.orderId))
        .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
        .map(answer);
    },
  };
}

const copyOf = (rows: Map<string, Row>): Map<string, Row> => new Map([...rows].map(([key, row]) => [key, { ...row }]));

export function createMemoryTerminalCaptureStore(options: { now?: () => Date } = {}): MemoryTerminalCaptures {
  const table: Table = { rows: new Map(), ids: 0, clock: options.now ?? (() => new Date()) };
  const snapshots: Map<string, Row>[] = [];
  const store = memoryStore(table);

  return {
    store,
    storeFor: () => store,
    all: () => [...table.rows.values()].map(answer),
    setRecordedAt(clientId, transactionCode, at) {
      const row = table.rows.get(keyOf(clientId, transactionCode));
      if (row) row.recordedAt = at;
    },
    async transaction(fn) {
      const before = copyOf(table.rows);
      try {
        return await fn();
      } catch (error) {
        table.rows = before;
        throw error;
      }
    },
    savepoint: {
      open: async () => void snapshots.push(copyOf(table.rows)),
      release: async () => void snapshots.pop(),
      rollBack: async () => {
        const before = snapshots.pop();
        if (before) table.rows = before;
      },
    },
  };
}
