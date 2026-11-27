import type { MarketplaceAdapter, OutboundOrderRef } from "./adapter";
import type { PickupCodeCallResult, PickupCodeValidation, ValidatePickupCodeInput } from "./courier-port";
import { readOutboundConnection } from "./integration";
import { MARKETPLACE_OUTBOUND_JOB, type OutboundJobPayload } from "./outbound-queue";
import type { EngineContext } from "./ports";

/**
 * The pickup-code check's engine half (FUT-5665): the store checked the code
 * the marketplace's courier stated, locally, and handed the bag over; then the
 * host calls {@link validatePickupCode}, one enqueue, and the
 * `marketplace.outbound` job (action `validatePickupCode`) tells the
 * marketplace and hands its verdict to the host's `onPickupCodeValidated`.
 *
 * No row: the verdict is the host's to keep (it warns on `INVALID`, it moves
 * nothing). A retry after a verdict could ask again; that is harmless, the
 * check being a question with the same answer. A queue that refuses the job
 * answers false and nothing re-queues it: the hand-over has happened and the
 * marketplace's own check is its half, never a gate on ours.
 */

/** One enqueue, never throws: no statement and no call. True when the queue took it. */
export async function validatePickupCode(ctx: EngineContext, input: ValidatePickupCodeInput): Promise<boolean> {
  const payload: OutboundJobPayload = {
    clientId: input.clientId,
    orderId: input.orderId,
    action: "validatePickupCode",
    code: input.code,
  };
  const dedupeKey = `${MARKETPLACE_OUTBOUND_JOB}:validatePickupCode:${input.orderId}:${input.at.getTime()}`;
  const notQueued = (why: string): false => {
    ctx.ports.logger.warn(`${MARKETPLACE_OUTBOUND_JOB}: validatePickupCode for order ${input.orderId} was not queued${why}`);
    return false;
  };
  try {
    const outcome = await ctx.ports.enqueue.enqueue(MARKETPLACE_OUTBOUND_JOB, payload, { dedupeKey });
    return outcome.enqueued || notQueued(outcome.reason ? ` (${outcome.reason})` : "");
  } catch (error) {
    return notQueued(`: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** What the job reads of the acceptance row. */
interface PickupCodeRow {
  orderId: string;
  provider: string;
  status: string;
  deliveredBy: string | null;
}

type PickupCodeOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "done"; action: "validatePickupCode" }
  | { kind: "failed"; action: "validatePickupCode"; reason: string };

interface PickupCodeDeps {
  attempt: { attempt: number; maxAttempts: number };
  ref: OutboundOrderRef;
  retryError: (message: string) => Error;
}

/** Hand the verdict to the host. Its throw is logged: the job never re-asks the marketplace for it. */
export async function tellPickupCode(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  validation: PickupCodeValidation,
): Promise<void> {
  const hook = ctx.ports.order.onPickupCodeValidated;
  const log = validation === "VALID" ? ctx.ports.logger.info : ctx.ports.logger.warn;
  log.call(ctx.ports.logger, `marketplace.outbound: pickup code of order ${payload.orderId}: ${validation}`);
  if (!hook) return;
  try {
    await hook.call(ctx.ports.order, payload.clientId, payload.orderId, validation);
  } catch (error) {
    ctx.ports.logger.error(
      `marketplace.outbound: the host's half of the pickup-code verdict for order ${payload.orderId} failed: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

/** Why the check is not sent, or null when it is. */
function skipOf(payload: OutboundJobPayload, row: PickupCodeRow, adapter: MarketplaceAdapter): string | null {
  if (!adapter.courier) return "the marketplace has no pickup-code check";
  if (row.status !== "ACCEPTED") return `the order is ${row.status}, not ACCEPTED`;
  if (row.deliveredBy !== "MARKETPLACE") return "the order is not carried by the marketplace's courier";
  return payload.code ? null : "no pickup code to send";
}

/** The call's answer, or the reason no call could be made. */
async function call(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  row: PickupCodeRow,
  adapter: MarketplaceAdapter,
  ref: OutboundOrderRef,
): Promise<PickupCodeCallResult> {
  let connection;
  try {
    connection = await readOutboundConnection(ctx, payload.clientId, row.provider);
  } catch (error) {
    const message = `credentials do not open: ${error instanceof Error ? error.message : String(error)}`;
    return { kind: "refused", status: 0, message, own: true };
  }
  if (!connection) return { kind: "refused", status: 0, message: "no credentials on file", own: true };
  return adapter.courier!.validatePickupCode(
    { http: ctx.ports.http, tokens: ctx.tokens, now: ctx.ports.clock.now(), ...connection },
    ref,
    { code: payload.code! },
  );
}

/** The job's body: skip, call, hand the verdict over; a retry throws until the last attempt. */
export async function runPickupCode(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  row: PickupCodeRow,
  adapter: MarketplaceAdapter,
  deps: PickupCodeDeps,
): Promise<PickupCodeOutcome> {
  const skip = skipOf(payload, row, adapter);
  if (skip) return { kind: "skipped", reason: skip };
  const result = await call(ctx, payload, row, adapter, deps.ref);
  if (result.kind === "answered") {
    await tellPickupCode(ctx, payload, result.valid ? "VALID" : "INVALID");
    ctx.ports.publishChanged(payload.clientId);
    return { kind: "done", action: "validatePickupCode" };
  }
  const reason = result.kind === "refused" ? `refused ${result.status}: ${result.message}` : result.reason;
  if (result.kind === "retry" && deps.attempt.attempt < deps.attempt.maxAttempts) {
    throw deps.retryError(`validatePickupCode for order ${row.orderId}: ${reason}`);
  }
  ctx.ports.logger.error(`marketplace.outbound: validatePickupCode for order ${row.orderId} failed: ${reason}`);
  await tellPickupCode(ctx, payload, "UNVERIFIED");
  ctx.ports.publishChanged(payload.clientId);
  return { kind: "failed", action: "validatePickupCode", reason };
}
