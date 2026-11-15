import { owedBackForGood } from './decisions';
import type { TerminalCaptureLedger } from './ledger';
import { CaptureError, clampToNow, type BindTarget, type RecordCaptureInput, type TerminalCaptureRecord } from './model';
import type { StationCaptureWire } from './readers';

/**
 * A typed capture booked as a sale of its own (FUT-4997): an amount someone
 * typed on the terminal and charged with no sale behind it, reported by the
 * terminal and relayed by the station. The engine decides, idempotent on
 * `(clientId, transactionCode)`; the host answers the ports over its own
 * tables and keeps its policy, its session and its words.
 *
 * - **A repeat answers the first booking** (`BOOKED`, `created: false`), the
 *   same sale, whether it is a resend, a lost acknowledgement or a second page
 *   racing the first: the bind's compare-and-set lets one sale take the
 *   capture, and the loser's transaction rolls its sale back.
 * - **A capture another sale holds is acknowledged, never booked** (`BOUND`):
 *   someone answered it on a sale, or a recovery took it first.
 * - **Nothing is booked while it may not be**: no open session (`WAITING`), or
 *   the host's policy refuses a standalone sale now (`NOT_ALLOWED`). The
 *   capture stays UNBOUND and its terminal keeps reporting it.
 * - **`ack` says whether the terminal may stop reporting it.** It is the only
 *   signal for the acknowledgement: never acknowledge on receipt.
 * - **The terminal names the seller.** The sale is sold by, and booked on the
 *   session of, the terminal the ledger recorded the capture for. A page that
 *   names another terminal, or none, is `DEVICE_MISMATCH`.
 *
 * A matching sale is the page's question (`matchTypedCapture` in the frontend
 * package); this decision is asked only once nobody claims the capture.
 */

/** What may stop a booking for good, as a code. `CONTENDED` is transient: ask again. */
export type TypedBookRefusal = 'CONFLICT' | 'DEVICE_MISMATCH' | 'CONTENDED';

/** The booking's answer. `ack`: the terminal may stop reporting the capture. */
export type TypedBookAnswer =
  | { outcome: 'BOOKED'; orderId: string; paymentId: string; created: boolean; ack: true }
  | { outcome: 'BOUND'; orderId: string; ack: true }
  | { outcome: 'FLAGGED'; ack: true }
  | { outcome: 'WAITING'; ack: false }
  | { outcome: 'NOT_ALLOWED'; reason: string; ack: false }
  | { outcome: 'REFUSED'; code: TypedBookRefusal; ack: false };

export interface TypedCaptureInput {
  clientId: string;
  /** The terminal that took the capture, as the station's link names it. Must be this tenant's. */
  deviceId: string;
  capture: StationCaptureWire;
}

/** The sale the host writes for one capture: no line, one payment row, sold by the terminal. */
export interface StandaloneSale<TSession> {
  clientId: string;
  /** The terminal that took it: the host sells as that terminal's own user. */
  deviceId: string;
  session: TSession;
  capture: TerminalCaptureRecord;
}

/** The host's answers. Every `tx` is the handle {@link TypedBookingPorts.transaction} opened. */
export interface TypedBookingPorts<TTx = unknown, TSession = unknown> {
  /** One host transaction: the sale and the capture's bind commit together, or nothing does. */
  transaction<T>(work: (tx: TTx) => Promise<T>): Promise<T>;
  /** Whether a standalone sale may be booked at this tenant now; the reason is the host's own code. */
  mayBook(clientId: string, tx?: TTx): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** The open session a sale of this terminal is booked on, or null while none is open. */
  openSession(clientId: string, deviceId: string, tx?: TTx): Promise<TSession | null>;
  /** The sale already booked for this capture by this decision, or null. Backed by a unique key of the host's. */
  bookedFor(clientId: string, transactionCode: string, tx?: TTx): Promise<BindTarget | null>;
  /** Write the sale and its one payment row (the capture's kind and amount). */
  createSale(tx: TTx, sale: StandaloneSale<TSession>): Promise<BindTarget>;
  /**
   * Whether an error the transaction threw is a race worth deciding again: the
   * host's unique key on the booked sale, say. A {@link CaptureError} always
   * is; any other error is thrown at once. Default: no other error.
   */
  isRetryable?(error: unknown): boolean;
}

export interface TypedCaptureBookingConfig<TTx = unknown, TSession = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  ports: TypedBookingPorts<TTx, TSession>;
  /** The clock. Default: the system's. */
  now?: () => Date;
}

export interface TypedCaptureBooking {
  book(input: TypedCaptureInput): Promise<TypedBookAnswer>;
}

