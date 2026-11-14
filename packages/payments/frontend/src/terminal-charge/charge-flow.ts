import type { ChargedLeg, ChargedSplit, ChargeFlow, FlowLeg, LegExit, LegStatus, Readiness } from './flow-types';
import { terminalMethodOf, type ChargeLink } from './port';

/**
 * The charge flow's core: one split's legs and where each stands, pure.
 *
 * - Each card or Pix leg goes to the terminal ON ITS OWN, one after another
 *   ("part 1 of 2"); cash and any other tender are received at the counter.
 * - While the link state is unknown nothing is emitted: a card leg waits for
 *   the link. It never degrades to a plain leg (FUT-4996 K1).
 * - The terminal is the only source of payment truth (owner rules,
 *   2026-11-14): while it can be used, a card or Pix leg settles only with a
 *   capture the terminal reported, never on a code typed at the station.
 *   Only while it cannot be used (no link answer, no terminal connected, the
 *   station refusing the push as not connected, a charge released with its
 *   end unknown) may the operator record a MANUAL leg (State 6).
 * - A leg's amount is its capture's: an approval for another amount takes the
 *   captured one and the open legs are re-balanced to the total (K5). What the
 *   captures take above the total is the operator's decision, never absorbed.
 * - Money the terminal already took for this sale arrives as legs that carry
 *   their capture: approved from the start, never pushed again.
 *
 * The moves are in `./flow-moves` (the operator and the station's answers to a
 * push) and `./flow-events` (what the terminal says).
 */

/** Statuses on the way to the terminal, or on it. */
const LIVE: ReadonlySet<LegStatus> = new Set(['send', 'pushing', 'waiting', 'processing', 'cancelling']);
/** A leg the operator must answer: send it again, or take it another way. */
const STOPPED: ReadonlySet<LegStatus> = new Set(['declined', 'cancelled', 'unknown', 'refused']);
/** A leg whose money is accounted for. */
const DONE: ReadonlySet<LegStatus> = new Set(['local', 'approved', 'manual']);

const STOPPED_EXITS: readonly LegExit[] = ['resend', 'other-tender'];
const ON_TERMINAL_EXITS: readonly LegExit[] = ['cancel', 'other-tender'];
const MANUAL_EXITS: readonly LegExit[] = ['other-machine', 'manual-pix'];
/** The station's push refusals that say the terminal itself cannot be used. */
const TERMINAL_UNUSABLE: ReadonlySet<string> = new Set(['NOT_CONNECTED', 'NO_TERMINAL']);

export const isLive = (leg: FlowLeg): boolean => LIVE.has(leg.status);
export const isStopped = (leg: FlowLeg): boolean => STOPPED.has(leg.status);
export const isDone = (leg: FlowLeg): boolean => DONE.has(leg.status);

type BareLeg = Omit<FlowLeg, 'exits' | 'preselected' | 'charged'>;

/**
 * The terminal cannot be used: the link read failed, or terminals are linked
 * and none is connected. No answer yet (loading) is not down.
 */
export const linkDown = (link: ChargeLink): boolean => (link.known ? link.down === true : link.failed === true);

/** A push may go out: the link answered, a terminal is linked and connected. */
export const pushable = (link: ChargeLink): boolean => link.known && link.terminals > 0 && link.down !== true;

/**
 * Whether a manual leg may be recorded for this leg: a card or Pix leg not yet
 * accounted for, while the terminal cannot be used — by the link the flow
 * holds, or by the station's own answer for this leg. Never the operator's call.
 */
export function manualAllowed(leg: BareLeg, link: ChargeLink): boolean {
  if (terminalMethodOf(leg.tender) === null || DONE.has(leg.status) || leg.status === 'cash' || leg.status === 'unbound') return false;
  if (linkDown(link)) return true;
  return leg.status === 'unknown' || (leg.status === 'refused' && TERMINAL_UNUSABLE.has(leg.refusal ?? ''));
}

/**
 * The ways out of a leg that do not depend on the terminal being down. Every
 * leg not yet accounted for (but one approved with no capture) can be taken
 * with another tender, so cash is always reachable (invariant 7, R06).
 */
const OTHER_TENDER_ONLY: readonly LegExit[] = ['other-tender'];
const OWN_EXITS: Partial<Record<LegStatus, readonly LegExit[]>> = {
  declined: STOPPED_EXITS,
  cancelled: STOPPED_EXITS,
  unknown: STOPPED_EXITS,
  refused: STOPPED_EXITS,
  waiting: ON_TERMINAL_EXITS,
  processing: ON_TERMINAL_EXITS,
  conflict: OTHER_TENDER_ONLY,
  cash: OTHER_TENDER_ONLY,
  cancelling: OTHER_TENDER_ONLY,
  pushing: OTHER_TENDER_ONLY,
};

function ownExitsOf(status: LegStatus, canPush: boolean): readonly LegExit[] {
  // The push cannot go (no answer yet, or the terminal down): the leg may still be taken with another tender.
  if (!canPush && (status === 'send' || status === 'queued')) return OTHER_TENDER_ONLY;
  return OWN_EXITS[status] ?? [];
}

