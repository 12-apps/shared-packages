import type { MarketplaceAdapter, OutboundOrderRef, OutboundResult, StatusStep } from "./adapter";
import { readOutboundConnection, type OutboundConnection } from "./integration";
import { MARKETPLACE_OUTBOUND_JOB, type OutboundJobPayload } from "./outbound-queue";
import type { EngineContext, MarketplaceDb } from "./ports";
import { insertStatusRow, readStatusRows, settleStatusRow, statusTable, type StatusRow } from "./status-store";
import type { MarketplaceDeliveredBy } from "./types";

/**
 * The status job's body (FUT-4653), `marketplace.outbound` with action
 * `status`: tell the marketplace the order reached a step.
 *
 * In order, stopping at the first rule that fails, with no row and no call:
 *
 * 1. the acceptance is ACCEPTED and no cancellation request stands;
 * 2. the adapter states the step and takes it for this kind of order;
 * 3. the host says the order still holds the step (a dispatch undone inside
 *    the board's undo window sends nothing);
 * 4. no row exists for (order, step), and the marketplace has not CONCLUDED
 *    the order (a step it announced itself is in the same table);
 * 5. claim: insert the row (STORE, SENDING), unique on (order, step); a lost
 *    claim stops the run;
 * 6. call the adapter: 2xx SENT; a final 4xx FAILED, logged at error, never
 *    retried; 408/425/429/5xx/timeout retried, the last attempt FAILED. A run
 *    on a SENDING row it owns (a retry, or the sweep's re-queue) calls again.
 *
 * Nothing here touches the order: a failed, refused or lost status call
 * changes nothing in the host.
 */

/** What the job reads of the acceptance row. */
export interface StatusJobRow {
  orderId: string;
  provider: string;
  status: string;
  cancellationStatus: string | null;
  deliveredBy: string | null;
}

/** What one run did, in the outbound job's own shape. */
export type StatusJobOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "done"; action: "status" }
  | { kind: "failed"; action: "status"; reason: string };

export interface StatusJobDeps {
  attempt: { attempt: number; maxAttempts: number };
  ref: OutboundOrderRef;
  retryError: (message: string) => Error;
}

function deliveredByOf(row: StatusJobRow): MarketplaceDeliveredBy | null {
  return row.deliveredBy === "MERCHANT" || row.deliveredBy === "MARKETPLACE" ? row.deliveredBy : null;
}

const skipped = (reason: string): StatusJobOutcome => ({ kind: "skipped", reason });

/** Why rule 1 stops the job, or null. */
function acceptanceSkip(row: StatusJobRow): string | null {
  if (row.status !== "ACCEPTED") return `the order is ${row.status}, not ACCEPTED`;
  const standing = row.cancellationStatus !== null && row.cancellationStatus !== "FAILED";
  return standing ? `a cancellation request is ${row.cancellationStatus}` : null;
}

/** Why rules 2 and 3 stop the job, or null. Rule 3 asks the host, so it comes last. */
async function adapterAndHostSkip(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  step: StatusStep,
  row: StatusJobRow,
  adapter: MarketplaceAdapter,
): Promise<string | null> {
  const takes =
    adapter.informStatus !== undefined &&
    adapter.capabilities.statusSteps?.includes(step) === true &&
    adapter.statusSupported?.({ step, deliveredBy: deliveredByOf(row) }) !== false;
  if (!takes) return `the marketplace does not take ${step} for this order`;
  const holds = ctx.ports.order.statusHolds;
  if (!holds) return "the host binds no statusHolds, so it cannot say the order still holds the step";
  return (await holds.call(ctx.ports.order, payload.clientId, row.orderId, step)) ? null : `the order no longer holds ${step}`;
}

