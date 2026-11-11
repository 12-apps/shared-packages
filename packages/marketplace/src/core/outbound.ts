import type { MarketplaceAdapter, OutboundOrderRef, OutboundResult } from "./adapter";
import { readOutboundConnection, type OutboundConnection } from "./integration";
import type { OutboundJobPayload } from "./outbound-queue";
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

/** The cancellation stamp, predicated on the request still being PENDING. */
async function stampCancellation(
  ctx: EngineContext,
  row: OutboundRow,
  status: "REQUESTED" | "CONFIRMED" | "FAILED",
): Promise<void> {
  const db = await ctx.ports.db();
  await db.marketplaceAcceptance.updateMany({
    where: { orderId: row.orderId, cancellationStatus: "PENDING" },
    data: { cancellationStatus: status },
  });
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
          { preparationMinutes: null },
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
  const reason = resolveReason(adapter, row.cancellationReasonCode);
  const connection = await connectionFor(ctx, payload.clientId, row.provider);
  let result: OutboundResult;
  if (!reason) result = { kind: "refused", status: 0, message: "the stored reason is not the marketplace's" };
  else if (typeof connection === "string") result = { kind: "refused", status: 0, message: connection };
  else {
    result = await adapter.requestCancellation(
      { http: ctx.ports.http, tokens: ctx.tokens, now: ctx.ports.clock.now(), ...connection },
      refOf(row),
      { reason, text: "", mode: "MANUAL", offendingSkus: [] },
    );
  }
  const taken = adapter.capabilities.asyncCancellationOutcome ? "REQUESTED" : "CONFIRMED";
  return settle(
    ctx,
    payload,
    row,
    result,
    attempt,
    () => stampCancellation(ctx, row, taken),
    () => stampCancellation(ctx, row, "FAILED"),
  );
}

/**
 * Run one queued outbound call. Returns what it did; throws
 * {@link OutboundRetryError} only for an answer worth retrying before the last
 * attempt.
 */
export async function runOutbound(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  attempt: OutboundAttempt,
): Promise<OutboundOutcome> {
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
