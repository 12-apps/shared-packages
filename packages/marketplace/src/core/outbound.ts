import type { MarketplaceAdapter, OutboundOrderRef, OutboundResult } from "./adapter";
import {
  cancellationWindowMs,
  confirmedToHost,
  failedRequestData,
  rejectConfirmed,
  requestsFirst,
  tellCancellationFailed,
} from "./cancellation-outcome";
import { readOutboundConnection, type OutboundConnection } from "./integration";
import type { OutboundJobPayload } from "./outbound-queue";
import { failAsTimeout } from "./outbound-sweep";
import type { EngineContext } from "./ports";
import { resolveReason } from "./registry";

/**
 * The outbound engine: one queued call to a marketplace, start to finish.
 *
 * The job (`marketplace.outbound`) is the only caller. It re-reads the row,
 * decides whether a call is still owed, makes it through the adapter with the
 * host's HTTP client, and stamps the outcome. The rule for an answer is the
 * same for every marketplace:
 *
 * - **2xx** — done: `confirmed_at`, or REQUESTED (CONFIRMED for a marketplace
 *   that answers a cancellation in the response rather than by event);
 * - **4xx** — refused, final, never retried: `confirm_failed_at`, or FAILED;
 * - **anything else** (5xx, timeout, network) — retried by the queue: this
 *   THROWS {@link OutboundRetryError}, until the last attempt, which stamps the
 *   failure and returns.
 *
 * Idempotent by the ROW, never by the queue's dedupe alone: a stamped confirm
 * (`confirmed_at` or `confirm_failed_at`) is never sent again, and a request
 * is only sent from PENDING. A confirm is never sent for an order that is no
 * longer ACCEPTED here.
 */

/** What one run did. */
export type OutboundOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "done"; action: OutboundJobPayload["action"] }
  | { kind: "failed"; action: OutboundJobPayload["action"]; reason: string };

/** Thrown so the queue retries. Its message is what the job log reads. */
export class OutboundRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundRetryError";
  }
}

/** Which attempt this is, as the job runner says. */
export interface OutboundAttempt {
  attempt: number;
  maxAttempts: number;
}

interface OutboundRow {
  orderId: string;
  provider: string;
  externalOrderId: string;
  externalDisplayId: string | null;
  status: string;
  confirmedAt: Date | null;
  confirmFailedAt: Date | null;
  cancellationStatus: string | null;
  cancellationReasonCode: string | null;
  cancellationOffendingSkus: unknown;
  cancellationRequestedAt: Date | null;
  preparationMinutes: number | null;
  createdAt: Date;
}

const ROW_SELECT = {
  orderId: true,
  provider: true,
  externalOrderId: true,
  externalDisplayId: true,
  status: true,
  confirmedAt: true,
  confirmFailedAt: true,
  cancellationStatus: true,
  cancellationReasonCode: true,
  cancellationOffendingSkus: true,
  cancellationRequestedAt: true,
  preparationMinutes: true,
  createdAt: true,
} as const;

function refOf(row: OutboundRow): OutboundOrderRef {
  return {
    externalOrderId: row.externalOrderId,
    externalDisplayId: row.externalDisplayId,
    hostOrderCode: row.orderId,
    placedAt: row.createdAt,
  };
}

/** Why a confirm is not owed, or null when it is. */
function confirmSkip(row: OutboundRow, adapter: MarketplaceAdapter): string | null {
  if (row.status !== "ACCEPTED") return `the order is ${row.status}, not ACCEPTED`;
  // A request to cancel stands (FUT-4758: the status stays ACCEPTED while it
  // waits): confirming now would tell the marketplace the opposite.
  if (row.cancellationStatus !== null && row.cancellationStatus !== "FAILED") {
    return `a cancellation request is ${row.cancellationStatus}`;
  }
  if (row.confirmedAt || row.confirmFailedAt) return "the confirm is already stamped";
  if (!adapter.capabilities.apiConfirm) return "the marketplace has no confirm API";
  return null;
}

