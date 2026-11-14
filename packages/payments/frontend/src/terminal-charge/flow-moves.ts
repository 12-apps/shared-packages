import { advance, currentIndex, isLive, isStopped, withLeg } from './charge-flow';
import type { ChargeFlow, Elsewhere, FlowLeg, FlowMove } from './flow-types';
import { terminalMethodOf, type TerminalCancelAnswer, type TerminalChargeAnswer } from './port';

/**
 * The moves the operator and the station's answers make on a flow. Pure, and
 * none of them has a clock: a leg on the terminal waits until the terminal,
 * the station or the operator moves it (FUT-4996 A10: the way out is the exit,
 * never a timeout).
 */

/** The longest reference a leg charged elsewhere may carry. */
export const ELSEWHERE_REFERENCE_MAX = 64;

/** The charge a leg leaves behind stays the leg's: a late approval of it is still this sale's money. */
function historyOf(leg: FlowLeg): readonly string[] {
  return leg.chargeId === null ? leg.history : [...leg.history, leg.chargeId];
}

/** The push went out. */
export function pushing(flow: ChargeFlow, index: number): ChargeFlow {
  const leg = flow.legs[index];
  if (leg === undefined) return flow;
  return withLeg(flow, index, { status: 'pushing', chargeId: null, refusal: null, history: historyOf(leg) });
}

/** The station's answer to the push. */
export function pushed(flow: ChargeFlow, index: number, answer: TerminalChargeAnswer): ChargeFlow {
  if (flow.legs[index]?.status !== 'pushing') return flow;
  if (!answer.ok) return withLeg(flow, index, { status: 'refused', refusal: answer.code });
  return withLeg(flow, index, { status: 'waiting', chargeId: answer.chargeId, deviceId: answer.deviceId });
}

/** "Cancel on the terminal" was sent for a leg waiting there. */
export function cancelRequested(flow: ChargeFlow, index: number): ChargeFlow {
  const leg = flow.legs[index];
  if (leg === undefined || (leg.status !== 'waiting' && leg.status !== 'processing') || leg.chargeId === null) return flow;
  return withLeg(flow, index, { status: 'cancelling' });
}

/**
 * The station's answer to a cancel. `SENT`: the terminal's own answer follows.
 * `OUTCOME_UNKNOWN`: the terminal is away, so whether it was paid is unknown
 * and an approval may still arrive. `NO_CHARGE`: nothing was waiting.
 */
export function cancelAnswered(flow: ChargeFlow, chargeId: string, answer: TerminalCancelAnswer): ChargeFlow {
  const index = currentIndex(flow);
  const leg = flow.legs[index];
  if (leg === undefined || leg.chargeId !== chargeId || leg.status !== 'cancelling' || answer === 'SENT') return flow;
  return withLeg(flow, index, { status: answer === 'OUTCOME_UNKNOWN' ? 'unknown' : 'cancelled' });
}

/**
 * The current leg taken again with `tender`: a terminal method is pushed
 * afresh (any charge it leaves on the terminal is the run's to cancel first,
 * and stays the leg's), anything else is received at the counter.
 */
function takeWith(flow: ChargeFlow, index: number, leg: FlowLeg, tender: string): ChargeFlow {
  const method = terminalMethodOf(tender);
  const base = { chargeId: null, history: historyOf(leg), refusal: null, capture: null, elsewhere: null };
  if (method === null) return advance(withLeg(flow, index, { ...base, status: 'local', tender }));
  return withLeg(flow, index, { ...base, status: 'send', tender: method });
}

/** "Send again": the stopped leg goes out again, as it was — a fresh charge, never the old one approved. */
export function resend(flow: ChargeFlow): ChargeFlow {
  const index = currentIndex(flow);
  const leg = flow.legs[index];
  if (leg === undefined || !isStopped(leg)) return flow;
  return takeWith(flow, index, leg, leg.tender);
}

/**
 * "Another tender": the current leg — stopped, moved to cash on the terminal,
 * or refused by the server as disagreeing — taken with another of the store's
 * tenders. A disagreeing capture is never offered again.
 */
