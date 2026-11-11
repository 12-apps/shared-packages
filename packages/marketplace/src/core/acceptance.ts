import { readClaimRow, refuseFrom, type ClaimRow } from "./cancellation";
import { enqueueOutbound } from "./outbound-queue";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * The acceptance clock — the store saying yes (or no) to an order.
 *
 * A first-class state rather than a notification, because a marketplace
 * CANCELS an order nobody acknowledged. This module is the only thing that
 * moves an order between the states it can be in:
 *
 *     AWAITING ──accept──▶ ACCEPTED ──store cancel──▶ REJECTED
 *        │  └──reject───▶ REJECTED
 *        └──sweep───────▶ EXPIRED
 *
 * Every transition is guarded on the CURRENT state in the WHERE clause rather
 * than read-then-written, so the sweep and a person deciding in the same
 * second cannot both win. The loser is told nothing changed (`stale`) and the
 * host decides what that means — a 409 for a person, a no-op for the sweep.
 *
 * Beside the clock sits the store's own CANCELLATION REQUEST, on the same row:
 *
 *     null ──refuse/cancel──▶ PENDING ──job 2xx──▶ REQUESTED ──event──▶ CONFIRMED
 *                                │   └──job 4xx / last retry──▶ FAILED ──event──▶ CONFIRMED
 *                                └──event (the marketplace cancelled)──▶ CONFIRMED
 *
 * CONFIRMED is terminal; every write to the column is predicated on the
 * statuses it may come from, so an out-of-order event cannot undo it.
 */

/** The states an acceptance can be in. The host renders them; they are not copy. */
export type AcceptanceStatus = "AWAITING" | "ACCEPTED" | "REJECTED" | "EXPIRED";

/** Where the store's own cancellation request stands. */
export type CancellationStatus = "PENDING" | "REQUESTED" | "CONFIRMED" | "FAILED";

/** An order waiting on the store, as the acceptance queue shows it. */
export interface PendingAcceptance {
  id: string;
  /** The HOST's order id — what every host-side surface keys off. */
  orderId: string;
  provider: MarketplaceProvider;
  externalOrderId: string;
  externalDisplayId: string | null;
  /** The deadline itself, so a client counts down against a real instant. */
  acknowledgeBy: Date | null;
  externalDueAt: Date | null;
  commissionCents: number | null;
  buyerName: string | null;
  totalCents: number;
  unmappedLines: number;
  createdAt: string | null;
}

interface PendingRow {
  id: string;
  orderId: string;
  provider: string;
  externalOrderId: string;
  externalDisplayId: string | null;
  acknowledgeBy: Date | null;
  externalDueAt: Date | null;
  commissionCents: number | null;
}

/**
 * Orders still on the clock, soonest DEADLINE first — the one about to lapse
 * is the one that has to be at the top of the screen. The host's half of each
 * row arrives in ONE `summarize` call.
 */
export async function listPendingAcceptances(
  ctx: EngineContext,
  clientId: string,
): Promise<PendingAcceptance[]> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceAcceptance.findMany({
    where: { clientId, status: "AWAITING" },
    orderBy: { acknowledgeBy: "asc" },
    select: {
      id: true,
      orderId: true,
      provider: true,
      externalOrderId: true,
      externalDisplayId: true,
      acknowledgeBy: true,
      externalDueAt: true,
      commissionCents: true,
    },
  })) as PendingRow[];
  if (rows.length === 0) return [];

  const summaries = await ctx.ports.order.summarize(
    clientId,
    rows.map((row) => row.orderId),
  );
  return rows.map((row) => {
    const summary = summaries.get(row.orderId);
    return {
      ...row,
      buyerName: summary?.buyerName ?? null,
      totalCents: summary?.totalCents ?? 0,
      unmappedLines: summary?.unmappedLines ?? 0,
      createdAt: summary?.createdAt ?? null,
    };
  });
}

/** The two things a person can do to an order on the clock. */
export type AcceptanceDecision = "ACCEPT" | "REJECT";

/**
 * What a decision did. `stale` means the claim was lost (decided already,
 * expired, cancelled by the marketplace, or not this tenant's). `invalidReason`
 * means the reason code is not one of the marketplace's, and NOTHING was
 * written: a decision is all-or-nothing.
 */
export type DecisionResult =
  | {
      kind: "decided";
      orderId: string;
      status: AcceptanceStatus;
      cancellation: CancellationStatus | null;
      reasonCode: string | null;
    }
  | { kind: "stale" }
  | { kind: "invalidReason"; validCodes: string[] };

/**
 * Record the store's decision on one order on the clock.
 *
 * The `status: "AWAITING"` predicate is the concurrency guard AND the
 * idempotency answer: deciding twice, or accepting an order the sweep has
 * just expired, updates nothing and returns `stale`.
 *
 * A refusal carries a reason from the marketplace's own list, validated
 * BEFORE anything is written; with no code the marketplace's first reason is
 * taken. An accept queues the confirm, a refusal queues the cancellation
 * request — never a call inside the decision.
 */
