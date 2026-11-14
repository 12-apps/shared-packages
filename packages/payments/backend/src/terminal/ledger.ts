import {
  MOVE_ATTEMPTS,
  REFUSALS,
  awaitsItsReport,
  bindDecision,
  markDecision,
  versionOf,
} from './decisions';
import {
  CaptureError,
  UNBOUND_ONLY_REASONS,
  clampToNow,
  refundLive,
  traceColumns,
  type BindTarget,
  type CaptureKey,
  type CaptureState,
  type RecordCaptureInput,
  type TerminalCaptureRecord,
} from './model';
import type { CapturePatch, SaleDirectory, TerminalCaptureStore, TerminalCaptureStoreFor, TerminalDirectory } from './ports';
import type { DeviceCaptureReport } from './readers';

/**
 * The terminal capture ledger: one record per card or Pix capture a paired
 * terminal took. It is the acquirer trace's source of truth, written before or
 * apart from any sale.
 *
 * Every move is idempotent, because two transports carry the same capture (the
 * terminal's own report and the station's sale request): the first one wins
 * and the second is a no-op. A move that would contradict the first — the same
 * code for another amount, a capture already bound to another sale — is a
 * {@link CaptureError}, never a silent overwrite.
 *
 * Every write is predicated on the whole row it read — the state, the sale and
 * the refund flag — so neither a racing bind nor a flag committed between the
 * read and the write can be overwritten: the loser re-reads and decides again
 * on what is there now, and gives up as `CONTENDED` after {@link MOVE_ATTEMPTS}.
 *
 * The tenant is always an argument, never read off the capture: a transaction
 * code is unique per tenant only, and nothing here may reach another tenant's
 * row.
 */

export interface TerminalCaptureLedgerConfig<TTx = unknown> {
  store: TerminalCaptureStoreFor<TTx>;
  directory: TerminalDirectory<TTx>;
  sales: SaleDirectory<TTx>;
  /** The most one capture may carry, in cents. Required: it is the host's own ceiling. */
  maxAmountCents: number;
  /**
   * How long a capture may wait for its sale before the sweep flags its money
   * to go back. Required: it must be at least as long as the longest a host's
   * sale may legitimately arrive late (an offline window), which only the host
   * knows.
   */
  unboundRefundAfterMs: number;
  /** The clock. Default: the system's. */
  now?: () => Date;
}

/** A device's identity, as the host resolved it from the device's credential. */
export interface CaptureDevice {
  clientId: string;
  deviceId: string;
}

/** What a terminal reads back after reporting a capture. */
export interface DeviceCaptureAnswer {
  transactionCode: string;
  kind: string;
  amountCents: number;
  state: CaptureState;
  /** True when this call wrote the row; false for a replay. */
  created: boolean;
  orderId: string | null;
  capturedAt: string;
  /** The money is owed back (the sweep or a cancelled sale flagged it). */
  refundFlagged: boolean;
}

