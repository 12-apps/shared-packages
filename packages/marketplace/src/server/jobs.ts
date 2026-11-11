import type { JobsContribution, WireJobBlueprint } from "@12-apps/wiring";

import type { MarketplaceEngine } from "../core/engine";
import { OutboundRetryError } from "../core/outbound";
import type { OutboundJobPayload } from "../core/outbound-queue";

/**
 * The engine's three jobs, declared here because every number in them is the
 * engine's knowledge, not a host's:
 *
 * - `expire-acceptances`, every minute: the unit being measured is minutes (a
 *   default window is five), so a coarser tick would make "expired" mean
 *   anywhere from five to twenty.
 * - `reconcile-inbox`, every five minutes: nothing races a deadline here, and
 *   each pass re-runs real ingestion work; the engine's attempt bound retires
 *   a payload that will never succeed.
 * - `outbound`, on demand: one call to a marketplace, three attempts with
 *   backoff. Its idempotency is the ROW's (the engine re-reads it), never the
 *   queue's dedupe alone.
 *
 * What stays the host's: whether to run them at all, on which runtime, and the
 * lease implementation. A host with no worker declines `jobs` in writing.
 *
 * Bound with `{ engine }`, these arrive at a runner as
 * `marketplace.expire-acceptances`, `marketplace.reconcile-inbox` and
 * `marketplace.outbound` — the names the origin host already uses.
 */

/** What the host closes over at bind time: the mounted engine. */
export interface MarketplaceJobDeps {
  engine: Pick<MarketplaceEngine, "expireLapsed" | "retryable" | "reprocess" | "runOutbound">;
}

/** The single-flight queue name (`@12-apps/jobs`' `SWEEP_QUEUE`), as a literal. */
export const MARKETPLACE_SWEEP_QUEUE = "sweeps";

/** How long one sweep pass may hold its name. */
const SWEEP_LEASE_MS = 5 * 60_000;

/** The outbound job's attempts: the last one stamps the failure. */
export const MARKETPLACE_OUTBOUND_ATTEMPTS = 3;

const expireAcceptances: WireJobBlueprint<void, MarketplaceJobDeps> = {
  name: "expire-acceptances",
  queue: MARKETPLACE_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "* * * * *", timezone: "UTC" },
  // Never retried by the queue: the next tick re-finds everything from the rows.
  attempts: 1,
  lease: { ttlMs: SWEEP_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const result = await deps.engine.expireLapsed();
    if (result.expired === 0) return;
    context.logger.info(
      `marketplace.expire-acceptances: expired ${result.expired} order(s) across ${result.tenants} tenant(s).`,
    );
  },
};

const reconcileInbox: WireJobBlueprint<void, MarketplaceJobDeps> = {
  name: "reconcile-inbox",
  queue: MARKETPLACE_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "*/5 * * * *", timezone: "UTC" },
  attempts: 1,
  lease: { ttlMs: SWEEP_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const pending = await deps.engine.retryable();
    let ingested = 0;
    // One event's failure never wedges the batch: `reprocess` never throws.
    for (const event of pending) {
      const outcome = await deps.engine.reprocess(event);
      if (outcome.kind === "ingested") ingested += 1;
    }
    if (pending.length === 0) return;
    context.logger.info(
      `marketplace.reconcile-inbox: re-ran ${pending.length} stored delivery(ies), ${ingested} became order(s).`,
    );
  },
};

const outbound: WireJobBlueprint<OutboundJobPayload, MarketplaceJobDeps> = {
  name: "outbound",
  attempts: MARKETPLACE_OUTBOUND_ATTEMPTS,
  backoff: { type: "exponential", delayMs: 30_000 },
  handle: async (payload, deps, context) => {
    try {
      const outcome = await deps.engine.runOutbound(payload, {
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
      });
      if (outcome.kind === "skipped") {
        context.logger.info(`marketplace.outbound: ${payload.action} ${payload.orderId} skipped: ${outcome.reason}`);
      }
    } catch (error) {
      if (error instanceof OutboundRetryError) context.logger.warn(`marketplace.outbound: ${error.message}`);
      throw error;
    }
  },
};

/** The jobs contribution. */
export const MARKETPLACE_JOBS = {
  namespace: "marketplace",
  blueprints: {
    "expire-acceptances": expireAcceptances,
    "reconcile-inbox": reconcileInbox,
    outbound,
  },
} as const satisfies JobsContribution<MarketplaceJobDeps>;
