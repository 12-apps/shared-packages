import type { CaptureWire, ChargeLink, TerminalChargeAnswer, TerminalPendingCharge } from './port';

/**
 * The vocabulary of one split charged through the paired terminal. The moves
 * are pure functions over these shapes (`./charge-flow`, `./flow-moves`,
 * `./flow-events`), so every path is a unit test with no React and no port.
 */

/** Where one leg of the split stands. */
export type LegStatus =
  /** Received at the counter, not on the terminal (cash, a voucher, or a card with no terminal linked). */
  | 'local'
  /** Waits for the legs before it. */
  | 'queued'
  /** To be pushed now. */
  | 'send'
  /** Pushed; the station has not answered the push yet. */
  | 'pushing'
  /** On the terminal, waiting for the card or the Pix. */
  | 'waiting'
  | 'processing'
  /** A cancel was sent; the terminal's answer follows. */
  | 'cancelling'
  | 'declined'
  | 'cancelled'
  /** Released by the station without an end: paid or not is unknown. */
  | 'unknown'
  /** The station refused the push (`NOT_CONNECTED`, `BUSY`…). */
  | 'refused'
  /** Moved to cash on the terminal: the operator receives it at the counter. */
  | 'cash'
  /** Approved with no capture: money moved, nothing to bind. Never sent again. */
  | 'unbound'
  /** The server refused its capture as disagreeing with the one it holds: charged, and never offered again. */
  | 'conflict'
  | 'approved';

/**
 * A way out of the current leg the operator may take:
 * - `resend`: push it again;
 * - `other-tender`: take it with another of the store's tenders;
 * - `cancel`: cancel the charge on the terminal.
 *
 * The terminal is the only source of payment truth (owner rule, 2026-11-14):
 * no way out records a card or Pix payment the terminal did not report.
 */
export type LegExit = 'resend' | 'other-tender' | 'cancel';

export interface FlowLeg {
  /** The registry tender this leg settles as — the captured kind once approved. */
  readonly tender: string;
  readonly amountCents: number;
  readonly status: LegStatus;
  /** The charge on the terminal now, or the last one this leg pushed. */
  readonly chargeId: string | null;
  /** Every charge this leg pushed before `chargeId`: an approval for one is still this leg's. */
  readonly history: readonly string[];
  readonly deviceId: string | null;
  readonly capture: CaptureWire | null;
  /** Why the push was refused. */
  readonly refusal: Extract<TerminalChargeAnswer, { ok: false }>['code'] | null;
  /** The ways out the operator may take from where the leg stands. */
  readonly exits: readonly LegExit[];
  /** The method a way out starts from (the leg's own terminal method), or null for a non-terminal leg. */
  readonly preselected: string | null;
  /** Money was taken on the terminal for this leg. */
  readonly charged: boolean;
}

/** A charge the station still held on the terminal when the flow started (a reload). */
export interface FlowPending extends TerminalPendingCharge {
  readonly cancellable: boolean;
}

export interface ChargeFlow {
  readonly legs: readonly FlowLeg[];
  readonly totalCents: number;
  readonly changeCents: number;
  readonly link: ChargeLink;
  /** What the captured legs took above the total; above zero, the operator decides (change, credit, refund). */
  readonly excessCents: number;
  /** The server refused the body as malformed: the operator decides; it is never resent as is. */
  readonly refusedAs: string | null;
  /** Whether the same body may be sent again: false after a refusal that would refuse it again. */
  readonly retry: boolean;
  readonly pending: FlowPending | null;
}

/** A leg as the host's server receives it: a terminal leg carries the capture the terminal reported. */
export interface ChargedLeg {
  readonly tender: string;
  readonly amountCents?: number;
  readonly capture?: CaptureWire;
}

/** The split the host settles, with each terminal leg's proof. */
export interface ChargedSplit {
  readonly legs: readonly ChargedLeg[];
  readonly changeCents: number;
}

/**
 * Where the flow stands as a whole:
 * - `waiting-link`: the link state is not known; nothing is emitted until it is;
 * - `charging`: a leg is on the terminal or waits for the operator;
 * - `decide`: the operator must decide (an excess, or a body the server refused);
 * - `ready`: every leg is proven; the split may be settled.
 */
export type Readiness = 'ready' | 'waiting-link' | 'charging' | 'decide';

/** What a terminal answer means to the screen, beside the new flow. */
export type FlowNotice =
  /** The terminal approved a leg already received in cash: the buyer paid twice; the operator chooses which goes back. */
  | { readonly kind: 'received-twice'; readonly index: number; readonly capture: CaptureWire }
  /** A capture no leg of this flow takes: money for no sale, kept for recovery. Never applied. */
  | { readonly kind: 'orphan'; readonly capture: CaptureWire }
  /** The captured legs passed the total. */
  | { readonly kind: 'excess'; readonly excessCents: number }
  /** The server refused a capture as disagreeing with the one it holds. */
  | { readonly kind: 'conflict'; readonly index: number }
  /** Approved with no capture to bind: money moved for this sale, and it cannot be recorded with it. */
  | { readonly kind: 'unbound'; readonly amountCents: number };

/** A flow move: the new flow, what to say, and a charge the run must cancel on the terminal. */
export interface FlowMove {
  readonly flow: ChargeFlow;
  readonly notice: FlowNotice | null;
  readonly cancel?: string;
}