export function otherTender(flow: ChargeFlow, tender: string): ChargeFlow {
  const index = currentIndex(flow);
  const leg = flow.legs[index];
  if (leg === undefined || !(isStopped(leg) || leg.status === 'cash' || leg.status === 'conflict')) return flow;
  return takeWith(flow, index, leg, tender);
}

/** The leg moved to cash on the terminal was received at the counter. */
export function cashReceived(flow: ChargeFlow): ChargeFlow {
  const index = currentIndex(flow);
  if (flow.legs[index]?.status !== 'cash') return flow;
  return advance(withLeg(flow, index, { status: 'local', tender: 'CASH' }));
}

/**
 * "Charged on another machine" or "received by a manual Pix": the leg is
 * recorded with how it was charged, and the split moves on. A manual Pix is a
 * PIX leg; another machine keeps the leg's method. Any charge the leg left on
 * this terminal stays its own, so a late approval of it reads as received
 * twice, never as the leg's.
 */
export function chargedElsewhere(flow: ChargeFlow, index: number, elsewhere: Elsewhere): ChargeFlow {
  const leg = flow.legs[index];
  if (leg === undefined || leg.status === 'approved' || leg.status === 'local' || leg.status === 'elsewhere') return flow;
  const reference = elsewhere.reference?.trim();
  if (reference !== undefined && reference.length > ELSEWHERE_REFERENCE_MAX) {
    throw new RangeError(`A reference is at most ${ELSEWHERE_REFERENCE_MAX} characters.`);
  }
  const tender = elsewhere.via === 'MANUAL_PIX' ? 'PIX' : (terminalMethodOf(leg.tender) ?? leg.tender);
  const recorded: Elsewhere = reference ? { via: elsewhere.via, reference } : { via: elsewhere.via };
  return advance(
    withLeg(flow, index, { status: 'elsewhere', tender, elsewhere: recorded, chargeId: null, history: historyOf(leg), capture: null, refusal: null }),
  );
}

/** The charge a reload left on the terminal was cancelled (or ended): nothing is left to show. */
export function pendingCancelled(flow: ChargeFlow): ChargeFlow {
  return flow.pending === null ? flow : { ...flow, pending: null };
}

/** Refusals that say nothing about the body: the same body may be sent again. */
const TRANSIENT = new Set(['CAPTURE_CONTENDED', 'NETWORK', 'UNAVAILABLE']);

/**
 * The host's server refused the settle. A transient refusal keeps everything
 * and allows the same body again. `CAPTURE_CONFLICT` puts the legs whose
 * capture it names (all captured legs when it names none) in `conflict`:
 * money was taken, and the capture is never offered again.
 * `CAPTURES_EXCEED_TOTAL` is the excess decision. Anything else is a body the
 * server would refuse again: the operator decides, and it is never resent.
 */
export function serverRefused(
  flow: ChargeFlow,
  code: string | number,
  detail: { readonly transactionCode?: string; readonly excessCents?: number } = {},
): ChargeFlow {
  const reason = String(code);
  if (TRANSIENT.has(reason)) return { ...flow, retry: true };
  if (reason === 'CAPTURE_CONFLICT') return conflicted(flow, detail.transactionCode);
  if (reason === 'CAPTURES_EXCEED_TOTAL' && detail.excessCents !== undefined && detail.excessCents > 0) {
    return { ...flow, excessCents: detail.excessCents, retry: false };
  }
  return { ...flow, refusedAs: reason, retry: false };
}

function conflicted(flow: ChargeFlow, transactionCode: string | undefined): ChargeFlow {
  let next = flow;
  flow.legs.forEach((leg, index) => {
    if (leg.status !== 'approved' || leg.capture === null) return;
    if (transactionCode !== undefined && leg.capture.transactionCode !== transactionCode) return;
    next = withLeg(next, index, { status: 'conflict' });
  });
  return { ...next, retry: false };
}

/** The current leg is still on its way to the terminal or on it. */
export function currentIsLive(flow: ChargeFlow): boolean {
  const leg = flow.legs[currentIndex(flow)];
  return leg !== undefined && isLive(leg);
}

/** A notice-free move. */
export const moved = (flow: ChargeFlow): FlowMove => ({ flow, notice: null });