/** How often a booking that lost its transaction decides again: the second read sees the winner. */
const BOOK_ATTEMPTS = 3;

const mismatch = (): TypedBookAnswer => ({ outcome: 'REFUSED', code: 'DEVICE_MISMATCH', ack: false });

const STOPS: ReadonlySet<string> = new Set<TypedBookRefusal>(['CONFLICT', 'DEVICE_MISMATCH']);

/** A transaction that lost a race: decide again on what is there now. */
interface Lost {
  lost: unknown;
}

function recordInputOf(input: TypedCaptureInput, now: Date): RecordCaptureInput {
  const { capture } = input;
  return {
    clientId: input.clientId,
    source: 'STATION',
    transactionCode: capture.transactionCode,
    kind: capture.kind,
    amountCents: capture.amountCents,
    capturedAt: clampToNow(new Date(capture.capturedAt), now),
    deviceId: input.deviceId,
    transactionId: capture.transactionId,
    hostNsu: capture.hostNsu,
    authorizationCode: capture.authorizationCode,
    cardBrand: capture.cardBrand,
    installments: capture.installments,
    terminalSerial: capture.terminalSerial,
    entryMode: capture.entryMode,
  };
}

function refusedAs(error: unknown): TypedBookAnswer | null {
  if (!(error instanceof CaptureError)) return null;
  if (STOPS.has(error.code) || error.code === 'CONTENDED') return { outcome: 'REFUSED', code: error.code as TypedBookRefusal, ack: false };
  return null;
}

export function createTypedCaptureBooking<TTx = unknown, TSession = unknown>(
  config: TypedCaptureBookingConfig<TTx, TSession>,
): TypedCaptureBooking {
  const { ledger, ports } = config;
  const clock = config.now ?? (() => new Date());

  /** A capture some sale holds: the first booking of it, or another sale's. */
  async function heldAnswer(clientId: string, capture: TerminalCaptureRecord, orderId: string): Promise<TypedBookAnswer> {
    const booked = await ports.bookedFor(clientId, capture.transactionCode);
    if (booked !== null && booked.orderId === orderId) return { outcome: 'BOOKED', ...booked, created: false, ack: true };
    return { outcome: 'BOUND', orderId, ack: true };
  }

  const retryable = (error: unknown): boolean => error instanceof CaptureError || ports.isRetryable?.(error) === true;

  async function once(input: TypedCaptureInput): Promise<TypedBookAnswer | Lost> {
    const now = clock();
    const { clientId } = input;
    const code = input.capture.transactionCode;
    const { capture } = await ledger.record(recordInputOf(input, now));
    // The terminal's own report names the terminal; the page may only agree with it.
    if (capture.deviceId !== null && capture.deviceId !== input.deviceId) return mismatch();
    const deviceId = capture.deviceId ?? input.deviceId;
    if (capture.orderId !== null) return heldAnswer(clientId, capture, capture.orderId);
    if (owedBackForGood(capture)) return { outcome: 'FLAGGED', ack: true };
    const policy = await ports.mayBook(clientId);
    if (!policy.ok) return { outcome: 'NOT_ALLOWED', reason: policy.reason, ack: false };
    const session = await ports.openSession(clientId, deviceId);
    if (session === null) return { outcome: 'WAITING', ack: false };
    try {
      return await ports.transaction(async (tx): Promise<TypedBookAnswer> => {
        const booked = await ports.bookedFor(clientId, code, tx);
        if (booked !== null) return { outcome: 'BOOKED', ...booked, created: false, ack: true };
        const target = await ports.createSale(tx, { clientId, deviceId, session, capture });
        await ledger.bind(tx, clientId, [code], target, now);
        return { outcome: 'BOOKED', ...target, created: true, ack: true };
      });
    } catch (lost) {
      if (!retryable(lost)) throw lost;
      return { lost };
    }
  }

  return {
    async book(input) {
      // No terminal named: the tenant check would be skipped, so nothing is recorded.
      if (input.deviceId.trim() === '') return mismatch();
      let last: unknown = null;
      for (let attempt = 0; attempt < BOOK_ATTEMPTS; attempt += 1) {
        let answer: TypedBookAnswer | Lost;
        try {
          answer = await once(input);
        } catch (error) {
          const refused = refusedAs(error);
          if (refused !== null) return refused;
          throw error;
        }
        if (!('lost' in answer)) return answer;
        last = answer.lost;
      }
      const refused = refusedAs(last);
      if (refused !== null) return refused;
      throw last;
    },
  };
}
