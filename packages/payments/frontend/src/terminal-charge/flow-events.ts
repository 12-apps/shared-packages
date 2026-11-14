import { currentIndex, rebalanced, withLeg } from './charge-flow';
import { moved } from './flow-moves';
import type { ChargeFlow, FlowLeg, FlowMove, LegStatus } from './flow-types';
import { captureWireOf, type TerminalCaptureTrace, type TerminalEvent } from './port';

/**
 * What the terminal says, applied to a flow. An approval is matched to the leg
 * that pushed the charge, whichever charge of it that was; every other status
 * moves only the current leg, and only for its current charge.
 *
 * - The same approval twice (a resent status) is one approval.
 * - A second, distinct capture for a leg already approved, or one for a charge
 *   no leg pushed, is an `orphan`: never applied, so it reaches the host's
 *   list of money with no sale and its refund rule.
 * - An approval for a leg already received another way (cash at the
 *   counter, or a manual leg) is `received-twice`: the leg stays as it was
 *   received, and the operator chooses which payment goes back (FUT-4996 K2).
 *   It is never applied silently.
 * - A cancel in flight wins the screen; a later approval of that same charge,
 *   with nothing else received for the leg, is the leg's.
 */

type StatusEvent = Extract<TerminalEvent, { kind: 'status' }>;

/** A leg that may still take an approval of one of its charges: nothing else was received for it. */
const MAY_APPROVE: ReadonlySet<LegStatus> = new Set([
  'send',
  'pushing',
  'waiting',
  'processing',
  'cancelling',
  'declined',
  'cancelled',
  'unknown',
  'refused',
  'cash',
]);
/** A leg the operator already received another way: an approval for it is money taken twice. */
const RECEIVED_ANOTHER_WAY: ReadonlySet<LegStatus> = new Set(['local', 'manual']);

const BUSY_CANCELLING = (flow: ChargeFlow, index: number): boolean => flow.legs[index]?.status === 'cancelling';

/** What each status other than an approval does to the current leg. */
const ON_STATUS: Readonly<Record<Exclude<StatusEvent['state'], 'approved'>, (flow: ChargeFlow, index: number, event: StatusEvent) => ChargeFlow>> = {
  // The terminal's own retry after a decline runs again; a cancel in flight wins.
  processing: (flow, index) => (BUSY_CANCELLING(flow, index) ? flow : withLeg(flow, index, { status: 'processing' })),
  declined: (flow, index) => withLeg(flow, index, { status: 'declined' }),
  cancelled: (flow, index) => withLeg(flow, index, { status: 'cancelled' }),
  method_changed: (flow, index, event) => (BUSY_CANCELLING(flow, index) ? flow : changedTo(flow, index, event.method ?? 'CASH')),
};

/** The cashier moved the charge on the terminal: cash comes back to the counter; another method is the same charge. */
function changedTo(flow: ChargeFlow, index: number, method: string): ChargeFlow {
  if (method === 'CASH') return withLeg(flow, index, { status: 'cash' });
  return withLeg(flow, index, { status: 'waiting', tender: method });
}

/** The current leg, when its charge is `chargeId` and it may still take an approval. */
function currentOn(flow: ChargeFlow, chargeId: string): number | null {
  const index = currentIndex(flow);
  const leg = flow.legs[index];
  return leg !== undefined && leg.chargeId === chargeId && MAY_APPROVE.has(leg.status) ? index : null;
}

/** The leg that pushed `chargeId` — now, or before a resend or another tender — or -1. */
function ownerOf(flow: ChargeFlow, chargeId: string): number {
  return flow.legs.findIndex((leg) => leg.chargeId === chargeId || leg.history.includes(chargeId));
}

/** A newer charge of the same leg still out at the terminal: cancelled, since an older one paid. */
function newerOf(leg: FlowLeg, chargeId: string): string | undefined {
  const out = leg.status === 'waiting' || leg.status === 'processing' || leg.status === 'declined' || leg.status === 'cancelling';
  return leg.chargeId !== null && leg.chargeId !== chargeId && out ? leg.chargeId : undefined;
}

