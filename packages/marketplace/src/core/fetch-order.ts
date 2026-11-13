import { deferInboxEvent, settleInboxEvent } from "./inbox";
import { ingestMarketplaceOrder } from "./ingest";
import { readOutboundConnection, resolveIngestionTarget } from "./integration";
import type { FetchOrderResult } from "./adapter";
import { cancelAcceptance } from "./acceptance";
import { cancelledBeforeIngest } from "./order-fetch-marks";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider, NormalizedEvent, NormalizedMarketplaceOrder } from "./types";

/**
 * Fetching an order the event only announced — the engine's half of a
 * marketplace whose events carry no order body (Open Delivery's `CREATED`).
 *
 * The rule this keeps: no path that answers a request calls a marketplace. So
 * the webhook only RECORDS the delivery (PENDING, "order details to fetch")
 * and queues `marketplace.fetch-order`; the job reads the row, asks the
 * adapter's `fetchOrder` through the host's HTTP port with the store's own
 * credentials, and ingests what comes back through the one ingest path. The
 * inbox reconciliation sweep re-queues the job for a row that is still owed
 * once it is older than the job's own retry span ({@link FETCH_REQUEUE_AGE_MS}),
 * so a refused enqueue or a dead worker loses nothing — and it never fetches
 * itself, so a host that holds the job (its enqueue port answers "held")
 * holds every fetch.
 *
 * Two things are judged before a fetched order is ingested: a cancellation
 * that outran the fetch (`./order-fetch-marks.ts`) wins, and an order naming a
 * merchant other than the connection's is refused.
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
const AWAITING_ORDER_REASON = "order details to fetch";

/**
 * A row waiting for its fetch is left alone by the reconciliation sweep this
 * long: the job's own three attempts (5 s, then 10 s apart) finish well inside
 * it. Past it the sweep re-queues, and only then counts an attempt, so a slow
 * queue never spends the row's attempts while its first job still waits.
 */
export const FETCH_REQUEUE_AGE_MS = 2 * 60_000;

/**
 * Leave the row PENDING for its fetch and queue the job. The queue port never
 * throws; a refusal is logged and recovered by the reconciliation sweep.
 * `dedupeKey` defaults to the row's own; a re-queue passes a fresh one, since
 * a queue may keep a finished job's id and swallow a re-queue under it.
 */
export async function awaitOrderBody(
  ctx: EngineContext,
  clientId: string,
  inboxId: string,
  dedupeKey: string = `${MARKETPLACE_FETCH_ORDER_JOB}:${inboxId}`,
): Promise<void> {
  await deferInboxEvent(ctx, inboxId, AWAITING_ORDER_REASON);
  const payload: FetchOrderJobPayload = { clientId, inboxId };
  const outcome = await ctx.ports.enqueue.enqueue(MARKETPLACE_FETCH_ORDER_JOB, payload, { dedupeKey });
  if (!outcome.enqueued) {
    ctx.ports.logger.warn(
      `${MARKETPLACE_FETCH_ORDER_JOB}: inbox row ${inboxId} was not queued; the reconciliation sweep will re-queue it` +
        (outcome.reason ? ` (${outcome.reason})` : ""),
    );
  }
}

/**
 * The reconciliation sweep's answer to a row still waiting for its order body:
 * untouched while younger than {@link FETCH_REQUEUE_AGE_MS} (no attempt
 * counted, nothing queued), else re-queued under a fresh key with a warning,
 * so a hold or a dead worker is visible rather than silent.
 */
export async function requeueOwedFetch(
  ctx: EngineContext,
  input: { id: string; clientId: string; receivedAt?: Date | null },
): Promise<{ kind: "awaitingOrder" }> {
  const now = ctx.ports.clock.now();
  const age = input.receivedAt ? now.getTime() - input.receivedAt.getTime() : Number.POSITIVE_INFINITY;
  if (age < FETCH_REQUEUE_AGE_MS) return { kind: "awaitingOrder" };
  ctx.ports.logger.warn(`${MARKETPLACE_FETCH_ORDER_JOB}: inbox row ${input.id} still waits for its order body; re-queued`);
  await awaitOrderBody(ctx, input.clientId, input.id, `${MARKETPLACE_FETCH_ORDER_JOB}:${input.id}:${now.getTime()}`);
  return { kind: "awaitingOrder" };
}

interface InboxRow {
  id: string;
  clientId: string | null;
  provider: string;
  payload: unknown;
  status: string;
  receivedAt: Date | null;
}

