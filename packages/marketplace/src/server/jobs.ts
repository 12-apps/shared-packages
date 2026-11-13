import type { JobsContribution, WireJobBlueprint } from "@12-apps/wiring";

import type { MarketplaceEngine } from "../core/engine";
import { CatalogueRetryError, type CatalogueJobPayload } from "../core/catalogue-job";
import { FetchOrderRetryError, type FetchOrderJobPayload } from "../core/fetch-order";
import { OutboundRetryError } from "../core/outbound";
import type { OutboundJobPayload } from "../core/outbound-queue";
import { AvailabilityRetryError } from "../core/pause-job";
import type { AvailabilityJobPayload } from "../core/pause-store";

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
 * - `fetch-order`, on demand: one GET of an order a marketplace's event only
 *   announced (`orderToFetch`), then the one ingest path. Three attempts with
 *   backoff; the reconciliation sweep re-queues a row still owed.
 * - `catalogue`, on demand: one publish or withdraw of one product on one
 *   marketplace's catalogue (FUT-4768). Three attempts with backoff; the
 *   last one stamps FAILED with a failure code.
 * - `outbound-sweep`, every five minutes: re-queues every call a row still
 *   owes (a PENDING request, an accept with no confirm stamp, a catalogue
 *   publish or withdraw on its way) once it is older than the job's own retry
 *   span, so a refused enqueue or a dead process loses nothing.
 * - `availability`, on demand: brings one marketplace in line with the host's
 *   last pause or resume ask for one store (FUT-4851). Three attempts with
 *   backoff; the last one stamps FAILED with a failure code.
 * - `availability-sweep`, every five minutes: resumes a pause past its
 *   `until` (the host stopped renewing it), re-queues an ask still owed, and
 *   gives up on one older than a day.
 *
 * What stays the host's: whether to run them at all, on which runtime, and the
 * lease implementation. A host with no worker declines `jobs` in writing.
 *
 * Bound with `{ engine }`, these arrive at a runner as
 * `marketplace.expire-acceptances`, `marketplace.reconcile-inbox`,
 * `marketplace.outbound`, `marketplace.fetch-order`, `marketplace.catalogue`
 * and `marketplace.outbound-sweep`.
 */

/** What the host closes over at bind time: the mounted engine. */
export interface MarketplaceJobDeps {
  engine: Pick<
    MarketplaceEngine,
    | "expireLapsed"
    | "retryable"
    | "reprocess"
    | "runOutbound"
    | "runFetchOrder"
    | "runCatalogue"
    | "sweepOutbound"
    | "runAvailability"
    | "sweepAvailability"
  >;
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

/** The fetch job's attempts: the last one settles the inbox row FAILED. */
export const MARKETPLACE_FETCH_ORDER_ATTEMPTS = 3;

const fetchOrder: WireJobBlueprint<FetchOrderJobPayload, MarketplaceJobDeps> = {
  name: "fetch-order",
  attempts: MARKETPLACE_FETCH_ORDER_ATTEMPTS,
  // Short: an order waiting for its body is on the store's acceptance clock.
  backoff: { type: "exponential", delayMs: 5_000 },
  handle: async (payload, deps, context) => {
    try {
      const outcome = await deps.engine.runFetchOrder(payload, {
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
      });
      if (outcome.kind === "skipped") {
        context.logger.info(`marketplace.fetch-order: inbox ${payload.inboxId} skipped: ${outcome.reason}`);
      }
    } catch (error) {
      if (error instanceof FetchOrderRetryError) context.logger.warn(`marketplace.fetch-order: ${error.message}`);
      throw error;
    }
  },
};

/** The catalogue job's attempts: the last one stamps FAILED. */
const MARKETPLACE_CATALOGUE_ATTEMPTS = 3;

const catalogue: WireJobBlueprint<CatalogueJobPayload, MarketplaceJobDeps> = {
  name: "catalogue",
  attempts: MARKETPLACE_CATALOGUE_ATTEMPTS,
  // Short: a person is watching the switch say "sending".
  backoff: { type: "exponential", delayMs: 10_000 },
  handle: async (payload, deps, context) => {
    try {
      const outcome = await deps.engine.runCatalogue(payload, {
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
      });
      if (outcome.kind === "skipped") {
        context.logger.info(`marketplace.catalogue: ${payload.action} ${payload.publicationId} skipped: ${outcome.reason}`);
      }
    } catch (error) {
      if (error instanceof CatalogueRetryError) context.logger.warn(`marketplace.catalogue: ${error.message}`);
      throw error;
    }
  },
};

const outboundSweep: WireJobBlueprint<void, MarketplaceJobDeps> = {
  name: "outbound-sweep",
  queue: MARKETPLACE_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "*/5 * * * *", timezone: "UTC" },
  attempts: 1,
  lease: { ttlMs: SWEEP_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const result = await deps.engine.sweepOutbound();
    const idle = result.requeued + result.givenUp + result.timedOut + result.catalogueRequeued === 0;
    if (idle) return;
    context.logger.info(
      `marketplace.outbound-sweep: re-queued ${result.requeued} call(s) and ${result.catalogueRequeued} catalogue ` +
        `call(s), timed out ${result.timedOut} cancellation request(s), gave up on ${result.givenUp}.`,
    );
  },
};

/** The availability job's attempts: the last one stamps FAILED. */
export const MARKETPLACE_AVAILABILITY_ATTEMPTS = 3;

const availability: WireJobBlueprint<AvailabilityJobPayload, MarketplaceJobDeps> = {
  name: "availability",
  attempts: MARKETPLACE_AVAILABILITY_ATTEMPTS,
  // Short: a store is open on the marketplace while the kitchen is paused.
  backoff: { type: "exponential", delayMs: 10_000 },
  handle: async (payload, deps, context) => {
    try {
      const outcome = await deps.engine.runAvailability(payload, {
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
      });
      if (outcome.kind === "skipped") {
        context.logger.info(`marketplace.availability: ${payload.provider} ${payload.clientId} skipped: ${outcome.reason}`);
      }
    } catch (error) {
      if (error instanceof AvailabilityRetryError) context.logger.warn(`marketplace.availability: ${error.message}`);
      throw error;
    }
  },
};

const availabilitySweep: WireJobBlueprint<void, MarketplaceJobDeps> = {
  name: "availability-sweep",
  queue: MARKETPLACE_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "*/5 * * * *", timezone: "UTC" },
  attempts: 1,
  lease: { ttlMs: SWEEP_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const result = await deps.engine.sweepAvailability();
    if (result.expired + result.requeued + result.givenUp === 0) return;
    context.logger.info(
      `marketplace.availability-sweep: resumed ${result.expired} expired pause(s), re-queued ${result.requeued}, ` +
        `gave up on ${result.givenUp}.`,
    );
  },
};

/** The jobs contribution. */
export const MARKETPLACE_JOBS = {
  namespace: "marketplace",
  blueprints: {
    "expire-acceptances": expireAcceptances,
    "reconcile-inbox": reconcileInbox,
    outbound,
    "fetch-order": fetchOrder,
    catalogue,
    "outbound-sweep": outboundSweep,
    availability,
    "availability-sweep": availabilitySweep,
  },
} as const satisfies JobsContribution<MarketplaceJobDeps>;
