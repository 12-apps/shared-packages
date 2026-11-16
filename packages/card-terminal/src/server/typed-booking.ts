import { owedBackForGood } from './decisions';
import type { TerminalCaptureLedger } from './ledger';
import { CaptureError, clampToNow, refundLive, type BindTarget, type RecordCaptureInput, type TerminalCaptureRecord } from './model';
import type { StationCaptureWire } from './readers';

/**
 * A typed capture (FUT-4997): an amount someone typed on the terminal and
 * charged with no sale behind it, reported by the terminal and relayed by the
 * station. The caller books it as a sale of its own.
 *
 * CALLER-DRIVEN. The engine decides only the capture's payment state; it never
 * creates the caller's sale and knows nothing of the caller's sessions or
 * policy. One booking, in the caller's order:
 *
 * 1. {@link TypedCaptureClaims.claimable}: records the capture and answers
 *    whether it is `FREE` (UNBOUND, not owed back), `HELD` by a sale, `FLAGGED`
 *    (owed back), or `REFUSED`.
 * 2. Only on `FREE`, and once {@link timeoutHold} answers null (a capture the
 *    refund sweep flagged `UNBOUND_TIMEOUT` is booked only on a person's
 *    answer, D9-R22) and its own policy and session allow it, the caller
 *    opens ONE transaction and writes its sale and the sale's one payment row
 *    (the capture's kind and amount), sold by `claim.deviceId`.
 * 3. In that same transaction it calls {@link TypedCaptureClaims.bind} with the
 *    handle and the new sale's payment row. The bind's compare-and-set decides
 *    a race: a loser throws a {@link CaptureError}, the caller's transaction
 *    rolls its sale back, and the caller asks `claimable` again (at most three
 *    times in all), which now answers the winner (`HELD`).
 * 4. Only after its transaction COMMITS does the caller acknowledge the
 *    terminal.
 *
 * - **Idempotent per `(clientId, transactionCode)`.** A repeat finds the
 *   capture `HELD` by the first booking's sale; {@link heldAnswer} turns that
 *   into `BOOKED` (`created: false`) when the caller's own key says the sale is
 *   the one booked for this code, else `BOUND`.
 * - **`ack` says whether the terminal may stop reporting it**, and only a
 *   definitive answer carries `ack: true`. Never acknowledge on receipt; a
 *   capture the caller does not book now (no open session, its policy refuses)
 *   stays UNBOUND and is answered with `ack: false`.
 * - **The terminal names the seller.** The ledger's recorded terminal is the
 *   seller; a page naming another terminal, or none, is `DEVICE_MISMATCH`.
 *
 * A matching sale is the page's question (`matchTypedCapture` in `./react`);
 * this decision is asked only once nobody claims the capture.
 */

/** What may stop a booking for good, as a code. `CONTENDED` is transient: ask again. */
export type TypedBookRefusal = 'CONFLICT' | 'DEVICE_MISMATCH' | 'CONTENDED';

/**
 * The booking's answer, as the caller gives it to the station. The engine
 * answers `BOOKED`, `BOUND`, `FLAGGED` and `REFUSED`; `WAITING` (no open
 * session) and `NOT_ALLOWED` (the caller's policy, its own reason code) are the
 * caller's own. `FLAGGED_TIMEOUT` ({@link timeoutHold}): the sweep flagged it
 * for a refund (`UNBOUND_TIMEOUT`, shown "A estornar") at `flaggedAt` (ISO),
 * and nobody confirmed booking it anyway; it is booked only once a person
 * confirms that very flag. `ack`: the terminal may stop reporting the capture.
 */