/** The stamps one confirm outcome writes, predicated on the confirm still being owed. */
async function stampConfirm(
  ctx: EngineContext,
  row: OutboundRow,
  succeeded: boolean,
  now: Date,
): Promise<void> {
  const db = await ctx.ports.db();
  await db.marketplaceAcceptance.updateMany({
    where: { orderId: row.orderId, confirmedAt: null, confirmFailedAt: null },
    data: succeeded ? { confirmedAt: now } : { confirmFailedAt: now },
  });
}

/**
 * The cancellation stamp, predicated on the request still being PENDING, and
 * the host told how it ended when this run is what ended it (FUT-4758): a
 * marketplace that answers in the response CONFIRMS here, and a refusal FAILS
 * here. REQUESTED tells nobody: the answer is still to come, by event.
 */
async function stampCancellation(
  ctx: EngineContext,
  row: OutboundRow,
  status: "REQUESTED" | "CONFIRMED" | "FAILED",
  clientId: string,
): Promise<void> {
  if (status === "CONFIRMED") return stampConfirmedCancellation(ctx, row, clientId);
  const db = await ctx.ports.db();
  const data = status === "FAILED" ? failedRequestData("REFUSED") : { cancellationStatus: status };
  const moved = await db.marketplaceAcceptance.updateMany({
    where: { orderId: row.orderId, cancellationStatus: "PENDING" },
    data,
  });
  if (moved.count > 0 && status === "FAILED") await tellCancellationFailed(ctx, clientId, row.orderId, "REFUSED");
}

/**
 * Which rows a synchronous "cancelled" answers: the request still waiting or
 * FAILED, or the tombstone an accept left of THIS request (no status, the
 * same `cancellation_requested_at` the job read). A later request of the store
 * carries a new instant and a status of its own, so it is never mistaken for it.
 */
function answerableRequest(row: OutboundRow): Record<string, unknown>[] {
  const waiting = { cancellationStatus: { in: ["PENDING", "FAILED"] } };
  if (row.cancellationRequestedAt === null) return [waiting];
  return [waiting, { cancellationStatus: null, cancellationRequestedAt: row.cancellationRequestedAt }];
}

/**
 * A marketplace that confirms in its answer: the same stamps as its
 * CANCELLED event (`cancelAcceptance`) — CONFIRMED and REJECTED in one
 * transaction — then the host's `onCancellationConfirmed`, or
 * `onRefused(…, "CANCELLED")` when it binds none. A host failure is logged:
 * the stamps have committed.
 */
