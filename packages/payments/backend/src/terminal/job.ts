import { PAYMENTS_SWEEP_QUEUE } from '../jobs/cadence';

import type { TerminalCaptureLedger } from './ledger';

/**
 * The capture refund sweep as a job blueprint: the same structural shape as
 * the package's other blueprints (`../jobs`), with its deps closed over, so a
 * host installs it with whichever runner it uses and adds its namespace.
 *
 * The POLICY is the package's: every ten minutes, at most
 * {@link UNBOUND_CAPTURE_SWEEP_BATCH} captures a tick, single-flight on the
 * sweep queue. The window — how long a capture may wait for its sale — is the
 * ledger's required `unboundRefundAfterMs`, never restated here. The tick only
 * bounds how late past that window a capture is flagged.
 */

/** Every ten minutes: the window is a day or so, so this is only how late past it a capture is flagged. */
export const UNBOUND_CAPTURE_SWEEP_CRON = '*/10 * * * *';

/** Captures flagged per tick: a backlog drains over a few ticks, never in one long lease. */
export const UNBOUND_CAPTURE_SWEEP_BATCH = 200;

export interface TerminalCaptureJobContext {
  logger: { info(message: string): void };
}

/** A blueprint with its deps closed over; structurally a `PaymentsJobBlueprint` minus the deps argument. */
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
  ledger: Pick<TerminalCaptureLedger, 'flagStaleUnbound'>;
  /** Overridable clock, for a suite that drives the window deterministically. */
  now?: () => Date;
}

export function terminalCaptureJobBlueprints(deps: TerminalCaptureJobDeps): { readonly flagUnboundCaptures: TerminalCaptureJob } {
  const clock = deps.now ?? (() => new Date());
  return {
    flagUnboundCaptures: {
      name: 'flag-unbound-captures',
      queue: PAYMENTS_SWEEP_QUEUE,
      concurrency: 1,
      schedule: { pattern: UNBOUND_CAPTURE_SWEEP_CRON, timezone: 'UTC' },
      // No `attempts`: a pass that threw is safe to retry (each flag is
      // written once, by its own predicate), so the retry policy is the
      // runner's, as it is for the host's other sweeps.
      // Short, so a crashed holder does not suppress the sweep for long.
      lease: { ttlMs: 2 * 60_000 },
      handle: async (_payload, context) => {
        const flagged = await deps.ledger.flagStaleUnbound(clock(), UNBOUND_CAPTURE_SWEEP_BATCH);
        if (flagged === 0) return;
        context?.logger.info(`[payments] flag-unbound-captures: flagged ${flagged} unbound terminal capture(s) for a refund.`);
      },
    },
  };
}
