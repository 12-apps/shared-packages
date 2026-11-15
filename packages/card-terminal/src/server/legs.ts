import { owedBackForGood } from './decisions';
import {
  CaptureError,
  clampToNow,
  notBoundReasonOf,
  type CaptureNotBoundReason,
  type RecordCaptureInput,
  type TerminalCaptureRecord,
} from './model';
import type { TerminalCaptureLedger } from './ledger';
import type { TerminalDirectory } from './ports';
import type { StationCaptureWire } from './readers';

/**
 * A sale's terminal legs: the card or Pix legs of a sale that the tenant's
 * paired terminal took, each carrying the capture behind it. The capture
 * record is the replay key, never the leg:
 *
 * 1. **Before anything is written** the request's codes are looked up
 *    ({@link TerminalLegs.held}). A code recorded with another amount or kind,
 *    held by another sale, or flagged for a refund refuses the request with
 *    nothing written. Codes all held by one sale name that sale.
 * 2. Each capture is recorded under the station's report (`STATION`),
 *    idempotent on its code — the terminal may have reported it first — and
 *    BEFORE the sale is written: the money was taken whatever happens next.
 * 3. A creating path marks them ORDER_CREATED in the sale's own create
 *    transaction ({@link TerminalLegs.markCreatedIn}), so a settle that fails
 *    leaves the sale with its captures naming it, and the retry settles THAT
 *    sale and writes no other.
 * 4. The settle binds them to the sale's ONE payment row, inside the
 *    transaction that writes it ({@link TerminalLegs.bindingFor}).
 *
 * Every answer is a {@link CaptureNotBoundReason} code; the host owns the copy
 * and the status it answers with. Tenant-scoped throughout.
 */

/** A leg as a sale's body carries it. */
export interface LegWire {
  tender: string;
  amountCents?: number | undefined;
  capture?: StationCaptureWire | undefined;
}

/** What the tenant already holds under a request's codes: the one sale they name, if any. */
export type HeldCaptures =
  | { ok: true; orderId: string | null; records: TerminalCaptureRecord[] }
  | { ok: false; code: CaptureNotBoundReason };

/**
 * What a sale's codes say before the sale is read: refused, every one already
 * BOUND to this sale (the host decides what that replays), or go ahead.
 */
export type HeldForSale =
  | { kind: 'PROCEED' }
  | { kind: 'REFUSED'; code: CaptureNotBoundReason }
  | { kind: 'ALL_BOUND' };

/** The settle's hook: inside the transaction that wrote the payment row, bind the captures to it. */
export interface CaptureBinding<TTx = unknown> {
  bind(tx: TTx, paymentId: string): Promise<void>;
}

export interface TerminalLegs<TTx = unknown> {
  /** The captures a request's legs carry, in leg order. Empty for every non-terminal sale. */
  capturesOf(tenders: readonly LegWire[]): StationCaptureWire[];
  /**
   * The request's codes as the tenant holds them, read before anything is
   * written: refused when one conflicts, is flagged, names another tenant's
   * terminal, or when they name more than one sale; otherwise the sale they
   * name (`null`: none, a new sale).
   */
  held(clientId: string, captures: readonly StationCaptureWire[]): Promise<HeldCaptures>;
  /** Every one of the request's codes is BOUND to `orderId`: the request already settled it. */
  allBoundTo(held: Extract<HeldCaptures, { ok: true }>, captures: readonly StationCaptureWire[], orderId: string): boolean;
  /**
   * A settle of an existing sale: refused when a code names another sale;
   * `ALL_BOUND` when every one is already BOUND to this sale; otherwise
   * `PROCEED`. No read at all for a sale with no terminal leg.
   */
  heldForSale(clientId: string, orderId: string, captures: readonly StationCaptureWire[]): Promise<HeldForSale>;
  /**
   * Record the request's captures before the sale is written, so the tenant
   * can reconcile — and the sweep flag — a capture whose sale is then
   * refused. A race the look-up could not see is the refusal code.
   */
  recordStation(clientId: string, captures: readonly StationCaptureWire[], tx?: TTx): Promise<CaptureNotBoundReason | null>;
  /**
   * UNBOUND -> ORDER_CREATED for each capture, in the sale's create
   * transaction: written and marked together, or neither. A capture another
   * sale took meanwhile throws its {@link CaptureError}, which rolls the
   * create back.
   */
  markCreatedIn(tx: TTx, clientId: string, captures: readonly StationCaptureWire[], orderId: string): Promise<void>;
  /**
   * The settle's hook: record each capture again (a no-op once recorded) and
   * bind them all to the payment row. `undefined` for a sale with none, so
   * every other settle is the settle it always was.
   */
  bindingFor(clientId: string, orderId: string, captures: readonly StationCaptureWire[]): CaptureBinding<TTx> | undefined;
  /**
   * After a claim this request LOST: whether every one of its codes is now
   * BOUND to `orderId` — a concurrent twin settled it with these very
   * captures, so the answer is that settle's, never "not charged" over money
   * that is in.
   */
  boundAfterLostClaim(clientId: string, captures: readonly StationCaptureWire[], orderId: string): Promise<boolean>;
  /**
   * The captures each listed sale holds and no leg took yet: ORDER_CREATED for
   * it and not owed back, as the wire a terminal leg resends — so money
   * already taken is received, never charged a second time. One read for the
   * whole list; a sale with none is absent from the map.
   */
  createdCapturesFor(clientId: string, orderIds: readonly string[]): Promise<Map<string, StationCaptureWire[]>>;
  /**
   * The captures these terminals took that no sale holds and that are not owed
   * back, as the wire a terminal leg sends, oldest first: money a counter
   * already received and may still use for a sale ("received, no sale"), so a
   * buyer is never charged again after a reload. Unused, they keep the sweep's
   * window. One read; none for no terminal.
   */
  unclaimed(clientId: string, deviceIds: readonly string[]): Promise<StationCaptureWire[]>;
  /** A move the record refused mid-request, as its code. */
  refusalCodeOf(error: CaptureError): CaptureNotBoundReason;
}