async function stampConfirmedCancellation(ctx: EngineContext, row: OutboundRow, clientId: string): Promise<void> {
  const now = ctx.ports.clock.now();
  const moved = await ctx.ports.transaction(async (tx) => {
    // From FAILED too: the sweep may have timed the request out while this
    // call was in flight, and a marketplace that answers in the response sends
    // no event — its "cancelled" is the only word that it did (the event path's
    // own rule: a confirmation after a TIMEOUT still confirms). And from the
    // TOMBSTONE of this same request (FUT-4765, R3-N2): the store may have
    // accepted the order once the request timed out, which clears the request
    // but keeps its `cancellation_requested_at`. The order is cancelled on the
    // marketplace, so it is cancelled here too, and the host hears it.
    const confirmed = await tx.marketplaceAcceptance.updateMany({
      where: { orderId: row.orderId, OR: answerableRequest(row) },
      data: { cancellationStatus: "CONFIRMED", cancellationFailureReason: null },
    });
    if (confirmed.count === 0) return false;
    await rejectConfirmed(tx, row.orderId, now);
    return true;
  });
  if (!moved) return;
  try {
    await confirmedToHost(ctx, clientId, row.orderId);
  } catch (error) {
    ctx.ports.logger.error(
      `marketplace.outbound: order ${row.orderId} was cancelled on the store's request but the host's half failed: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

/** The connection, or the reason it cannot be used (a refusal: no retry fixes it). */
async function connectionFor(
  ctx: EngineContext,
  clientId: string,
  provider: string,
): Promise<OutboundConnection | string> {
  try {
    return (await readOutboundConnection(ctx, clientId, provider)) ?? "no credentials on file";
  } catch (error) {
    return `credentials do not open: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Turn a call's answer into the stamp and the outcome, or a retry. */
async function settle(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  row: OutboundRow,
  result: OutboundResult,
  attempt: OutboundAttempt,
  succeed: () => Promise<void>,
  fail: () => Promise<void>,
): Promise<OutboundOutcome> {
  if (result.kind === "accepted") {
    await succeed();
    ctx.ports.publishChanged(payload.clientId);
    return { kind: "done", action: payload.action };
  }
  const reason = result.kind === "refused" ? `refused ${result.status}: ${result.message}` : result.reason;
  if (result.kind === "retry" && attempt.attempt < attempt.maxAttempts) {
    throw new OutboundRetryError(`${payload.action} for order ${row.orderId}: ${reason}`);
  }
  await fail();
  ctx.ports.logger.error(`marketplace.outbound: ${payload.action} for order ${row.orderId} failed: ${reason}`);
  ctx.ports.publishChanged(payload.clientId);
  return { kind: "failed", action: payload.action, reason };
}

async function runConfirm(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  row: OutboundRow,
  adapter: MarketplaceAdapter,
  attempt: OutboundAttempt,
): Promise<OutboundOutcome> {
  const skip = confirmSkip(row, adapter);
  if (skip) return { kind: "skipped", reason: skip };
  const now = ctx.ports.clock.now();
  const connection = await connectionFor(ctx, payload.clientId, row.provider);
  const result: OutboundResult =
    typeof connection === "string"
      ? { kind: "refused", status: 0, message: connection }
      : await adapter.confirm(
          { http: ctx.ports.http, tokens: ctx.tokens, now, ...connection },
          refOf(row),
          // The stated preparation time, for a marketplace whose confirm takes one.
          { preparationMinutes: adapter.capabilities.confirmTakesPreparationTime ? row.preparationMinutes : null },
        );
  return settle(
    ctx,
    payload,
    row,
    result,
    attempt,
    () => stampConfirm(ctx, row, true, now),
    () => stampConfirm(ctx, row, false, now),
  );
}

/** Whether a request is older than its marketplace's answer window, so it must not be sent any more. */
function pastWindow(ctx: EngineContext, row: OutboundRow, adapter: MarketplaceAdapter): boolean {
  // A 1.0.0 host (no `onCancellationConfirmed`) has no window: it retries, as before.
  if (!requestsFirst(ctx)) return false;
  const window = cancellationWindowMs(ctx, adapter);
  if (window === null || row.cancellationRequestedAt === null) return false;
  return ctx.ports.clock.now().getTime() - row.cancellationRequestedAt.getTime() > window;
}

/** The offending SKUs stored with the request. */
function skusOf(row: OutboundRow): string[] {
  return Array.isArray(row.cancellationOffendingSkus) ? row.cancellationOffendingSkus.map(String) : [];
}

async function runCancellation(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  row: OutboundRow,
  adapter: MarketplaceAdapter,
  attempt: OutboundAttempt,
): Promise<OutboundOutcome> {
  if (row.cancellationStatus !== "PENDING") {
    return { kind: "skipped", reason: `the request is ${row.cancellationStatus ?? "absent"}, not PENDING` };
  }
  if (pastWindow(ctx, row, adapter)) {
    // A retry that comes after the window never delivers (FUT-4758): the host
    // was, or is now, told TIMEOUT, and the store cancels in the marketplace's app.
    await failAsTimeout(ctx, [{ clientId: payload.clientId, orderId: row.orderId, provider: row.provider }]);
    return { kind: "failed", action: payload.action, reason: "past the marketplace's answer window" };
  }
  const reason = resolveReason(adapter, row.cancellationReasonCode);
  const connection = await connectionFor(ctx, payload.clientId, row.provider);
  let result: OutboundResult;
  if (!reason) result = { kind: "refused", status: 0, message: "the stored reason is not the marketplace's" };
  else if (typeof connection === "string") result = { kind: "refused", status: 0, message: connection };
  else {
    result = await adapter.requestCancellation(
      { http: ctx.ports.http, tokens: ctx.tokens, now: ctx.ports.clock.now(), ...connection },
      refOf(row),
      { reason, text: "", mode: "MANUAL", offendingSkus: skusOf(row) },
    );
  }
  const taken = adapter.capabilities.asyncCancellationOutcome ? "REQUESTED" : "CONFIRMED";
  return settle(
    ctx,
    payload,
    row,
    result,
    attempt,
    () => stampCancellation(ctx, row, taken, payload.clientId),
    () => stampCancellation(ctx, row, "FAILED", payload.clientId),
  );
}

/**
 * The failure stamp a run that died on its LAST attempt leaves: FAILED, never
 * PENDING, so a person is shown the app link. Best-effort: if the database is
 * what failed, the row stays owed and the outbound sweep picks it up.
 */
async function stampLastAttemptFailure(ctx: EngineContext, payload: OutboundJobPayload, error: unknown): Promise<OutboundOutcome> {
  const reason = error instanceof Error ? error.message : String(error);
  const db = await ctx.ports.db();
  const moved = await (payload.action === "confirm"
    ? db.marketplaceAcceptance.updateMany({
        where: { orderId: payload.orderId, clientId: payload.clientId, confirmedAt: null, confirmFailedAt: null },
        data: { confirmFailedAt: ctx.ports.clock.now() },
      })
    : db.marketplaceAcceptance.updateMany({
        where: { orderId: payload.orderId, clientId: payload.clientId, cancellationStatus: "PENDING" },
        data: failedRequestData("REFUSED"),
      }));
  ctx.ports.logger.error(`marketplace.outbound: ${payload.action} for order ${payload.orderId} failed: ${reason}`);
  ctx.ports.publishChanged(payload.clientId);
  if (payload.action === "requestCancellation" && moved.count > 0) {
    await tellCancellationFailed(ctx, payload.clientId, payload.orderId, "REFUSED");
  }
  return { kind: "failed", action: payload.action, reason };
}

async function runOnce(ctx: EngineContext, payload: OutboundJobPayload, attempt: OutboundAttempt): Promise<OutboundOutcome> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceAcceptance.findFirst({
    where: { orderId: payload.orderId, clientId: payload.clientId },
    select: ROW_SELECT,
  })) as OutboundRow | null;
  if (!row) return { kind: "skipped", reason: "no acceptance for this order" };
  const adapter = ctx.registry.get(row.provider);
  if (!adapter) return { kind: "skipped", reason: `no adapter for ${row.provider}` };
  return payload.action === "confirm"
    ? runConfirm(ctx, payload, row, adapter, attempt)
    : runCancellation(ctx, payload, row, adapter, attempt);
}

/**
 * Run one queued outbound call. Returns what it did; throws
 * {@link OutboundRetryError} for an answer worth retrying before the last
 * attempt. Any OTHER throw (an adapter bug, a database error while stamping)
 * is rethrown for the queue to retry, and on the last attempt ends FAILED.
 */
export async function runOutbound(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  attempt: OutboundAttempt,
): Promise<OutboundOutcome> {
  try {
    return await runOnce(ctx, payload, attempt);
  } catch (error) {
    if (error instanceof OutboundRetryError || attempt.attempt < attempt.maxAttempts) throw error;
    return stampLastAttemptFailure(ctx, payload, error);
  }
}
