import type { AcceptanceStatus, CancellationStatus, DecisionResult } from "./acceptance";
import type { CancellationReason, MarketplaceAdapter } from "./adapter";
import { enqueueOutbound } from "./outbound-queue";
import type { EngineContext } from "./ports";
import { resolveReason } from "./registry";
import type { MarketplaceProvider } from "./types";

/**
 * The store's own CANCELLATION REQUEST — the half of a refusal that must reach
 * the marketplace. Lives on the acceptance row:
 *
 *     null ──refuse/cancel──▶ PENDING ──job 2xx──▶ REQUESTED ──event──▶ CONFIRMED
 *                                │   └──job 4xx / last retry──▶ FAILED ──event──▶ CONFIRMED
 *                                └──event (the marketplace cancelled)──▶ CONFIRMED
 *
 * CONFIRMED is terminal; every write is predicated on the statuses it may come
 * from, so an out-of-order event cannot undo it. One request per order: a
 * row whose request was already stamped is `stale` to every later refusal.
 */

/** The acceptance row a claim reads first. */
export interface ClaimRow {
  orderId: string;
  provider: string;
  status: string;
  cancellationStatus: string | null;
}

export async function readClaimRow(
  ctx: EngineContext,
  clientId: string,
  orderId: string,
): Promise<ClaimRow | null> {
  const db = await ctx.ports.db();
  return (await db.marketplaceAcceptance.findFirst({
    where: { orderId, clientId },
    select: { orderId: true, provider: true, status: true, cancellationStatus: true },
  })) as ClaimRow | null;
}

/** What a refusal stamps, and with which reason. */
interface CancellationPlan {
  status: CancellationStatus | null;
  reason: CancellationReason | null;
}

/**
 * Plan the cancellation half of a refusal, or report the code as invalid.
 *
 * - No adapter (a provider nobody registers any more): nothing goes out.
 * - An API that cannot cancel — at all, or after an accept — stamps FAILED at
 *   once: the request cannot be made from here, and FAILED is what puts the
 *   adapter's app link in front of a person.
 * - Otherwise PENDING, for the outbound job.
 */
function planCancellation(
  adapter: MarketplaceAdapter | null,
  reasonCode: string | null | undefined,
  fromStatus: string,
): CancellationPlan | "invalid" {
  if (!adapter) return { status: null, reason: null };
  const reason = resolveReason(adapter, reasonCode);
  const named = reasonCode !== null && reasonCode !== undefined;
  if (named && !reason) return "invalid";
  const { apiCancel, cancelAfterAccept } = adapter.capabilities;
  const canAsk = apiCancel && reason !== null && (fromStatus === "AWAITING" || cancelAfterAccept);
  return { status: canAsk ? "PENDING" : "FAILED", reason };
}

/** The refusal of a code that is not the marketplace's. Nothing was written. */
function invalidReason(adapter: MarketplaceAdapter | null): DecisionResult {
  const validCodes = (adapter?.cancellationReasons() ?? []).map((reason) => reason.code);
  return { kind: "invalidReason", validCodes };
}

/** The data one refusal writes, from the status it leaves. */
function refusalData(plan: CancellationPlan, fromStatus: string, now: Date): Record<string, unknown> {
  return {
    status: "REJECTED",
    // An accepted row keeps the instant it was accepted; a row leaving the
    // clock is acknowledged now (the table's CHECK pairs the two).
    ...(fromStatus === "AWAITING" ? { acknowledgedAt: now } : {}),
    cancellationStatus: plan.status,
    cancellationReasonCode: plan.reason?.code ?? null,
  };
}

/**
 * Refuse an order from the status it was read in: validate the reason, claim
 * the row on that status, run the host's half when asked, queue the request.
 *
 * `callRefused` is true for a refusal on the clock (the engine tells the host
 * to cancel its order) and false for the store's own cancel (the host already
 * did).
 */
export async function refuseFrom(
  ctx: EngineContext,
  input: {
    clientId: string;
    orderId: string;
    reasonCode?: string | null;
    now: Date;
    row: ClaimRow;
    callRefused: boolean;
  },
): Promise<DecisionResult> {
  const { row } = input;
  const adapter = ctx.registry.get(row.provider);
  const plan = planCancellation(adapter, input.reasonCode, row.status);
  if (plan === "invalid") return invalidReason(adapter);

  const db = await ctx.ports.db();
  const claimed = await db.marketplaceAcceptance.updateMany({
    where: { orderId: input.orderId, clientId: input.clientId, status: row.status, cancellationStatus: null },
    data: refusalData(plan, row.status, input.now),
  });
  if (claimed.count === 0) return { kind: "stale" };
  if (input.callRefused) await ctx.ports.order.onRefused(input.clientId, input.orderId, "REJECTED");
  if (plan.status === "PENDING") {
    const payload = { clientId: input.clientId, orderId: input.orderId, action: "requestCancellation" as const };
    await enqueueOutbound(ctx, payload, row.provider);
  }
  ctx.ports.publishChanged(input.clientId);
  return {
    kind: "decided",
    orderId: input.orderId,
    status: "REJECTED" satisfies AcceptanceStatus,
    cancellation: plan.status,
    reasonCode: plan.reason?.code ?? null,
  };
}

/**
 * The STORE cancelled an order through the host's own cancel — before or
 * after accepting it. Stamps the request the marketplace must hear and queues
 * it. The host's own cancel already ran, so the engine does NOT call
 * `onRefused`: it records and queues, and nothing else.
 *
 * `stale` when the marketplace already cancelled it, the clock lapsed, or a
 * request was already made.
 */
export async function recordStoreCancellation(
  ctx: EngineContext,
  input: { clientId: string; orderId: string; reasonCode?: string | null; now?: Date },
): Promise<DecisionResult> {
  const row = await readClaimRow(ctx, input.clientId, input.orderId);
  if (!row || row.cancellationStatus !== null) return { kind: "stale" };
  if (row.status !== "AWAITING" && row.status !== "ACCEPTED") return { kind: "stale" };
  const now = input.now ?? ctx.ports.clock.now();
  return refuseFrom(ctx, { ...input, now, row, callRefused: false });
}

/**
 * The marketplace refused the store's cancellation request. FAILED, from
 * PENDING or REQUESTED only: CONFIRMED is terminal, so a refusal arriving
 * after the cancellation changes nothing. Returns whether a row moved.
 */
export async function failCancellationRequest(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; externalOrderId: string },
): Promise<boolean> {
  const db = await ctx.ports.db();
  const moved = await db.marketplaceAcceptance.updateMany({
    where: {
      clientId: input.clientId,
      provider: input.provider,
      externalOrderId: input.externalOrderId,
      cancellationStatus: { in: ["PENDING", "REQUESTED"] },
    },
    data: { cancellationStatus: "FAILED" },
  });
  if (moved.count > 0) ctx.ports.publishChanged(input.clientId);
  return moved.count > 0;
}