export interface TerminalLegsConfig<TTx = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  directory: TerminalDirectory<TTx>;
  /** The clock. Default: the system's. */
  now?: () => Date;
}

/** Why a held capture cannot pay this request — or `null` when it can. */
function heldRefusal(record: TerminalCaptureRecord, sent: StationCaptureWire | undefined): CaptureNotBoundReason | null {
  if (sent === undefined) return null;
  if (record.amountCents !== sent.amountCents || record.kind !== sent.kind) return 'CONFLICT';
  // Two terminals cannot have taken one capture: when both sides name one, they are the same.
  if (record.deviceId !== null && sent.deviceId != null && record.deviceId !== sent.deviceId) return 'CONFLICT';
  return owedBackForGood(record) ? 'FLAGGED' : null;
}

function recordInputOf(clientId: string, capture: StationCaptureWire, now: Date): RecordCaptureInput {
  return {
    clientId,
    source: 'STATION',
    transactionCode: capture.transactionCode,
    kind: capture.kind,
    amountCents: capture.amountCents,
    capturedAt: clampToNow(new Date(capture.capturedAt), now),
    deviceId: capture.deviceId ?? null,
    transactionId: capture.transactionId,
    hostNsu: capture.hostNsu,
    authorizationCode: capture.authorizationCode,
    cardBrand: capture.cardBrand,
    installments: capture.installments,
    terminalSerial: capture.terminalSerial,
    entryMode: capture.entryMode,
  };
}

/** A held capture as the wire a terminal leg resends. */
export function wireOf(row: TerminalCaptureRecord): StationCaptureWire {
  return {
    transactionCode: row.transactionCode,
    kind: row.kind,
    amountCents: row.amountCents,
    capturedAt: row.capturedAt.toISOString(),
    transactionId: row.transactionId,
    hostNsu: row.hostNsu,
    authorizationCode: row.authorizationCode,
    cardBrand: row.cardBrand,
    installments: row.installments,
    terminalSerial: row.terminalSerial,
    entryMode: row.entryMode,
    deviceId: row.deviceId,
  };
}

const codesOf = (captures: readonly StationCaptureWire[]): string[] => captures.map((capture) => capture.transactionCode);

/** Every terminal the request names is this tenant's. */
async function devicesAreTheTenants<TTx>(
  directory: TerminalDirectory<TTx>,
  clientId: string,
  captures: readonly StationCaptureWire[],
): Promise<boolean> {
  const ids = [...new Set(captures.flatMap((capture) => (capture.deviceId ? [capture.deviceId] : [])))];
  if (ids.length === 0) return true;
  return directory.devicesBelong(clientId, ids);
}