/** The ways out of a leg: its own, then the two manual ones while the terminal cannot be used. */
function exitsOf(leg: BareLeg, link: ChargeLink): readonly LegExit[] {
  const own = ownExitsOf(leg.status, pushable(link));
  return manualAllowed(leg, link) ? [...own, ...MANUAL_EXITS] : own;
}

/** A leg with its derived fields filled from where it stands. */
function settled(leg: BareLeg, link: ChargeLink): FlowLeg {
  return {
    ...leg,
    exits: exitsOf(leg, link),
    preselected: terminalMethodOf(leg.tender),
    charged: leg.status === 'approved' || leg.status === 'conflict',
  };
}

export function withLeg(flow: ChargeFlow, index: number, patch: Partial<FlowLeg>): ChargeFlow {
  return { ...flow, legs: flow.legs.map((leg, at) => (at === index ? settled({ ...leg, ...patch }, flow.link) : leg)) };
}

/** A terminal link with at least one terminal on it. */
const linked = (link: ChargeLink): boolean => !link.known || link.terminals > 0;

/** The leg the flow is on: the first one not yet accounted for, or -1. */
export function currentIndex(flow: ChargeFlow): number {
  return flow.legs.findIndex((leg) => !isDone(leg));
}

export function hasCapture(flow: ChargeFlow): boolean {
  return flow.legs.some((leg) => leg.status === 'approved');
}

const sum = (cents: readonly number[]): number => cents.reduce((total, value) => total + value, 0);
const doneCents = (legs: readonly FlowLeg[]): number => sum(legs.filter(isDone).map((leg) => leg.amountCents));

/** Not pushed yet: its amount may still move. */
const isOpen = (leg: FlowLeg): boolean => (leg.status === 'send' || leg.status === 'queued' || leg.status === 'refused') && leg.chargeId === null;

/**
 * The open legs re-balanced to what the done ones leave of the total, after a
 * capture landed: the last open leg takes the difference. At or under zero
 * left, the open legs drop, and what the done legs passed the total is the
 * excess. A shortfall no leg covers becomes a new leg of the same tender, so
 * the rest is charged too.
 */
export function rebalanced(flow: ChargeFlow): ChargeFlow {
  // Cash handed back as change was never kept: it does not count toward the total.
  const left = flow.totalCents - (doneCents(flow.legs) - flow.changeCents);
  if (left <= 0) return advance({ ...flow, legs: flow.legs.filter((leg) => !isOpen(leg)), excessCents: -left });
  const engaged = sum(flow.legs.filter((leg) => !isDone(leg) && !isOpen(leg)).map((leg) => leg.amountCents));
  const open = flow.legs.map((leg, index) => ({ leg, index })).filter(({ leg }) => isOpen(leg));
  const last = open[open.length - 1];
  if (last === undefined) {
    const model = flow.legs[flow.legs.length - 1];
    const legs = engaged < left ? [...flow.legs, newLeg(model?.tender ?? 'CREDIT', left - engaged, 'queued', flow.link)] : flow.legs;
    return advance({ ...flow, legs, excessCents: 0 });
  }
  const others = sum(open.slice(0, -1).map(({ leg }) => leg.amountCents));
  const amountCents = left - engaged - others;
  const next = amountCents > 0 ? withLeg(flow, last.index, { amountCents }) : { ...flow, legs: flow.legs.filter((_, at) => at !== last.index) };
  return advance({ ...next, excessCents: 0 });
}

/** The next queued leg goes out once the one before it is done. */
export function advance(flow: ChargeFlow): ChargeFlow {
  const next = currentIndex(flow);
  if (next < 0) return flow;
  return flow.legs[next]?.status === 'queued' ? withLeg(flow, next, { status: 'send' }) : flow;
}

function newLeg(tender: string, amountCents: number, status: LegStatus, link: ChargeLink): FlowLeg {
  return settled(
    { tender, amountCents, status, chargeId: null, history: [], deviceId: null, capture: null, elsewhere: null, refusal: null },
    link,
  );
}

/** The split with every amount written out: a leg with no amount is "the rest" of the bill. */
function amountsOf(split: ChargedSplit, totalCents: number): number[] {
  const fixed = sum(split.legs.map((leg) => leg.amountCents ?? 0));
  return split.legs.map((leg) => leg.amountCents ?? Math.max(0, totalCents - fixed));
}

/** A leg as the split carries it, before anything was pushed. */
function legOf(leg: ChargedLeg, amountCents: number, link: ChargeLink): FlowLeg {
  if (leg.elsewhere !== undefined) return { ...newLeg(leg.tender, amountCents, 'manual', link), elsewhere: leg.elsewhere };
  if (leg.capture !== undefined) {
    const base = newLeg(leg.capture.kind, leg.capture.amountCents, 'approved', link);
    return { ...base, capture: leg.capture, deviceId: leg.capture.deviceId ?? null };
  }
  const toTerminal = terminalMethodOf(leg.tender) !== null && amountCents > 0 && linked(link);
  return newLeg(leg.tender, amountCents, toTerminal ? 'queued' : 'local', link);
}

