import { SWEEP_QUEUE } from './cadence';

import type { TerminalCaptureLedger } from './ledger';

/**
 * The capture refund sweep as a job blueprint: the same structural shape as
 * a job runner's other blueprints, with its deps closed over, so a
 * host installs it with whichever runner it uses and adds its namespace.
 *
 * The POLICY is the package's: every ten minutes, at most
 * {@link UNBOUND_CAPTURE_SWEEP_BATCH} unbound captures a tick, and as many held
 * by a sale that stayed unpaid through the window, single-flight on the
 * sweep queue. The window — how long a capture may wait for its sale — is the
 * ledger's required `unboundRefundAfterMs`, never restated here. The tick only
 * bounds how late past that window a capture is flagged.
 */

/** Every ten minutes: the window is a day or so, so this is only how late past it a capture is flagged. */
export const UNBOUND_CAPTURE_SWEEP_CRON = '*/10 * * * *';

/** Captures flagged per tick: a backlog drains over a few ticks, never in one long lease. */
export const UNBOUND_CAPTURE_SWEEP_BATCH = 200;

export interface TerminalCaptureJobContext {
  /** `warn` when the runner has one; the warnings go to `info` otherwise. */
  logger: { info(message: string): void; warn?(message: string): void };
}

/** Said once a tick while the held half cannot run, so a host that has not wired it does not look fixed. */
export const HELD_SWEEP_OFF_WARNING =
  '[card-terminal] flag-unbound-captures: the held half is off (no SaleDirectory.staleUnpaidSales or store findStaleHeld): ' +
  "a capture whose sale was abandoned unpaid is never flagged for a refund.";

/** A blueprint with its deps closed over; the shape a job runner installs (name, queue, schedule, lease, handler). */
export interface TerminalCaptureJob {
  name: string;
  queue: string;
  concurrency: number;
  schedule: { pattern: string; timezone: string };
  attempts?: number;
  lease: { ttlMs: number };
  handle(payload: unknown, context?: TerminalCaptureJobContext): Promise<void>;
}

export interface TerminalCaptureJobDeps {
  /**
   * The ledger the sweep flags through. `flagStaleHeld` is optional for a deps
   * object written before it: without it the tick flags only UNBOUND captures.
   */
  ledger: Pick<TerminalCaptureLedger, 'flagStaleUnbound'> & Partial<Pick<TerminalCaptureLedger, 'flagStaleHeld' | 'heldSweepReady'>>;
  /** Overridable clock, for a suite that drives the window deterministically. */
  now?: () => Date;
}

/** What a tick says: how many it flagged of each half, and the warning while the held half is off. */
function report(context: TerminalCaptureJobContext | undefined, unbound: number, held: number, heldOff: boolean): void {
  const logger = context?.logger;
  if (!logger) return;
  if (unbound > 0) logger.info(`[card-terminal] flag-unbound-captures: flagged ${unbound} unbound terminal capture(s) for a refund.`);
  if (held > 0) logger.info(`[card-terminal] flag-unbound-captures: flagged ${held} terminal capture(s) of an unpaid sale for a refund.`);
  if (heldOff) (logger.warn ?? logger.info).call(logger, HELD_SWEEP_OFF_WARNING);
}

/** One tick: the unbound half, then the held half (a capture whose sale was abandoned unpaid, acked to the terminal). */
async function sweepTick(deps: TerminalCaptureJobDeps, now: Date, context?: TerminalCaptureJobContext): Promise<void> {
  const { ledger } = deps;
  const unbound = await ledger.flagStaleUnbound(now, UNBOUND_CAPTURE_SWEEP_BATCH);
  const held = ledger.flagStaleHeld ? await ledger.flagStaleHeld(now, UNBOUND_CAPTURE_SWEEP_BATCH) : 0;
  report(context, unbound, held, !ledger.flagStaleHeld || ledger.heldSweepReady === false);
}

export function terminalCaptureJobBlueprints(deps: TerminalCaptureJobDeps): { readonly flagUnboundCaptures: TerminalCaptureJob } {
  const clock = deps.now ?? (() => new Date());
  return {
    flagUnboundCaptures: {
      name: 'flag-unbound-captures',
      queue: SWEEP_QUEUE,
      concurrency: 1,
      schedule: { pattern: UNBOUND_CAPTURE_SWEEP_CRON, timezone: 'UTC' },
      // No `attempts`: a pass that threw is safe to retry (each flag is
      // written once, by its own predicate), so the retry policy is the
      // runner's, as it is for the host's other sweeps.
      // Short, so a crashed holder does not suppress the sweep for long.
      lease: { ttlMs: 2 * 60_000 },
      handle: async (_payload, context) => sweepTick(deps, clock(), context),
    },
  };
}
