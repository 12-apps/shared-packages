import type { ChargedSplit, ChargeFlow, Elsewhere } from './flow-types';
import type { HeldCaptures } from './held-captures';
import type { CaptureWire } from './port';

/**
 * A charge run with no server behind it (FUT-4997). The run itself reads
 * nothing from a server: it pushes over the station's port, and the host
 * settles the split wherever it can — its server, or the station's own
 * journal while the server is out of reach. Two things differ offline:
 *
 * - **The hand-off.** The money an online try already took for the sale stays
 *   the sale's: {@link holdTaken} holds each captured leg under the sale's key,
 *   and the offline run starts from `withHeld(split, heldFor(key))`, so those
 *   legs are approved from the start and never pushed again.
 * - **What the journal is told.** The station puts on each leg the trace it
 *   heard from the terminal; the page only names the capture
 *   ({@link legsByCode}). The page is never the trace's source.
 *
 * The journal's refusals (an unheard code, one another sale holds, one the
 * terminal charged otherwise) reach the run as `refused(code)`: they stop the
 * flow (`refusedAs`) and are never settled again by themselves.
 */

/** The captures the run's legs took, in leg order. */
export function takenCaptures(flow: ChargeFlow): CaptureWire[] {
  return flow.legs.flatMap((leg) => (leg.status === 'approved' && leg.capture !== null ? [leg.capture] : []));
}

/** Hold under `key` every capture the run took that the sale does not hold yet. Answers what the sale holds now. */
export function holdTaken(held: HeldCaptures, key: string, flow: ChargeFlow): CaptureWire[] {
  const holding = new Set(held.heldFor(key).map((capture) => capture.transactionCode));
  takenCaptures(flow)
    .filter((capture) => !holding.has(capture.transactionCode))
    .forEach((capture) => held.hold(key, capture));
  return held.heldFor(key);
}

/** A leg as a station's journal reads it: a terminal leg names its capture, never carries its trace. */
export interface CodedLeg {
  readonly tender: string;
  readonly amountCents?: number;
  readonly transactionCode?: string;
  readonly elsewhere?: Elsewhere;
}

/** The settled split, each terminal leg named by its capture's code alone. */
export function legsByCode(split: ChargedSplit): CodedLeg[] {
  return split.legs.map((leg) => ({
    tender: leg.tender,
    ...(leg.amountCents === undefined ? {} : { amountCents: leg.amountCents }),
    ...(leg.capture === undefined ? {} : { transactionCode: leg.capture.transactionCode }),
    ...(leg.elsewhere === undefined ? {} : { elsewhere: leg.elsewhere }),
  }));
}
