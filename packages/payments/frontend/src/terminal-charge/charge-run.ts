import { chargedSplit, currentIndex, linkDown, linked, partOf, readiness, remainingAfter, startFlow, withLink } from './charge-flow';
import { holdCharge, noteTaken, releaseCharges } from './charge-claims';
import { onEvent } from './flow-events';
import { cancelAnswered, cancelRequested, cashReceived, chargedElsewhere, otherTender, pendingCancelled, pushed, pushing, resend, serverRefused } from './flow-moves';
import type { ChargedSplit, ChargeFlow, Elsewhere, FlowLeg, FlowNotice } from './flow-types';
import {
  terminalMethodOf,
  type ChargeLink,
  type TerminalCancelAnswer,
  type TerminalChargeAnswer,
  type TerminalChargeRequest,
  type TerminalEvent,
  type TerminalMethod,
  type TerminalPort,
} from './port';

/**
 * One split's run against the paired terminal: the pure flow driven by the
 * host's port. It pushes the leg the flow asks for, feeds every station event
 * and cancel answer back into it, and calls `onReady` ONCE when every leg is
 * accounted for — the host settles the split then.
 *
 * Kept outside React (a store a screen subscribes to), so a re-render can
 * never push a charge twice, and every path is a unit test over a fake port.
 * It has no timer: a leg on the terminal waits until something moves it.
 */

export interface ChargeRunInput {
  readonly port: TerminalPort;
  readonly split: ChargedSplit;
  readonly totalCents: number;
  readonly link: ChargeLink;
  /** What the terminal shows the sale as. */
  readonly saleRef: string;
  /** Who charges, as the terminal shows it. */
  readonly operator: string;
  /** The terminal picked when more than one is linked; absent with one. */
  readonly deviceId?: string;
  readonly onReady: (split: ChargedSplit) => void;
  readonly onNotice: (notice: FlowNotice) => void;
}

export interface ChargeRun {
  current(): ChargeFlow;
  subscribe(listener: () => void): () => void;
  resend(): void;
  other(tender: string): void;
  cashReceived(): void;
  /** State 6, only while the terminal cannot be used: record the leg as a manual one. Throws otherwise. */
  elsewhere(index: number, elsewhere: Elsewhere, method?: TerminalMethod): void;
  /** Cancel the live leg's charge on the terminal. */
  cancel(): void;
  /** Cancel the charge a reload left on the terminal. */
  cancelPending(): void;
  /** The station's link changed (its first answer, a failed read, a re-pair). */
  linkChanged(link: ChargeLink): void;
  /** The host's server refused the settle with this code. */
  refused(code: string | number, detail?: { transactionCode?: string; excessCents?: number }): void;
  /**
   * Leave the run (the screen closed): a live charge is cancelled on the
   * terminal, and its later events are no longer heard here — an approval
   * that beats that cancel is the host's link indicator's to say.
   */
  dispose(): void;
}

/** Events that name a charge: only this run's own are its to decide. */
const chargeOf = (event: TerminalEvent): string | null =>
  event.kind === 'status' || event.kind === 'orphan-capture' || event.kind === 'charge-released' ? event.chargeId : null;

/** A leg whose charge is still out at the terminal (a declined one may still be retried there). */
const outThere = (leg: FlowLeg | undefined): string | null =>
  leg !== undefined && leg.chargeId !== null && ['waiting', 'processing', 'cancelling', 'declined'].includes(leg.status) ? leg.chargeId : null;

class Run implements ChargeRun {
  private flow: ChargeFlow;
  private ready = false;
  private disposed = false;
  /** Every charge this run pushed: only their events are this run's to decide. */
  private readonly mine = new Set<string>();
  /** The charge a pending (reload) left, cancelled before the first push. */
  private readonly pendingId: string | null;
  /** Events for a charge not known yet: held while a push is out, replayed once the push answers with it. */
  private early: TerminalEvent[] = [];
  private pushes = 0;
  /** A charge to cancel before the next push goes out (the leg's earlier charge, still pending there). */
  private cancelFirst: Promise<unknown> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly stop: () => void;

  constructor(private readonly input: ChargeRunInput) {
    this.flow = startFlow(input.split, input.totalCents, input.link);
    this.pendingId = this.flow.pending?.chargeId ?? null;
    this.stop = input.port.onEvent((event) => this.heard(event));
    queueMicrotask(() => this.move(this.flow));
  }

