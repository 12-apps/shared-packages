import { allocateExcess, judgeCapture, type CaptureShare, type CaptureVerdict } from './capture-judgement';
import { refundCaptureOnRequest, type CaptureRefundClaim, type CaptureRefundOutcome } from './refund-on-request';
import type { RefundRefusal } from './refund-retry';
import type { RefundRetrier } from './refund-series';
import type { MerchantRef } from './types';

/**
 * A SALE RECOMPOSED AFTER ITS PIX LANDED (FUT-1262). A Pix is raised at a frozen
 * total; a line of the sale can still be written off before the money arrives.
 * The confirmation settles exactly as it always did, and AFTER its commit (a
 * durable job of the host's) this runs once per settled sale:
 *
 *  1. It reads the settlement and the live total through the host's stores, and
 *     judges them ({@link judgeCapture}).
 *  2. `OVER` or `REFUND_ALL`: it asks the host to rewrite the sale's total from
 *     the frozen amount to the live one, PREDICATED on the frozen amount, so a
 *     retry finds it rewritten and a total somebody else moved is left alone.
 *  3. `OVER`: the excess is recorded, once per capture holding part of it (only
 *     the captures that fund the frozen total: {@link allocateExcess}), and the
 *     operator alerted for each record this run wrote. Never refunded here.
 *  4. `REFUND_ALL`: every capture still holding money goes back WHOLE through
 *     {@link refundCaptureOnRequest}: the host's one claim per provider charge
 *     (the same claim a short capture's refund takes, so the two lanes never
 *     both send) and the store refund's retrier. A refund that does not happen —
 *     refused, left pending, or impossible (the call throws: no stored charge, a
 *     provider that cannot refund) — falls back to recording that capture whole,
 *     and alerting.
 *
 * EXACTLY ONCE under a retried or duplicated job: the rewrite is predicated, a
 * record is keyed ({@link overCaptureKey}) and the host writes it at most once
 * per key, the alert follows only a record this run wrote, and a capture whose
 * fallback was recorded is never sent for a refund again.
 *
 * Every store throw but the refund's propagates, so the host's job keeps the
 * error and retries; the payment itself is never touched: it is already PAID.
 * The package reads and writes no host table: everything goes through the stores.
 */

/** Which sale to recompose, as the host's job row carries it. */
export interface CaptureRecomposeRef {
  merchant: MerchantRef;
  /** The host's id of what was paid for (the order). */
  reference: string;
  /** The total the charge was raised at, known when the payment settled, in cents. */
  frozenTotalCents: number;
}

/** One capture of the sale. */
export interface RecomposeCapture extends CaptureShare {
  /** The provider the capture came through: its refund goes back the same way. */
  provider: string;
}

/** The settled sale, as the host reads it. */
export interface RecomposeSettlement {
  /** The method the sale was settled with (`PIX`, `CARD`, …). */
  method: string;
  /** Whether the sale is settled; an unsettled one is never recomposed. */
  paid: boolean;
  /** The sale's total now, in cents. */
  totalCents: number;
  /** Every capture for the sale, in the order they were captured. */
  captures: RecomposeCapture[];
}

/** Why an over-capture was recorded. */
export type OverCaptureCause =
  /** Part of the sale was written off: the excess stays with the store until a person refunds it. */
  | 'PARTIAL_WRITE_OFF'
  /** All of it was written off and the whole-capture refund did not happen. */
  | 'REFUND_NOT_MADE';

/** Why a whole-capture refund did not happen: the provider's refusal, or `UNAVAILABLE` when it could not be sent. */
export type OverCaptureRefusal = RefundRefusal | 'UNAVAILABLE';

/** The facts of an over-capture the host records (and alerts on) as an over-payment. */
export interface OverCaptureFacts {
  /** The record's idempotency key: the host writes at most one record per key. */
  key: string;
  merchant: MerchantRef;
  reference: string;
  provider: string;
  providerChargeId: string;
  /** What this capture still holds (captured less refunded), in cents. */
  capturedCents: number;
  /** What of it is above the live total, in cents: the amount owed back. */
  excessCents: number;
  /** The sale's recomposed total, in cents. */
  liveTotalCents: number;
  /** The total the charge was raised at, in cents. */
  frozenTotalCents: number;
  cause: OverCaptureCause;
  /** For `REFUND_NOT_MADE`: why, and whether a background series still retries it. */
  refund: { refusal: OverCaptureRefusal; retrying: boolean; error: string | null } | null;
}

/** What one whole-capture refund came to. */
export interface CaptureRefundStep {
  providerChargeId: string;
  outcome: CaptureRefundOutcome | { kind: 'UNAVAILABLE'; error: unknown } | { kind: 'ALREADY_RECORDED' };
}

