import { deferInboxEvent, settleInboxEvent } from "./inbox";
import { ingestMarketplaceOrder } from "./ingest";
import { readOutboundConnection, resolveIngestionTarget } from "./integration";
import type { FetchOrderResult } from "./adapter";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider, NormalizedEvent } from "./types";

/**
 * Fetching an order the event only announced — the engine's half of a
 * marketplace whose events carry no order body (Open Delivery's `CREATED`).
 *
 * The rule this keeps: no path that answers a request calls a marketplace. So
 * the webhook only RECORDS the delivery (PENDING, "order details to fetch")
 * and queues `marketplace.fetch-order`; the job reads the row, asks the
 * adapter's `fetchOrder` through the host's HTTP port with the store's own
 * credentials, and ingests what comes back through the one ingest path. The
 * inbox reconciliation sweep re-queues the job for a row that is still owed,
 * so a refused enqueue or a dead worker loses nothing — and it never fetches
 * itself, so a host that holds the job (its enqueue port answers "held")
 * holds every fetch.
 *
 * Nothing here knows a marketplace: which events need a fetch is the adapter's
 * `orderToFetch`, and how to fetch is its `fetchOrder`.
 */

/** The wire name, `<namespace>.<blueprint>` as the jobs contribution binds it. */
export const MARKETPLACE_FETCH_ORDER_JOB = "marketplace.fetch-order";

/** The job's payload. Identifiers only: the event itself is the inbox row's. */
export interface FetchOrderJobPayload {
  clientId: string;
  inboxId: string;
}

/** What one run did. */
export type FetchOrderOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "ingested"; orderId: string; unmappedSkus: string[] }
  | { kind: "failed"; reason: string };

/** Thrown so the queue retries the fetch. Its message is what the job log reads. */
export class FetchOrderRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchOrderRetryError";
  }
}

/** The reason a recorded row waits for its fetch. */
export const AWAITING_ORDER_REASON = "order details to fetch";

/**
 * Leave the row PENDING for its fetch and queue the job. The queue port never
 * throws; a refusal is logged and recovered by the reconciliation sweep.
 */
export async function awaitOrderBody(ctx: EngineContext, clientId: string, inboxId: string): Promise<void> {
  await deferInboxEvent(ctx, inboxId, AWAITING_ORDER_REASON);
  const payload: FetchOrderJobPayload = { clientId, inboxId };
  const outcome = await ctx.ports.enqueue.enqueue(MARKETPLACE_FETCH_ORDER_JOB, payload, {
    dedupeKey: `${MARKETPLACE_FETCH_ORDER_JOB}:${inboxId}`,
  });
  if (!outcome.enqueued) {
    ctx.ports.logger.warn(
      `${MARKETPLACE_FETCH_ORDER_JOB}: inbox row ${inboxId} was not queued; the reconciliation sweep will re-queue it` +
        (outcome.reason ? ` (${outcome.reason})` : ""),
    );
  }
}

interface InboxRow {
  id: string;
  clientId: string | null;
  provider: string;
  payload: unknown;
  status: string;
}

/** The recorded row and its event, or why there is nothing to fetch. */
async function owedFetch(
  ctx: EngineContext,
  payload: FetchOrderJobPayload,
): Promise<{ row: InboxRow; event: NormalizedEvent } | string> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceInboxEvent.findUnique({
    where: { id: payload.inboxId },
    select: { id: true, clientId: true, provider: true, payload: true, status: true },
  })) as InboxRow | null;
  if (!row || row.clientId !== payload.clientId) return "no such inbox row for this tenant";
  if (row.status !== "PENDING" && row.status !== "FAILED") return `the row is already ${row.status}`;
  const event = ctx.registry.get(row.provider)?.normalize(row.payload) ?? null;
  if (!event?.orderToFetch || event.order) return "the event announces no order to fetch";
  return { row, event };
}

/** One call to the adapter, or the refusal that stands in for it. */
async function fetchThroughAdapter(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
  externalOrderId: string,
): Promise<FetchOrderResult> {
  const adapter = ctx.registry.get(provider);
  if (!adapter?.fetchOrder) return { kind: "refused", status: 0, message: `${provider} cannot fetch an order` };
  let connection;
  try {
    connection = await readOutboundConnection(ctx, clientId, provider);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "refused", status: 0, message: `credentials do not open: ${reason}` };
  }
  if (!connection) return { kind: "refused", status: 0, message: "no credentials on file" };
  try {
    return await adapter.fetchOrder(
      { http: ctx.ports.http, tokens: ctx.tokens, now: ctx.ports.clock.now(), ...connection },
      { externalOrderId },
    );
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run one queued fetch. Returns what it did; throws {@link FetchOrderRetryError}
 * for an answer worth retrying before the last attempt. A refusal, or the last
 * attempt's retry, settles the row FAILED: the reconciliation sweep re-queues
 * it within the inbox's attempt bound.
 */
export async function runFetchOrder(
  ctx: EngineContext,
  payload: FetchOrderJobPayload,
  attempt: { attempt: number; maxAttempts: number },
): Promise<FetchOrderOutcome> {
  const owed = await owedFetch(ctx, payload);
  if (typeof owed === "string") return { kind: "skipped", reason: owed };
  const { row, event } = owed;
  const target = await resolveIngestionTarget(ctx, payload.clientId, event.provider);
  if (!target?.enabled) {
    await deferInboxEvent(ctx, row.id, "integration is not enabled");
    return { kind: "skipped", reason: "integration is not enabled" };
  }
  const result = await fetchThroughAdapter(ctx, payload.clientId, event.provider, event.externalOrderId ?? "");
  if (result.kind === "order") {
    const ingested = await ingestMarketplaceOrder(ctx, {
      clientId: payload.clientId,
      order: result.order,
      settings: { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds },
    });
    await settleInboxEvent(ctx, row.id, "PROCESSED");
    return { kind: "ingested", orderId: ingested.orderId, unmappedSkus: ingested.unmappedSkus };
  }
  const reason = result.kind === "refused" ? `refused ${result.status}: ${result.message}` : result.reason;
  if (result.kind === "retry" && attempt.attempt < attempt.maxAttempts) {
    throw new FetchOrderRetryError(`fetch of ${event.externalOrderId ?? "?"} (inbox ${row.id}): ${reason}`);
  }
  await settleInboxEvent(ctx, row.id, "FAILED", `order fetch failed: ${reason}`);
  ctx.ports.logger.error(`${MARKETPLACE_FETCH_ORDER_JOB}: inbox row ${row.id} failed: ${reason}`);
  return { kind: "failed", reason };
}
