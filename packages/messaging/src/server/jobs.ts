import type { JobsContribution, WireJobBlueprint } from "@12-apps/wiring";

import type { MessagingEngine } from "../core/engine";
import { errorText } from "../core/errors";

/**
 * The connector's three jobs, declared here because every number in them is
 * the connector's knowledge, not a host's:
 *
 * - `process-delivery`, on demand: one stored delivery, parsed and applied.
 *   Five attempts with backoff; every handler is idempotent, so a retry
 *   redoes nothing already done.
 * - `reconcile-inbox`, every five minutes: re-runs deliveries a dead worker or
 *   a refused enqueue left behind, up to the engine's attempt bound.
 * - `retention`, every ten minutes: deletes the text of conversations whose
 *   last message is past the retention window, through ONE indexed query
 *   across every tenant. Ten minutes against a twelve-hour window keeps text
 *   at most a few minutes past its deadline.
 *
 * Bound with `{ engine }`, these arrive at a runner as
 * `messaging.process-delivery`, `messaging.reconcile-inbox` and
 * `messaging.retention`. A host with no worker declines `jobs` in writing —
 * and then nothing is processed, so it should not adopt the connector.
 */

export interface MessagingJobDeps {
  engine: Pick<MessagingEngine, "processDelivery" | "reconcile" | "sweepRetention">;
}

export interface ProcessDeliveryPayload {
  deliveryId: string;
}

/** The single-flight queue name (`@12-apps/jobs`' `SWEEP_QUEUE`), as a literal. */
export const MESSAGING_SWEEP_QUEUE = "sweeps";

const SWEEP_LEASE_MS = 5 * 60_000;

export const MESSAGING_PROCESS_ATTEMPTS = 5;

const processDelivery: WireJobBlueprint<ProcessDeliveryPayload, MessagingJobDeps> = {
  name: "process-delivery",
  attempts: MESSAGING_PROCESS_ATTEMPTS,
  // Short: a contact is waiting for the reply this processing leads to.
  backoff: { type: "exponential", delayMs: 2_000 },
  handle: async (payload, deps, context) => {
    try {
      const outcome = await deps.engine.processDelivery(payload.deliveryId);
      if (outcome.kind === "unreadable") {
        context.logger.warn(`messaging.process-delivery: ${payload.deliveryId} unreadable: ${outcome.reason}`);
      }
    } catch (error) {
      context.logger.warn(`messaging.process-delivery: ${payload.deliveryId} failed: ${errorText(error)}`);
      throw error;
    }
  },
};

const reconcileInbox: WireJobBlueprint<void, MessagingJobDeps> = {
  name: "reconcile-inbox",
  queue: MESSAGING_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "*/5 * * * *", timezone: "UTC" },
  // Never retried by the queue: the next tick re-finds everything from the rows.
  attempts: 1,
  lease: { ttlMs: SWEEP_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const result = await deps.engine.reconcile();
    if (result.retried === 0) return;
    context.logger.info(`messaging.reconcile-inbox: re-ran ${result.retried} delivery(ies), ${result.failed} failed again.`);
  },
};

const retention: WireJobBlueprint<void, MessagingJobDeps> = {
  name: "retention",
  queue: MESSAGING_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "*/10 * * * *", timezone: "UTC" },
  attempts: 1,
  lease: { ttlMs: SWEEP_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const result = await deps.engine.sweepRetention();
    if (result.conversations === 0) return;
    context.logger.info(
      `messaging.retention: deleted the text of ${result.messages} message(s) in ${result.conversations} conversation(s)` +
        (result.more ? "; more are due." : "."),
    );
  },
};

/** The jobs contribution. */
export const MESSAGING_JOBS = {
  namespace: "messaging",
  blueprints: {
    "process-delivery": processDelivery,
    "reconcile-inbox": reconcileInbox,
    retention,
  },
} as const satisfies JobsContribution<MessagingJobDeps>;