/** The host's side: its tables, its composition, its claim, its alert. */
export interface CaptureRecomposeStores {
  /** The settled sale, or null when the host has none for this reference. */
  readSettlement(ref: CaptureRecomposeRef): Promise<RecomposeSettlement | null>;
  /** What the sale's live lines are worth now, through the host's own composition, in cents. */
  composeLiveTotal(ref: CaptureRecomposeRef, settlement: RecomposeSettlement): Promise<number>;
  /**
   * Rewrite the sale's total (and whatever the host composes with it: fees,
   * tax) from `fromTotalCents` to `toTotalCents`, ONLY while it is still
   * `fromTotalCents`. Answers whether this call rewrote it.
   */
  rewriteTotal(input: { ref: CaptureRecomposeRef; fromTotalCents: number; toTotalCents: number }): Promise<boolean>;
  /** Write the over-capture record unless one with `facts.key` exists. Answers whether this call wrote it. */
  recordOverCapture(facts: OverCaptureFacts): Promise<boolean>;
  /** Whether a record with this key exists already. */
  isOverCaptureRecorded(key: string): Promise<boolean>;
  /** Tell the operator about a record this run wrote. A throw is logged, never retried: the record stays. */
  alert(facts: OverCaptureFacts): Promise<void> | void;
  /** The host's one claim on this capture's refund, keyed by its provider charge. */
  refundClaim(ref: CaptureRecomposeRef, capture: RecomposeCapture): CaptureRefundClaim;
  /** The store refund's retrier: attempt 1, and the series a "not yet" opens. */
  retrier: Pick<RefundRetrier, 'firstAttempt'> & Required<Pick<RefundRetrier, 'failedAnswer'>>;
  /** What a refund attempt came to, for the host's trail (an audit, a hint). Not called when the attempt threw. */
  refundAnswered(ref: CaptureRecomposeRef, capture: RecomposeCapture, outcome: CaptureRefundOutcome): Promise<void>;
}

export interface CaptureRecomposeLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface CaptureRecomposeOptions {
  stores: CaptureRecomposeStores;
  /** The host's cause, carried into the refund series' trail. */
  refundCause?: string;
  /** Carried to the provider with the refund, where it takes one. */
  refundReason?: string;
  /** The package binds no logger. */
  log?: CaptureRecomposeLogger;
}

/** What one run did. */
export interface CaptureRecomposeResult {
  /** Null when the sale was judged; otherwise why it was not, or why the rewrite stopped. */
  skipped: null | 'NO_SETTLEMENT' | 'NOT_PAID' | 'TOTAL_MOVED';
  verdict: CaptureVerdict;
  liveTotalCents: number | null;
  /** Whether THIS run rewrote the total. */
  rewritten: boolean;
  /** The records THIS run wrote. */
  recorded: OverCaptureFacts[];
  /** The whole-capture refunds this run looked at. */
  refunds: CaptureRefundStep[];
}

export interface CaptureRecompose {
  recompose(ref: CaptureRecomposeRef): Promise<CaptureRecomposeResult>;
}

/** The record key of one capture's over-capture on one sale. */
export function overCaptureKey(reference: string, providerChargeId: string): string {
  return `capture-recompose:${reference}:${providerChargeId}`;
}

const SILENT: CaptureRecomposeLogger = { warn: () => undefined, error: () => undefined };
const DEFAULT_REFUND_CAUSE = 'capture-recompose';

interface Run {
  options: CaptureRecomposeOptions;
  log: CaptureRecomposeLogger;
  ref: CaptureRecomposeRef;
  liveTotalCents: number;
}

export function createCaptureRecompose(options: CaptureRecomposeOptions): CaptureRecompose {
  return { recompose: (ref) => recompose(options, ref) };
}

function skippedResult(skipped: CaptureRecomposeResult['skipped'], verdict: CaptureVerdict, liveTotalCents: number | null): CaptureRecomposeResult {
  return { skipped, verdict, liveTotalCents, rewritten: false, recorded: [], refunds: [] };
}