  current(): ChargeFlow {
    return this.flow;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  resend(): void {
    this.decide(resend);
  }

  other(tender: string): void {
    this.decide((current) => otherTender(current, tender));
  }

  cashReceived(): void {
    this.move(cashReceived(this.flow));
  }

  elsewhere(index: number, elsewhere: Elsewhere, method?: TerminalMethod): void {
    const left = outThere(this.flow.legs[index]);
    this.move(chargedElsewhere(this.flow, index, elsewhere, method));
    if (left !== null) this.quietCancel(left);
  }

  cancel(): void {
    const index = currentIndex(this.flow);
    const chargeId = this.flow.legs[index]?.chargeId ?? null;
    const next = cancelRequested(this.flow, index);
    if (next === this.flow || chargeId === null) return;
    this.move(next);
    void this.input.port
      .cancel(chargeId)
      .catch((): TerminalCancelAnswer => 'OUTCOME_UNKNOWN')
      .then((answer) => this.move(cancelAnswered(this.flow, chargeId, answer)));
  }

  cancelPending(): void {
    if (this.pendingId === null || this.flow.pending === null) return;
    releaseCharges(this.input.port, [this.pendingId]);
    this.quietCancel(this.pendingId);
    this.move(pendingCancelled(this.flow));
  }

  linkChanged(link: ChargeLink): void {
    this.move(withLink(this.flow, link));
  }

  refused(code: string | number, detail?: { transactionCode?: string; excessCents?: number }): void {
    this.ready = false;
    this.move(serverRefused(this.flow, code, detail));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    const live = outThere(this.flow.legs[currentIndex(this.flow)]);
    // Every charge it pushed is the indicator's to watch now: a late approval of any of them is money for no sale.
    releaseCharges(this.input.port, this.mine);
    if (live !== null) this.quietCancel(live);
  }

  private quietCancel(chargeId: string): void {
    void this.input.port.cancel(chargeId).catch(() => undefined);
  }

  private tell(): void {
    [...this.listeners].forEach((listener) => listener());
  }

  private heard(event: TerminalEvent): void {
    if (this.disposed) return;
    const chargeId = chargeOf(event);
    if (chargeId !== null && !this.mine.has(chargeId) && chargeId !== this.pendingId) {
      // A status may beat the push's own answer; while one is out, keep it. Otherwise it is not this run's.
      if (this.pushes > 0) this.early.push(event);
      return;
    }
    const answer = onEvent(this.flow, event);
    if (answer.flow !== this.flow || answer.notice !== null) this.move(answer.flow, answer.notice);
    // An earlier charge of a leg paid: the newer one still at the terminal is cancelled.
    if (answer.cancel !== undefined) this.quietCancel(answer.cancel);
  }

  private move(next: ChargeFlow, notice: FlowNotice | null = null): void {
    if (this.disposed) return;
    this.flow = next;
    // What this sale took is never a stray when the terminal says it again.
    noteTaken(this.input.port, next.legs.flatMap((leg) => (leg.capture === null ? [] : [leg.capture.transactionCode])));
    if (notice !== null) this.input.onNotice(notice);
    this.pushIfAsked();
    this.tell();
    this.settleIfReady();
  }

  private settleIfReady(): void {
    if (this.ready || readiness(this.flow) !== 'ready') return;
    this.ready = true;
    this.input.onReady(chargedSplit(this.flow));
  }

  /** Push the leg the flow asks for, if it asks: one push at a time, never before the link is known. */
  private pushIfAsked(): void {
    const index = currentIndex(this.flow);
    const leg = this.flow.legs[index];
    const method = leg === undefined ? null : terminalMethodOf(leg.tender);
    if (leg?.status !== 'send' || method === null || linkDown(this.flow.link) || !linked(this.flow.link)) return;
    const { part, parts } = partOf(this.flow, index);
    this.flow = pushing(this.flow, index);
    const { deviceId, saleRef, operator } = this.input;
    const request: TerminalChargeRequest = {
      ...(deviceId === undefined ? {} : { deviceId }),
      saleRef,
      operator,
      amountCents: leg.amountCents,
      method,
      ...(parts > 1 ? { part, parts, remainingCents: remainingAfter(this.flow, index) } : {}),
    };
    this.pushes += 1;
    const before = this.cancelFirst ?? Promise.resolve();
    this.cancelFirst = null;
    void before
      .then(() => this.input.port.charge(request))
      .catch((): TerminalChargeAnswer => ({ ok: false, code: 'NOT_CONNECTED' }))
      .then((answer) => this.pushAnswered(index, answer));
  }

  private pushAnswered(index: number, answer: TerminalChargeAnswer): void {
    this.pushes -= 1;
    const early = this.early;
    if (this.pushes === 0) this.early = [];
    if (answer.ok) {
      this.mine.add(answer.chargeId);
      holdCharge(this.input.port, answer.chargeId);
    }
    if (this.disposed) {
      // Pushed after the screen let go: nobody waits for it, so it is cancelled at once.
      if (answer.ok) {
        releaseCharges(this.input.port, [answer.chargeId]);
        this.quietCancel(answer.chargeId);
      }
      return;
    }
    this.flow = pushed(this.flow, index, answer);
    this.tell();
    if (answer.ok) early.filter((event) => chargeOf(event) === answer.chargeId).forEach((event) => this.heard(event));
  }

  /**
   * The operator's answer to a stopped leg. A declined charge is still pending
   * at the terminal: it is cancelled before the leg goes out again, and stays
   * the leg's, so a late approval of it is still seen.
   */
  private decide(step: (current: ChargeFlow) => ChargeFlow): void {
    const next = step(this.flow);
    if (next === this.flow) return;
    const left = outThere(this.flow.legs[currentIndex(this.flow)]);
    if (left !== null) this.cancelFirst = this.input.port.cancel(left).catch(() => undefined);
    this.move(next);
  }
}

/** The run for a confirmed split. A split with nothing for the terminal is ready at once. */
export function startChargeRun(input: ChargeRunInput): ChargeRun {
  return new Run(input);
}