export interface TerminalCaptureLedger<TTx = unknown> {
  readonly maxAmountCents: number;
  readonly unboundRefundAfterMs: number;
  /**
   * Record a capture, or answer the one already recorded under its code.
   *
   * Idempotent on `(clientId, transactionCode)`: a replay with the same amount
   * and kind returns the stored row untouched (`created: false`), whichever
   * transport recorded it first. The same code with another amount or kind is
   * a `CONFLICT`: an acquirer never reuses a code, so one of the two reports is
   * wrong, and the stored row is the one the tenant can reconcile. Written as
   * an insert-unless-present, never a caught unique violation, so it is safe
   * inside a caller's transaction.
   */
  record(input: RecordCaptureInput, tx?: TTx): Promise<{ capture: TerminalCaptureRecord; created: boolean }>;
  /**
   * The terminal records a capture itself. The tenant and the terminal come
   * from the device's credential, never the body; the source is `DEVICE`; a
   * capture time in the future is read as now. A `CONFLICT` is thrown as
   * {@link CaptureError} for the host to answer.
   */
  recordFromDevice(device: CaptureDevice, report: DeviceCaptureReport, now?: Date): Promise<DeviceCaptureAnswer>;
  /** The tenant's captures under these codes, in no particular order. Codes it does not hold are absent. */
  findByCodes(clientId: string, transactionCodes: readonly string[], tx?: TTx): Promise<TerminalCaptureRecord[]>;
  /** The ORDER_CREATED captures of these sales, oldest first. */
  findCreatedFor(clientId: string, orderIds: readonly string[], tx?: TTx): Promise<TerminalCaptureRecord[]>;
  /**
   * UNBOUND -> ORDER_CREATED: a creating path wrote the sale before settling
   * it. A replay naming the same sale is a no-op, and so is one that finds the
   * capture already BOUND to it. Another sale is `BOUND_ELSEWHERE`; a capture
   * flagged for any refund but the timeout's is `FLAGGED`, as `bind` would
   * answer it.
   */
  markSaleCreated(tx: TTx, key: CaptureKey, orderId: string): Promise<TerminalCaptureRecord>;
  /**
   * -> BOUND: the captures become legs of the sale's payment row, in the
   * transaction that claims that row. A capture UNBOUND or ORDER_CREATED for
   * this sale is bound; one BOUND to this very sale and row is a no-op; one
   * held by anything else is `BOUND_ELSEWHERE` and the caller's transaction
   * rolls back. A timeout flag is cleared (`refundClearedAt`) — the sale arrived
   * late, inside the window — and a flag for any other reason is `FLAGGED`.
   */
  bind(tx: TTx, clientId: string, transactionCodes: readonly string[], target: BindTarget, now?: Date): Promise<TerminalCaptureRecord[]>;
  /**
   * Flag a capture's money for a refund — at most once per real refund.
   * `flagged: false` when a flag is already live, so a caller never raises the
   * same refund twice. A flag a bind CLEARED is no refund any more, so the
   * capture may be flagged again. `UNBOUND_TIMEOUT` and `SALE_NOT_CREATED` on a
   * capture a sale holds are `NOT_UNBOUND`, and nothing is written.
   */
  flag(key: CaptureKey, reason: string, now?: Date, tx?: TTx): Promise<{ flagged: boolean }>;
  /**
   * Flag every capture a sale holds (ORDER_CREATED for it or BOUND to it) when
   * the sale stops holding their money — cancelled, or its payment undone —
   * once each: a live flag is left as it is and not counted. ONE statement, in
   * the caller's transaction when it has one, so the flag commits with the
   * cancel or not at all. How many were flagged.
   */
  flagSale(clientId: string, orderId: string, reason: string, tx?: TTx): Promise<number>;
  /**
   * Flag up to `limit` captures still UNBOUND {@link unboundRefundAfterMs}
   * after they were taken AND after they were recorded, oldest first, once
   * each. How many this call flagged.
   */
  flagStaleUnbound(now: Date, limit: number): Promise<number>;
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got ${String(value)}`);
  return value;
}

function present(capture: TerminalCaptureRecord, created: boolean): DeviceCaptureAnswer {
  return {
    transactionCode: capture.transactionCode,
    kind: capture.kind,
    amountCents: capture.amountCents,
    state: capture.state,
    created,
    orderId: capture.orderId,
    capturedAt: capture.capturedAt.toISOString(),
    refundFlagged: refundLive(capture),
  };
}

/** The read every move starts from; its absence is `NOT_FOUND`. */
async function readOrRefuse(store: TerminalCaptureStore, clientId: string, code: string): Promise<TerminalCaptureRecord> {
  const current = await store.find(clientId, code);
  if (!current) throw new CaptureError('NOT_FOUND', code, REFUSALS.NOT_FOUND);
  return current;
}

/**
 * Write `patch` on the row a decision was made on, and answer the row after
 * it — or `null` when the row changed since the read and the move must decide
 * again.
 */
async function landOn(
  store: TerminalCaptureStore,
  current: TerminalCaptureRecord,
  patch: CapturePatch,
): Promise<TerminalCaptureRecord | null> {
  if (!(await store.writeIfUnchanged(versionOf(current), patch))) return null;
  return store.find(current.clientId, current.transactionCode);
}

/**
 * A capture the offline journal recorded from its leg alone given the trace
 * when the terminal, or a station that heard it, reports it.
 *
 * The report is the truth. When it names another kind or amount than the leg
 * the cashier kept, it is never thrown away as a conflict (the terminal's
 * outbox would drop it, and an overcharge would vanish): the row takes the
 * report's kind and amount too, and is flagged `JOURNAL_CONFLICT` — once — so
 * a person reconciles the sale with what the terminal charged. Otherwise its
 * state, sale and refund flag stay as they are.
 */
async function withReportedTrace(
  store: TerminalCaptureStore,
  row: TerminalCaptureRecord,
  input: RecordCaptureInput,
  now: Date,
): Promise<TerminalCaptureRecord> {
  const contradicts = row.kind !== input.kind || row.amountCents !== input.amountCents;
  const conflict: CapturePatch = contradicts
    ? { kind: input.kind, amountCents: input.amountCents, refundFlaggedAt: now, refundReason: 'JOURNAL_CONFLICT', refundClearedAt: null }
    : {};
  await store.completeJournalTrace(row.id, {
    ...traceColumns(input),
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...conflict,
  });
  return (await store.find(input.clientId, input.transactionCode)) ?? row;
}

/** What every move reads its ports and clock from. */
interface Engine<TTx> {
  storeFor: TerminalCaptureStoreFor<TTx>;
  directory: TerminalDirectory<TTx>;
  sales: SaleDirectory<TTx>;
  clock: () => Date;
}

async function record<TTx>(
  engine: Engine<TTx>,
  input: RecordCaptureInput,
  tx?: TTx,
): Promise<{ capture: TerminalCaptureRecord; created: boolean }> {
  const store = engine.storeFor(tx);
  if (input.deviceId && !(await engine.directory.devicesBelong(input.clientId, [input.deviceId], tx))) {
    throw new CaptureError('DEVICE_MISMATCH', input.transactionCode, REFUSALS.DEVICE_MISMATCH);
  }
  const inserted = await store.insertIfAbsent({
    clientId: input.clientId,
    transactionCode: input.transactionCode,
    kind: input.kind,
    amountCents: input.amountCents,
    source: input.source,
    deviceId: input.deviceId ?? null,
    ...traceColumns(input),
    capturedAt: input.capturedAt,
  });
  const row = await store.find(input.clientId, input.transactionCode);
  if (!row) throw new CaptureError('NOT_FOUND', input.transactionCode, 'The capture vanished after its insert.');
  if (!inserted && awaitsItsReport(row, input)) {
    return { capture: await withReportedTrace(store, row, input, engine.clock()), created: false };
  }
  if (!inserted && (row.amountCents !== input.amountCents || row.kind !== input.kind)) {
    throw new CaptureError('CONFLICT', input.transactionCode, 'This transaction code was already recorded with another amount or kind.');
  }
  return { capture: row, created: inserted };
}

async function markSaleCreated<TTx>(engine: Engine<TTx>, tx: TTx, key: CaptureKey, orderId: string): Promise<TerminalCaptureRecord> {
  const { clientId, transactionCode } = key;
  if (!(await engine.sales.saleBelongs(tx, clientId, orderId))) {
    throw new CaptureError('SALE_MISMATCH', transactionCode, REFUSALS.SALE_MISMATCH);
  }
  const store = engine.storeFor(tx);
  for (let attempt = 0; attempt < MOVE_ATTEMPTS; attempt += 1) {
    const current = await readOrRefuse(store, clientId, transactionCode);
    const decision = markDecision(current, orderId);
    if (decision === 'replay') return current;
    if (decision !== 'mark') throw new CaptureError(decision, transactionCode, REFUSALS[decision]);
    const after = await landOn(store, current, { state: 'ORDER_CREATED', orderId });
    if (after) return after;
  }
  throw new CaptureError('CONTENDED', transactionCode, REFUSALS.CONTENDED);
}

/** Bind one capture: decided on a read, written only while that read still holds. */
async function bindOne(store: TerminalCaptureStore, clientId: string, code: string, target: BindTarget, now: Date): Promise<TerminalCaptureRecord> {
  for (let attempt = 0; attempt < MOVE_ATTEMPTS; attempt += 1) {
    const current = await readOrRefuse(store, clientId, code);
    const decision = bindDecision(current, target);
    if (decision === 'replay') return current;
    if (typeof decision === 'string') throw new CaptureError(decision, code, REFUSALS[decision]);
    const after = await landOn(store, current, {
      state: 'BOUND',
      orderId: target.orderId,
      paymentId: target.paymentId,
      ...(decision.clearFlag ? { refundClearedAt: now } : {}),
    });
    if (after) return after;
    // Changed since the read (a racing bind, a flag): read and decide again.
  }
  throw new CaptureError('CONTENDED', code, REFUSALS.CONTENDED);
}

async function bind<TTx>(
  engine: Engine<TTx>,
  tx: TTx,
  clientId: string,
  transactionCodes: readonly string[],
  target: BindTarget,
  now: Date,
): Promise<TerminalCaptureRecord[]> {
  const codes = [...new Set(transactionCodes)];
  if (codes.length === 0) return [];
  if (!(await engine.sales.paymentBelongs(tx, clientId, target.orderId, target.paymentId))) {
    throw new CaptureError('SALE_MISMATCH', codes[0] ?? '', "The payment row is not this tenant's sale's.");
  }
  const store = engine.storeFor(tx);
  const bound: TerminalCaptureRecord[] = [];
  // One compare-and-set per capture leg of ONE sale.
  for (const code of codes) bound.push(await bindOne(store, clientId, code, target, now));
  return bound;
}

async function flag<TTx>(engine: Engine<TTx>, key: CaptureKey, reason: string, now: Date, tx?: TTx): Promise<{ flagged: boolean }> {
  const store = engine.storeFor(tx);
  const unboundOnly = UNBOUND_ONLY_REASONS.has(reason);
  if (await store.flagIfNotLive(key.clientId, key.transactionCode, { at: now, reason }, unboundOnly)) return { flagged: true };
  const current = await readOrRefuse(store, key.clientId, key.transactionCode);
  if (unboundOnly && current.state !== 'UNBOUND') throw new CaptureError('NOT_UNBOUND', key.transactionCode, REFUSALS.NOT_UNBOUND);
  return { flagged: false };
}

export function createTerminalCaptureLedger<TTx = unknown>(config: TerminalCaptureLedgerConfig<TTx>): TerminalCaptureLedger<TTx> {
  const maxAmountCents = positive('maxAmountCents', config.maxAmountCents);
  const unboundRefundAfterMs = positive('unboundRefundAfterMs', config.unboundRefundAfterMs);
  const engine: Engine<TTx> = { ...config, storeFor: config.store, clock: config.now ?? (() => new Date()) };
  const { storeFor, clock } = engine;

  return {
    maxAmountCents,
    unboundRefundAfterMs,
    record: (input, tx) => record(engine, input, tx),
    async recordFromDevice(device, report, now = clock()) {
      const { capturedAt, ...rest } = report;
      const { capture, created } = await record(engine, {
        ...rest,
        clientId: device.clientId,
        deviceId: device.deviceId,
        source: 'DEVICE',
        capturedAt: capturedAt ? clampToNow(new Date(capturedAt), now) : now,
      });
      return present(capture, created);
    },
    async findByCodes(clientId, transactionCodes, tx) {
      if (transactionCodes.length === 0) return [];
      return storeFor(tx).findMany(clientId, [...new Set(transactionCodes)]);
    },
    async findCreatedFor(clientId, orderIds, tx) {
      if (orderIds.length === 0) return [];
      return storeFor(tx).findCreatedFor(clientId, orderIds);
    },
    markSaleCreated: (tx, key, orderId) => markSaleCreated(engine, tx, key, orderId),
    bind: (tx, clientId, codes, target, now = clock()) => bind(engine, tx, clientId, codes, target, now),
    flag: (key, reason, now = clock(), tx) => flag(engine, key, reason, now, tx),
    async flagSale(clientId, orderId, reason, tx) {
      return storeFor(tx).flagHeldBy(clientId, orderId, { at: clock(), reason });
    },
    async flagStaleUnbound(now, limit) {
      return storeFor().flagStaleUnbound(now, new Date(now.getTime() - unboundRefundAfterMs), limit);
    },
  };
}