export async function decideAcceptance(
  ctx: EngineContext,
  input: {
    clientId: string;
    orderId: string;
    decision: AcceptanceDecision;
    reasonCode?: string | null;
    now?: Date;
  },
): Promise<DecisionResult> {
  const row = await readClaimRow(ctx, input.clientId, input.orderId);
  if (!row || row.status !== "AWAITING") return { kind: "stale" };
  const now = input.now ?? ctx.ports.clock.now();
  if (input.decision === "ACCEPT") return acceptOnTheClock(ctx, input, row, now);
  return refuseFrom(ctx, { ...input, now, row, callRefused: true });
}

/** The accept half of a decision: claim, the host's half, the queued confirm. */
async function acceptOnTheClock(
  ctx: EngineContext,
  input: { clientId: string; orderId: string },
  row: ClaimRow,
  now: Date,
): Promise<DecisionResult> {
  const db = await ctx.ports.db();
  const claimed = await db.marketplaceAcceptance.updateMany({
    where: { orderId: input.orderId, clientId: input.clientId, status: "AWAITING" },
    data: { status: "ACCEPTED", acknowledgedAt: now },
  });
  if (claimed.count === 0) return { kind: "stale" };
  await ctx.ports.order.onAccepted(input.clientId, input.orderId);
  await enqueueOutbound(ctx, { clientId: input.clientId, orderId: input.orderId, action: "confirm" }, row.provider);
  ctx.ports.publishChanged(input.clientId);
  return { kind: "decided", orderId: input.orderId, status: "ACCEPTED", cancellation: null, reasonCode: null };
}

/** What one sweep pass did. */
export interface ExpirySweepResult {
  expired: number;
  tenants: number;
}

/**
 * Expire every order whose deadline has passed.
 *
 * The marketplace has already cancelled these on its own side — that is what
 * the deadline MEANS — so this records what the engine now knows happened.
 * Idempotent by durable marker: `status` is in the predicate, and an ACCEPTED
 * row is never touched, so an order a person accepted is never expired.
 */
export async function expireLapsedAcceptances(
  ctx: EngineContext,
  now: Date,
): Promise<ExpirySweepResult> {
  const db = await ctx.ports.db();
  const lapsed = (await db.marketplaceAcceptance.findMany({
    where: { status: "AWAITING", acknowledgeBy: { lt: now } },
    select: { id: true, clientId: true, orderId: true },
  })) as { id: string; clientId: string; orderId: string }[];
  if (lapsed.length === 0) return { expired: 0, tenants: 0 };

  const result = await db.marketplaceAcceptance.updateMany({
    where: { id: { in: lapsed.map((row) => row.id) }, status: "AWAITING" },
    data: { status: "EXPIRED", acknowledgedAt: now },
  });

  // The host's half must not be able to fail the sweep: one tenant's broken
  // cancellation cannot leave every other tenant's lapsed orders on the clock.
  for (const row of lapsed) {
    try {
      await ctx.ports.order.onRefused(row.clientId, row.orderId, "EXPIRED");
    } catch (error) {
      ctx.ports.logger.error(
        `marketplace.expire-acceptances: order ${row.orderId} expired but the host's refusal failed: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  const tenants = new Set(lapsed.map((row) => row.clientId));
  for (const clientId of tenants) ctx.ports.publishChanged(clientId);
  return { expired: result.count, tenants: tenants.size };
}

/**
 * The marketplace cancelled an order it had already given us.
 *
 * Terminal on the acceptance side whatever state it was in. A cancellation
 * request the store made is answered: CONFIRMED, from PENDING, REQUESTED or
 * FAILED (a refusal followed by a cancellation is still a cancellation).
 * Returns false when no acceptance stands for this external order — a
 * cancellation can outrun the placement it refers to.
 */
export async function cancelAcceptance(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; externalOrderId: string; now?: Date },
): Promise<boolean> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceAcceptance.findFirst({
    where: {
      clientId: input.clientId,
      provider: input.provider,
      externalOrderId: input.externalOrderId,
    },
    select: { orderId: true },
  })) as { orderId: string } | null;
  if (!row) return false;

  await db.marketplaceAcceptance.updateMany({
    where: { orderId: row.orderId, status: { not: "REJECTED" } },
    data: { status: "REJECTED", acknowledgedAt: input.now ?? ctx.ports.clock.now() },
  });
  await db.marketplaceAcceptance.updateMany({
    where: { orderId: row.orderId, cancellationStatus: { in: ["PENDING", "REQUESTED", "FAILED"] } },
    data: { cancellationStatus: "CONFIRMED" },
  });
  await ctx.ports.order.onRefused(input.clientId, row.orderId, "CANCELLED");
  ctx.ports.publishChanged(input.clientId);
  return true;
}