/** The leg as approved: the captured kind and the CAPTURED amount, the open legs re-balanced to the total. */
function approve(flow: ChargeFlow, index: number, chargeId: string, trace: TerminalCaptureTrace, deviceId: string): FlowMove {
  const capture = captureWireOf(trace, deviceId);
  const leg = flow.legs[index];
  const cancel = leg === undefined ? undefined : newerOf(leg, chargeId);
  const next = rebalanced(
    withLeg(flow, index, { status: 'approved', tender: trace.kind, amountCents: trace.amountCents, capture, deviceId, refusal: null }),
  );
  const notice = next.excessCents > 0 ? { kind: 'excess' as const, excessCents: next.excessCents } : null;
  return { flow: next, notice, ...(cancel === undefined ? {} : { cancel }) };
}

/**
 * An approval no leg may take as its own: the same capture again (nothing), a
 * leg received at the counter (`received-twice`), or money for no leg
 * (`orphan`). With no capture it is nothing to say.
 */
function notApplied(flow: ChargeFlow, index: number, leg: FlowLeg | undefined, deviceId: string, trace: TerminalCaptureTrace | undefined): FlowMove {
  if (trace === undefined) return moved(flow);
  const capture = captureWireOf(trace, deviceId);
  if (leg !== undefined && RECEIVED_ANOTHER_WAY.has(leg.status)) return { flow, notice: { kind: 'received-twice', index, capture } };
  if (leg?.capture?.transactionCode === trace.transactionCode) return moved(flow);
  return { flow, notice: { kind: 'orphan', capture } };
}

function onApproved(flow: ChargeFlow, chargeId: string, deviceId: string, trace: TerminalCaptureTrace | undefined): FlowMove {
  const index = ownerOf(flow, chargeId);
  const leg = flow.legs[index];
  if (leg === undefined || !MAY_APPROVE.has(leg.status)) return notApplied(flow, index, leg, deviceId, trace);
  if (trace === undefined) {
    return { flow: withLeg(flow, index, { status: 'unbound', chargeId }), notice: { kind: 'unbound', amountCents: leg.amountCents } };
  }
  return approve(flow, index, chargeId, trace, deviceId);
}

/** A released charge's end is unknown: the leg waiting on it says so. */
function onReleased(flow: ChargeFlow, chargeId: string): FlowMove {
  const index = currentOn(flow, chargeId);
  const leg = index === null ? undefined : flow.legs[index];
  const live = leg !== undefined && ['waiting', 'processing', 'cancelling', 'declined'].includes(leg.status);
  return moved(index !== null && live ? withLeg(flow, index, { status: 'unknown' }) : flow);
}

/** Moved to cash on a released charge: nothing was taken there. Ours: the leg follows it. */
function onReleasedToCash(flow: ChargeFlow, chargeId: string, method: string | undefined): FlowMove {
  const index = currentOn(flow, chargeId);
  const toCash = (method ?? 'CASH') === 'CASH';
  return moved(index !== null && toCash && flow.legs[index]?.status !== 'cash' ? changedTo(flow, index, 'CASH') : flow);
}

/** One station event applied to the flow. */
export function onEvent(flow: ChargeFlow, event: TerminalEvent): FlowMove {
  if (event.kind === 'charge-released') return onReleased(flow, event.chargeId);
  if (event.kind !== 'status' && event.kind !== 'orphan-capture') return moved(flow);
  if (event.state === 'approved') return onApproved(flow, event.chargeId, event.deviceId, event.capture);
  if (event.kind === 'orphan-capture') return onReleasedToCash(flow, event.chargeId, event.method);
  const index = currentOn(flow, event.chargeId);
  return moved(index === null ? flow : ON_STATUS[event.state](flow, index, event));
}