/** The opened connection, or why the store has none (disconnected, no secrets, secrets that do not open). */
async function connectionOf(ctx: EngineContext, clientId: string, provider: string): Promise<OutboundConnection | string> {
  try {
    return (await readOutboundConnection(ctx, clientId, provider)) ?? "no credentials on file";
  } catch (error) {
    return `credentials do not open: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Call the adapter with the opened connection. */
function callAdapter(
  ctx: EngineContext,
  connection: OutboundConnection,
  adapter: MarketplaceAdapter,
  row: StatusJobRow,
  step: StatusStep,
  ref: OutboundOrderRef,
): Promise<OutboundResult | { kind: "unsupported" }> {
  const now = ctx.ports.clock.now();
  return adapter.informStatus!({ http: ctx.ports.http, tokens: ctx.tokens, now, ...connection }, ref, {
    step,
    deliveredBy: deliveredByOf(row),
  });
}

/** Stamp the answer; a retry throws until the last attempt. */
async function settle(
  ctx: EngineContext,
  db: MarketplaceDb,
  where: { orderId: string; step: StatusStep; claimKey: string },
  result: OutboundResult | { kind: "unsupported" },
  deps: StatusJobDeps,
): Promise<StatusJobOutcome> {
  const table = statusTable(db)!;
  if (result.kind === "accepted") {
    await settleStatusRow(table, where, "SENT");
    return { kind: "done", action: "status" };
  }
  const reason =
    result.kind === "refused"
      ? `refused ${result.status}: ${result.message}`
      : result.kind === "retry"
        ? result.reason
        : "the adapter answered unsupported after the claim";
  if (result.kind === "retry" && deps.attempt.attempt < deps.attempt.maxAttempts) {
    throw deps.retryError(`status ${where.step} for order ${where.orderId}: ${reason}`);
  }
  await settleStatusRow(table, where, "FAILED");
  ctx.ports.logger.error(`${MARKETPLACE_OUTBOUND_JOB}: status ${where.step} for order ${where.orderId} failed: ${reason}`);
  return { kind: "failed", action: "status", reason };
}

/** Whether a row is a SENDING claim of the run holding `key`. */
function ownsClaim(found: StatusRow, key: string): boolean {
  return found.source === "STORE" && found.state === "SENDING" && found.claimKey === key;
}

/**
 * Rules 4 and 5: why the step is not ours to send (a row stands, or the
 * marketplace concluded, or the claim was lost), or null once the row is ours.
 */
async function claim(
  table: NonNullable<MarketplaceDb["marketplaceStatusUpdate"]>,
  payload: OutboundJobPayload,
  row: StatusJobRow,
  step: StatusStep,
  key: string,
): Promise<string | null> {
  const rows = await readStatusRows(table, row.orderId, [step, "CONCLUDED"]);
  if (rows.some((found) => found.step === "CONCLUDED" && found.source === "MARKETPLACE")) {
    return "the marketplace concluded this order";
  }
  const own = rows.find((found) => found.step === step);
  // A SENDING row under THIS job's key is its own retry (or the sweep's re-claim of it): it
  // calls again. Under any other key another move's job holds it, and sends nothing.
  if (own) return ownsClaim(own, key) ? null : `${step} is already ${own.state}${own.state === "SENDING" ? ", held by another run" : ""}`;
  const claimed = await insertStatusRow(table, {
    clientId: payload.clientId,
    orderId: row.orderId,
    provider: row.provider,
    step,
    source: "STORE",
    state: "SENDING",
    claimKey: key,
  });
  return claimed ? null : `another run holds the claim on ${step}`;
}

/** Run one status job. `row` is the acceptance the outbound job already read. */
export async function runStatus(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  row: StatusJobRow,
  adapter: MarketplaceAdapter,
  deps: StatusJobDeps,
): Promise<StatusJobOutcome> {
  const step = payload.step;
  if (!step) return skipped("a status call names no step");
  const stopped = acceptanceSkip(row) ?? (await adapterAndHostSkip(ctx, payload, step, row, adapter));
  if (stopped) return skipped(stopped);
  const db = await ctx.ports.db();
  const table = statusTable(db);
  if (!table) return skipped("the host has not composed the status model");

  // A store with no connection, or secrets that do not open, is not a failure of this step: it
  // is asked before the claim so no row is left behind, and said at info (a disconnected store
  // would otherwise log an error on every move).
  const connection = await connectionOf(ctx, payload.clientId, row.provider);
  if (typeof connection === "string") {
    ctx.ports.logger.info(`${MARKETPLACE_OUTBOUND_JOB}: status ${step} for order ${row.orderId} not sent: ${connection}`);
    return skipped(connection);
  }
  const key = payload.claimKey ?? "";
  const unclaimed = await claim(table, payload, row, step, key);
  if (unclaimed) return skipped(unclaimed);
  const result = await callAdapter(ctx, connection, adapter, row, step, deps.ref);
  return settle(ctx, db, { orderId: row.orderId, step, claimKey: key }, result, deps);
}

/** The last attempt died without an answer: FAILED, never left SENDING. Best-effort. */
export async function failStatusRow(ctx: EngineContext, payload: OutboundJobPayload): Promise<void> {
  const table = statusTable(await ctx.ports.db());
  if (table && payload.step) {
    await settleStatusRow(table, { orderId: payload.orderId, step: payload.step, claimKey: payload.claimKey ?? "" }, "FAILED");
  }
}