async function recompose(options: CaptureRecomposeOptions, ref: CaptureRecomposeRef): Promise<CaptureRecomposeResult> {
  const { stores } = options;
  const settlement = await stores.readSettlement(ref);
  if (settlement === null) return skippedResult('NO_SETTLEMENT', { kind: 'NONE' }, null);
  if (!settlement.paid) return skippedResult('NOT_PAID', { kind: 'NONE' }, null);
  const liveTotalCents = await stores.composeLiveTotal(ref, settlement);
  const verdict = judgeCapture({
    method: settlement.method,
    capturedCents: sum(settlement.captures, (c) => c.capturedCents),
    refundedCents: sum(settlement.captures, (c) => Math.min(c.refundedCents, c.capturedCents)),
    liveTotalCents,
    frozenTotalCents: ref.frozenTotalCents,
  });
  if (verdict.kind === 'NONE') return skippedResult(null, verdict, liveTotalCents);
  const log = options.log ?? SILENT;
  const rewrite = await rewriteToLive(stores, ref, settlement.totalCents, liveTotalCents);
  if (rewrite === 'MOVED') {
    log.warn(
      `capture recompose ${ref.reference}: the total moved (${settlement.totalCents}, frozen ${ref.frozenTotalCents}, live ${liveTotalCents}): left alone, nothing recorded`,
    );
    return skippedResult('TOTAL_MOVED', verdict, liveTotalCents);
  }
  const run: Run = { options, log, ref, liveTotalCents };
  const result: CaptureRecomposeResult = { skipped: null, verdict, liveTotalCents, rewritten: rewrite === 'REWRITTEN', recorded: [], refunds: [] };
  if (verdict.kind === 'OVER') {
    for (const share of allocateExcess(settlement.captures, verdict.excessCents, ref.frozenTotalCents)) {
      await record(run, result, share.capture, share.excessCents, null);
    }
  } else {
    for (const capture of settlement.captures) await refundWhole(run, result, capture);
  }
  return result;
}

/** The predicated rewrite: done already, done now, or moved by somebody else (left alone). */
async function rewriteToLive(
  stores: CaptureRecomposeStores,
  ref: CaptureRecomposeRef,
  totalCents: number,
  liveTotalCents: number,
): Promise<'ALREADY' | 'REWRITTEN' | 'MOVED'> {
  if (totalCents === liveTotalCents) return 'ALREADY';
  if (totalCents !== ref.frozenTotalCents) return 'MOVED';
  const won = await stores.rewriteTotal({ ref, fromTotalCents: ref.frozenTotalCents, toTotalCents: liveTotalCents });
  return won ? 'REWRITTEN' : 'MOVED';
}

function heldBy(capture: RecomposeCapture): number {
  return Math.max(0, capture.capturedCents - capture.refundedCents);
}

/** Record one capture's over-capture; alert only when this call wrote it. */
async function record(
  run: Run,
  result: CaptureRecomposeResult,
  capture: RecomposeCapture,
  excessCents: number,
  refund: OverCaptureFacts['refund'],
): Promise<void> {
  const { ref } = run;
  const facts: OverCaptureFacts = {
    key: overCaptureKey(ref.reference, capture.providerChargeId),
    merchant: ref.merchant,
    reference: ref.reference,
    provider: capture.provider,
    providerChargeId: capture.providerChargeId,
    capturedCents: heldBy(capture),
    excessCents,
    liveTotalCents: run.liveTotalCents,
    frozenTotalCents: ref.frozenTotalCents,
    cause: refund === null ? 'PARTIAL_WRITE_OFF' : 'REFUND_NOT_MADE',
    refund,
  };
  if (!(await run.options.stores.recordOverCapture(facts))) return;
  result.recorded.push(facts);
  try {
    await run.options.stores.alert(facts);
  } catch (error) {
    run.log.error(`capture recompose ${ref.reference}: the over-capture alert for ${capture.providerChargeId} failed: ${messageOf(error)}`);
  }
}

/** Send one capture back whole, under its one claim; record it whole when that does not happen. */
async function refundWhole(run: Run, result: CaptureRecomposeResult, capture: RecomposeCapture): Promise<void> {
  const held = heldBy(capture);
  if (held === 0) return;
  const { stores } = run.options;
  const { ref } = run;
  if (await stores.isOverCaptureRecorded(overCaptureKey(ref.reference, capture.providerChargeId))) {
    result.refunds.push({ providerChargeId: capture.providerChargeId, outcome: { kind: 'ALREADY_RECORDED' } });
    return;
  }
  let outcome: CaptureRefundOutcome;
  try {
    outcome = await refundCaptureOnRequest(stores.retrier, stores.refundClaim(ref, capture), {
      merchant: ref.merchant,
      provider: capture.provider,
      providerChargeId: capture.providerChargeId,
      reference: ref.reference,
      boundTo: capture.providerChargeId,
      cause: run.options.refundCause ?? DEFAULT_REFUND_CAUSE,
      ...(run.options.refundReason ? { reason: run.options.refundReason } : {}),
    });
  } catch (error) {
    run.log.warn(`capture recompose ${ref.reference}: the refund of ${capture.providerChargeId} could not be sent: ${messageOf(error)}`);
    result.refunds.push({ providerChargeId: capture.providerChargeId, outcome: { kind: 'UNAVAILABLE', error } });
    await record(run, result, capture, held, { refusal: 'UNAVAILABLE', retrying: false, error: messageOf(error) });
    return;
  }
  result.refunds.push({ providerChargeId: capture.providerChargeId, outcome });
  await stores.refundAnswered(ref, capture, outcome);
  if (outcome.kind === 'PENDING') {
    await record(run, result, capture, held, { refusal: outcome.refusal, retrying: outcome.retrying, error: null });
  }
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