export type TypedBookAnswer =
  | { outcome: 'BOOKED'; orderId: string; paymentId: string; created: boolean; ack: true }
  | { outcome: 'BOUND'; orderId: string; ack: true }
  | { outcome: 'FLAGGED'; ack: true }
  | { outcome: 'FLAGGED_TIMEOUT'; flaggedAt: string; ack: false }
  | { outcome: 'WAITING'; ack: false }
  | { outcome: 'NOT_ALLOWED'; reason: string; ack: false }
  | { outcome: 'REFUSED'; code: TypedBookRefusal; ack: false };

export interface TypedCaptureInput {
  clientId: string;
  /** The terminal that took the capture, as the station's link names it. Must be this tenant's. */
  deviceId: string;
  capture: StationCaptureWire;
}

/**
 * What the capture is free for.
 * - `FREE`: the caller may book it; `deviceId` is the seller, `capture` the recorded row.
 *   `timeoutFlaggedAt`: when the sweep flagged it `UNBOUND_TIMEOUT` (a bind clears that
 *   flag), null when it is not so flagged; see {@link timeoutHold}.
 * - `HELD`: a sale holds it (`paymentId` null while only marked created).
 * - `FLAGGED`: its money is owed back for good; acknowledged, never booked.
 * - `REFUSED`: see {@link TypedBookRefusal}.
 */
export type TypedClaim =
  | { claim: 'FREE'; clientId: string; deviceId: string; capture: TerminalCaptureRecord; timeoutFlaggedAt: Date | null }
  | { claim: 'HELD'; orderId: string; paymentId: string | null }
  | { claim: 'FLAGGED' }
  | { claim: 'REFUSED'; code: TypedBookRefusal };

export interface TypedCaptureClaimsConfig<TTx = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  /** The clock. Default: the system's. */
  now?: () => Date;
}

export interface TypedCaptureClaims<TTx = unknown> {
  /** Record the capture and say what it is free for. Writes the capture record only. */
  claimable(input: TypedCaptureInput): Promise<TypedClaim>;
  /**
   * Bind a `FREE` capture to the caller's new sale's payment row, on the
   * caller's transaction. Answers `BOOKED` (`created: true`). Its `ack: true`
   * holds only once that transaction COMMITS: acknowledge the terminal after
   * the commit, never inside the transaction. A lost race THROWS the ledger's
   * {@link CaptureError}, so the caller's transaction rolls its sale back; ask
   * {@link claimable} again, at most three times in all, then answer
   * `REFUSED` `CONTENDED` (`ack: false`) and let the terminal report it again.
   */
  bind(tx: TTx, claim: Extract<TypedClaim, { claim: 'FREE' }>, target: BindTarget): Promise<Extract<TypedBookAnswer, { outcome: 'BOOKED' }>>;
  /**
   * D9-R22 on the sale route: a person tapped a typed capture onto one of the
   * caller's sales ("Is it this sale?"). Before the caller's settle binds it to
   * that sale, ask this with the page's `confirmedFlaggedAt`. It records the
   * capture like {@link claimable}; a `FREE` capture flagged `UNBOUND_TIMEOUT`
   * whose flag the person has not confirmed answers `FLAGGED_TIMEOUT`, and the
   * caller binds nothing (the general bind would clear the flag, booking money
   * that may already be refunded) and hands the answer to the page
   * (`inbox.pickRefused`). Null otherwise: any other claim is left to the
   * caller's own binder, which refuses what it must.
   */
  pickHold(input: TypedCaptureInput, confirmedFlaggedAt: string | null): Promise<Extract<TypedBookAnswer, { outcome: 'FLAGGED_TIMEOUT' }> | null>;
}

const STOPS: ReadonlySet<string> = new Set<TypedBookRefusal>(['CONFLICT', 'DEVICE_MISMATCH', 'CONTENDED']);

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

/** A ledger refusal that stops a booking, as a claim; null for anything else (which is thrown). */
export function typedRefusalOf(error: unknown): Extract<TypedClaim, { claim: 'REFUSED' }> | null {
  if (!(error instanceof CaptureError) || !STOPS.has(error.code)) return null;
  return { claim: 'REFUSED', code: error.code as TypedBookRefusal };
}