async function held<TTx>(config: TerminalLegsConfig<TTx>, clientId: string, captures: readonly StationCaptureWire[]): Promise<HeldCaptures> {
  if (!(await devicesAreTheTenants(config.directory, clientId, captures))) return { ok: false, code: 'DEVICE_UNKNOWN' };
  const records = await config.ledger.findByCodes(clientId, codesOf(captures));
  const sent = new Map(captures.map((capture) => [capture.transactionCode, capture]));
  for (const record of records) {
    const refusal = heldRefusal(record, sent.get(record.transactionCode));
    if (refusal !== null) return { ok: false, code: refusal };
  }
  const orders = new Set(records.flatMap((record) => (record.orderId === null ? [] : [record.orderId])));
  if (orders.size > 1) return { ok: false, code: 'BOUND_ELSEWHERE' };
  return { ok: true, orderId: [...orders][0] ?? null, records };
}

function allBoundTo(found: Extract<HeldCaptures, { ok: true }>, captures: readonly StationCaptureWire[], orderId: string): boolean {
  const bound = new Set(
    found.records.filter((record) => record.state === 'BOUND' && record.orderId === orderId).map((record) => record.transactionCode),
  );
  return captures.every((capture) => bound.has(capture.transactionCode));
}

/** Record each capture under the station's report, idempotent on its code. */
async function recordAll<TTx>(config: TerminalLegsConfig<TTx>, clientId: string, captures: readonly StationCaptureWire[], tx?: TTx): Promise<void> {
  const now = (config.now ?? (() => new Date()))();
  for (const capture of captures) await config.ledger.record(recordInputOf(clientId, capture, now), tx);
}

async function heldForSale<TTx>(
  config: TerminalLegsConfig<TTx>,
  clientId: string,
  orderId: string,
  captures: readonly StationCaptureWire[],
): Promise<HeldForSale> {
  if (captures.length === 0) return { kind: 'PROCEED' };
  const found = await held(config, clientId, captures);
  if (!found.ok) return { kind: 'REFUSED', code: found.code };
  if (found.orderId === null) return { kind: 'PROCEED' };
  if (found.orderId !== orderId) return { kind: 'REFUSED', code: 'BOUND_ELSEWHERE' };
  return allBoundTo(found, captures, orderId) ? { kind: 'ALL_BOUND' } : { kind: 'PROCEED' };
}

export function createTerminalLegs<TTx = unknown>(config: TerminalLegsConfig<TTx>): TerminalLegs<TTx> {
  const { ledger } = config;

  return {
    capturesOf: (tenders) => tenders.flatMap((leg) => (leg.capture === undefined ? [] : [leg.capture])),
    held: (clientId, captures) => held(config, clientId, captures),
    allBoundTo,
    heldForSale: (clientId, orderId, captures) => heldForSale(config, clientId, orderId, captures),
    async recordStation(clientId, captures, tx) {
      try {
        await recordAll(config, clientId, captures, tx);
        return null;
      } catch (error) {
        if (!(error instanceof CaptureError)) throw error;
        return notBoundReasonOf(error);
      }
    },
    async markCreatedIn(tx, clientId, captures, orderId) {
      for (const capture of captures) await ledger.markSaleCreated(tx, { clientId, transactionCode: capture.transactionCode }, orderId);
    },
    bindingFor(clientId, orderId, captures) {
      if (captures.length === 0) return undefined;
      const codes = codesOf(captures);
      return {
        bind: async (tx, paymentId) => {
          await recordAll(config, clientId, captures, tx);
          await ledger.bind(tx, clientId, codes, { orderId, paymentId });
        },
      };
    },
    async boundAfterLostClaim(clientId, captures, orderId) {
      if (captures.length === 0) return false;
      const records = await ledger.findByCodes(clientId, codesOf(captures));
      return allBoundTo({ ok: true, orderId, records }, captures, orderId);
    },
    async createdCapturesFor(clientId, orderIds) {
      const byOrder = new Map<string, StationCaptureWire[]>();
      for (const record of await ledger.findCreatedFor(clientId, orderIds)) {
        if (record.orderId === null || owedBackForGood(record)) continue;
        byOrder.set(record.orderId, [...(byOrder.get(record.orderId) ?? []), wireOf(record)]);
      }
      return byOrder;
    },
    unclaimed: async (clientId, deviceIds) => (await ledger.findUnclaimed(clientId, deviceIds)).map(wireOf),
    refusalCodeOf: notBoundReasonOf,
  };
}