/**
 * The flow for one confirmed split. Legs that carry a capture are money the
 * terminal already took: approved from the start. When those already cover
 * the total, the other legs drop; when they pass it, the flow asks the
 * operator what to do with the excess.
 */
export function startFlow(split: ChargedSplit, totalCents: number, link: ChargeLink): ChargeFlow {
  const amounts = amountsOf(split, totalCents);
  const pending = link.known && link.pending ? { ...link.pending, cancellable: true } : null;
  const flow: ChargeFlow = {
    legs: split.legs.map((leg, index) => legOf(leg, amounts[index] ?? 0, link)),
    totalCents,
    changeCents: split.changeCents,
    link,
    excessCents: 0,
    refusedAs: null,
    retry: true,
    pending,
  };
  return hasCapture(flow) ? rebalanced(flow) : advance(flow);
}

/**
 * The link's answer arrived (or changed): with no terminal, the card legs not
 * yet pushed are received at the counter as before; with one, they go to it.
 */
export function withLink(flow: ChargeFlow, link: ChargeLink): ChargeFlow {
  const none = link.known && link.terminals === 0;
  const legs = flow.legs.map((leg) => {
    const unpushed = (leg.status === 'send' || leg.status === 'queued') && leg.chargeId === null;
    return settled(unpushed && none ? { ...leg, status: 'local' } : leg, link);
  });
  const pending = link.known && link.pending ? { ...link.pending, cancellable: true } : flow.pending;
  return advance({ ...flow, legs, link, pending });
}

export function readiness(flow: ChargeFlow): Readiness {
  if (flow.excessCents > 0 || flow.refusedAs !== null) return 'decide';
  if (currentIndex(flow) < 0) return 'ready';
  return flow.link.known ? 'charging' : 'waiting-link';
}

/** The leg as the server receives it, or a throw: a terminal leg with neither its capture nor a manual marker never leaves the flow. */
function chargedLeg(leg: FlowLeg, link: ChargeLink): ChargedLeg {
  if (leg.status === 'approved' && leg.capture !== null) return { tender: leg.tender, amountCents: leg.amountCents, capture: leg.capture };
  if (leg.status === 'manual' && leg.elsewhere !== null) return { tender: leg.tender, amountCents: leg.amountCents, elsewhere: leg.elsewhere };
  if (leg.status === 'local' && (terminalMethodOf(leg.tender) === null || !linked(link))) return { tender: leg.tender, amountCents: leg.amountCents };
  throw new Error(`A ${leg.tender} leg in status ${leg.status} carries no proof of payment.`);
}

/**
 * The split the host settles: every leg with its proof. Throws while any leg
 * is not accounted for. `partial` gives only the legs accounted for so far —
 * what a new split for an edited total starts from.
 */
export function chargedSplit(flow: ChargeFlow, options: { partial?: boolean } = {}): ChargedSplit {
  const legs = options.partial === true ? flow.legs.filter(isDone) : flow.legs;
  if (!options.partial && currentIndex(flow) >= 0) throw new Error('The split is not covered yet: no leg may be settled without its proof.');
  const charged = legs.map((leg) => chargedLeg(leg, flow.link));
  // Change is handed back from a cash leg only; with none left, none is said.
  return { legs: charged, changeCents: charged.some((leg) => leg.tender === 'CASH') ? flow.changeCents : 0 };
}

/** The terminal legs, numbered: this leg's part, and how many parts go to the terminal. */
export function partOf(flow: ChargeFlow, index: number): { part: number; parts: number } {
  const terminal = flow.legs.map((leg, at) => ({ leg, at })).filter(({ leg }) => leg.status !== 'local');
  return { part: terminal.findIndex(({ at }) => at === index) + 1, parts: terminal.length };
}

/** What the terminal legs after this one still charge. */
export function remainingAfter(flow: ChargeFlow, index: number): number {
  return sum(flow.legs.slice(index + 1).map((leg) => (leg.status === 'local' ? 0 : leg.amountCents)));
}

/** The words a confirm is built from: the host's copy, with amounts formatted by the host. */
export interface ConfirmWords {
  readonly receive: (money: string) => string;
  readonly receiveOnTerminal: (money: string) => string;
  readonly money: (cents: number) => string;
}

/** The confirm's label: the terminal one while a terminal leg is next, the plain one otherwise. */
export function confirmLabelOf(flow: ChargeFlow, words: ConfirmWords): string {
  const next = flow.legs[currentIndex(flow)];
  const onTerminal = next !== undefined && (next.status === 'send' || next.status === 'queued') && flow.link.known && linked(flow.link);
  const money = words.money(flow.totalCents);
  return onTerminal ? words.receiveOnTerminal(money) : words.receive(money);
}