/**
 * D9-R22: may this `FREE` capture be booked now? Null when it may: it is not
 * flagged `UNBOUND_TIMEOUT`, or a person confirmed booking it anyway and
 * `confirmedFlaggedAt` is that very flag's date (ISO, as the answer gave it).
 * Otherwise the `FLAGGED_TIMEOUT` answer (`ack: false`), and the caller writes
 * nothing: the money may already have been refunded on the terminal, so an
 * arrival or a retry never books it. Pure.
 */
export function timeoutHold(
  claim: Extract<TypedClaim, { claim: 'FREE' }>,
  confirmedFlaggedAt: string | null,
): Extract<TypedBookAnswer, { outcome: 'FLAGGED_TIMEOUT' }> | null {
  if (claim.timeoutFlaggedAt === null) return null;
  const flaggedAt = claim.timeoutFlaggedAt.toISOString();
  return confirmedFlaggedAt === flaggedAt ? null : { outcome: 'FLAGGED_TIMEOUT', flaggedAt, ack: false };
}

/**
 * The answer for a claim that is not `FREE`. `bookedFor` is the caller's own
 * key: the sale it booked for this capture's code, or null. Pure.
 */
export function heldAnswer(claim: Exclude<TypedClaim, { claim: 'FREE' }>, bookedFor: BindTarget | null): TypedBookAnswer {
  if (claim.claim === 'FLAGGED') return { outcome: 'FLAGGED', ack: true };
  if (claim.claim === 'REFUSED') return { outcome: 'REFUSED', code: claim.code, ack: false };
  if (bookedFor !== null && bookedFor.orderId === claim.orderId) return { outcome: 'BOOKED', ...bookedFor, created: false, ack: true };
  return { outcome: 'BOUND', orderId: claim.orderId, ack: true };
}

export function createTypedCaptureClaims<TTx = unknown>(config: TypedCaptureClaimsConfig<TTx>): TypedCaptureClaims<TTx> {
  const { ledger } = config;
  const clock = config.now ?? (() => new Date());

  async function decide(input: TypedCaptureInput): Promise<TypedClaim> {
    const { capture } = await ledger.record(recordInputOf(input, clock()));
    // The terminal's own report names the terminal; the page may only agree with it.
    if (capture.deviceId !== null && capture.deviceId !== input.deviceId) return { claim: 'REFUSED', code: 'DEVICE_MISMATCH' };
    if (capture.orderId !== null) return { claim: 'HELD', orderId: capture.orderId, paymentId: capture.paymentId };
    if (owedBackForGood(capture)) return { claim: 'FLAGGED' };
    const timeoutFlaggedAt = refundLive(capture) && capture.refundReason === 'UNBOUND_TIMEOUT' ? capture.refundFlaggedAt : null;
    return { claim: 'FREE', clientId: input.clientId, deviceId: capture.deviceId ?? input.deviceId, capture, timeoutFlaggedAt };
  }

  async function claimable(input: TypedCaptureInput): Promise<TypedClaim> {
    // No terminal named: the tenant check would be skipped, so nothing is recorded.
    if (input.deviceId.trim() === '') return { claim: 'REFUSED', code: 'DEVICE_MISMATCH' };
    try {
      return await decide(input);
    } catch (error) {
      const refused = typedRefusalOf(error);
      if (refused !== null) return refused;
      throw error;
    }
  }

  return {
    claimable,
    async pickHold(input, confirmedFlaggedAt) {
      const claim = await claimable(input);
      return claim.claim === 'FREE' ? timeoutHold(claim, confirmedFlaggedAt) : null;
    },
    async bind(tx, claim, target) {
      await ledger.bind(tx, claim.clientId, [claim.capture.transactionCode], target, clock());
      return { outcome: 'BOOKED', ...target, created: true, ack: true };
    },
  };
}