/** The recorded row and its event, or why there is nothing to fetch. */
async function owedFetch(
  ctx: EngineContext,
  payload: FetchOrderJobPayload,
): Promise<{ row: InboxRow; event: NormalizedEvent } | string> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceInboxEvent.findUnique({
    where: { id: payload.inboxId },
    select: { id: true, clientId: true, provider: true, payload: true, status: true, receivedAt: true },
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
 * Why a fetched order must not be ingested, or null. A cancellation recorded
 * before the body arrived wins: the order is cancelled, so no pedido and no
 * confirm. An order naming another merchant than the connection's is someone
 * else's order delivered to this store's URL (a wrong webhook URL, a replay).
 */
async function refusalOf(
  ctx: EngineContext,
  clientId: string,
  order: NormalizedMarketplaceOrder,
  connectionMerchantId: string | null,
): Promise<{ settle: "IGNORED" | "FAILED"; reason: string; failed: boolean } | null> {
  if (await cancelledBeforeIngest(ctx, { clientId, provider: order.provider, externalOrderId: order.externalOrderId })) {
    return { settle: "IGNORED", reason: "cancelled before its order body arrived", failed: false };
  }
  const mismatch = merchantMismatch(order, connectionMerchantId);
  // FAILED, not IGNORED: a connection whose merchant id was entered wrong is
  // corrected, and the reconciliation sweep then retries within its bound.
  return mismatch ? { settle: "FAILED", reason: mismatch, failed: true } : null;
}

/**
 * Why an order naming a merchant cannot be this connection's, or null. An
 * order that names none, or a connection that states none, is not judged.
 * Shared by the fetched path and an order the event carries (`./pipeline.ts`).
 */
export function merchantMismatch(order: NormalizedMarketplaceOrder, connectionMerchantId: string | null): string | null {
  const named = order.externalMerchantId ?? null;
  if (named === null || connectionMerchantId === null || named === connectionMerchantId) return null;
  return `the order names merchant ${named}, not this connection's`;
}

/** Ingest a fetched order, unless {@link refusalOf} says otherwise. */
async function ingestFetched(
  ctx: EngineContext,
  row: InboxRow,
  clientId: string,
  order: NormalizedMarketplaceOrder,
  target: { autoAccept: boolean; ackSlaSeconds: number; externalMerchantId: string | null },
): Promise<FetchOrderOutcome> {
  const refusal = await refusalOf(ctx, clientId, order, target.externalMerchantId);
  if (refusal) {
    await settleInboxEvent(ctx, row.id, refusal.settle, refusal.reason);
    if (!refusal.failed) return { kind: "skipped", reason: refusal.reason };
    ctx.ports.logger.error(`${MARKETPLACE_FETCH_ORDER_JOB}: inbox row ${row.id} refused: ${refusal.reason}`);
    return { kind: "failed", reason: refusal.reason };
  }
  const ingested = await ingestMarketplaceOrder(ctx, {
    clientId,
    order,
    settings: { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds },
    // The store's acceptance window starts when the event arrived, not when a
    // delayed fetch finished: the marketplace's own clock started then.
    clockStartsAt: row.receivedAt ?? undefined,
  });
  // A CANCELLED that read the acceptances while this ingest's transaction was
  // still open found none and left its marker: honour it now, through the
  // ordinary cancel path (the order is cancelled; no confirm is owed).
  const ref = { clientId, provider: order.provider, externalOrderId: order.externalOrderId };
  if (await cancelledBeforeIngest(ctx, ref)) await cancelAcceptance(ctx, ref);
  await settleInboxEvent(ctx, row.id, "PROCESSED");
  return { kind: "ingested", orderId: ingested.orderId, unmappedSkus: ingested.unmappedSkus };
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
  if (result.kind === "order") return ingestFetched(ctx, row, payload.clientId, result.order, target);
  const reason = result.kind === "refused" ? `refused ${result.status}: ${result.message}` : result.reason;
  if (result.kind === "retry" && attempt.attempt < attempt.maxAttempts) {
    throw new FetchOrderRetryError(`fetch of ${event.externalOrderId ?? "?"} (inbox ${row.id}): ${reason}`);
  }
  await settleInboxEvent(ctx, row.id, "FAILED", `order fetch failed: ${reason}`);
  ctx.ports.logger.error(`${MARKETPLACE_FETCH_ORDER_JOB}: inbox row ${row.id} failed: ${reason}`);
  return { kind: "failed", reason };
}
