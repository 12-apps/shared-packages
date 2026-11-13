import { markMarketplaceEventSeen } from "./integration";
import { resolveSkus } from "./menu-links";
import { enqueueOutbound } from "./outbound-queue";
import type { EngineContext, MarketplaceDb, ResolvedOrderLine } from "./ports";
import type { NormalizedMarketplaceOrder } from "./types";

/**
 * Normalized marketplace order → the host's own order.
 *
 * The rule this module is written around, stated once so every decision below
 * reads against it: **losing a paid marketplace order is the one unforgivable
 * failure.** An unmapped SKU, a buyer with no name, a total that does not equal
 * the line sum — none of them reject the order. They land, flagged, on a screen
 * a human can act on. The only thing that stops an ingestion is a condition
 * under which persisting would be WRONG rather than incomplete.
 *
 * Idempotent on `(provider, externalOrderId)`, which the acceptance table's
 * unique enforces. That is what makes a redelivered webhook, a reconciliation
 * poll racing it, and a retry after a crash all safe: each either creates the
 * one order or finds it already there. The pre-read below is a fast path, not
 * the guarantee — two concurrent deliveries both miss it and only one of them
 * reaches a row.
 */

/** What one ingestion did. */
export interface IngestResult {
  /** The HOST's order id. */
  orderId: string;
  /** False when the order already existed — a redelivery, not a second sale. */
  created: boolean;
  /** SKUs that arrived with nothing behind them, in this order. */
  unmappedSkus: string[];
  /** Whether the connection's policy made this order born accepted. */
  autoAccepted: boolean;
}

/** The store's operating decisions, read from the connection at ingest time. */
export interface IngestSettings {
  autoAccept: boolean;
  ackSlaSeconds: number;
}

/**
 * Resolve the order's SKUs and compose its lines.
 *
 * `resolveSkus` does double duty on this path: it answers what each SKU maps to
 * AND records every one of them, which is how an unmapped SKU reaches the
 * store's attention list without anyone having to notice it first.
 */
async function composeLines(
  db: MarketplaceDb,
  clientId: string,
  order: NormalizedMarketplaceOrder,
  seenAt: Date,
): Promise<ResolvedOrderLine[]> {
  const mapping = await resolveSkus(db, {
    clientId,
    provider: order.provider,
    skus: order.lines.map((line) => ({ externalSku: line.externalSku, name: line.name })),
    seenAt,
  });
  return order.lines.map((line) => ({
    externalSku: line.externalSku,
    // The MARKETPLACE's text, never the catalog's, even for a mapped line.
    // Every other order snapshots what the buyer was shown, and what this buyer
    // was shown is the marketplace's menu — a mapped line renamed to the host's
    // own product name would quietly disagree with the receipt in the bag.
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    note: line.note,
    subjectRef: mapping.get(line.externalSku) ?? null,
  }));
}

/** The acceptance row an ingest writes: born ACCEPTED or on the clock. */
function acceptanceData(
  clientId: string,
  orderId: string,
  order: NormalizedMarketplaceOrder,
  settings: IngestSettings,
  now: Date,
  clockStartsAt: Date,
): Record<string, unknown> {
  const accepted = settings.autoAccept;
  return {
    clientId,
    orderId,
    provider: order.provider,
    externalOrderId: order.externalOrderId,
    externalDisplayId: order.externalDisplayId,
    // Who carries a delivery: the merchant's courier or the marketplace's fleet.
    deliveredBy: order.deliveredBy ?? null,
    status: accepted ? "ACCEPTED" : "AWAITING",
    acknowledgeBy: new Date(clockStartsAt.getTime() + settings.ackSlaSeconds * 1000),
    acknowledgedAt: accepted ? now : null,
    externalDueAt: order.deliveryDueAt,
    commissionCents: order.commissionCents,
    // The order's SKUs: what a cancellation's offending SKUs are checked against.
    lineSkus: [...new Set(order.lines.map((line) => line.externalSku))],
  };
}

/**
 * Ingest one order.
 *
 * The deadline is stamped HERE, from the connection's SLA, and never recomputed
 * afterwards: a store that later lengthens its SLA must not move the deadline of
 * an order already on the clock, and one that shortens it must not retroactively
 * expire orders that were fine when they arrived.
 *
 * The acceptance row and the host's order are written in that dependency order
 * — the host creates its own row first and hands back an id, because only the
 * host knows what creating one costs. Auto-accept is decided at arrival so the
 * order is BORN accepted rather than created and immediately updated: the
 * two-step version has a window in which a crash leaves an order the store
 * believes was auto-accepted sitting on a clock nobody is watching.
 */
export async function ingestMarketplaceOrder(
  ctx: EngineContext,
  input: {
    clientId: string;
    order: NormalizedMarketplaceOrder;
    settings: IngestSettings;
    now?: Date;
    /**
     * When the acceptance window started, if not `now`: the arrival of the
     * event that announced an order fetched later. Moves ONLY the deadline;
     * the liveness stamp and an auto-accept's time stay `now`.
     */
    clockStartsAt?: Date;
  },
): Promise<IngestResult> {
  const { clientId, order, settings } = input;
  const now = input.now ?? ctx.ports.clock.now();
  const clockStartsAt = input.clockStartsAt ?? now;

  const db = await ctx.ports.db();
  // Answered from this package's OWN table rather than through a port: the
  // idempotency key is `(provider, externalOrderId)` on `marketplace_acceptances`,
  // so the package holds it and no host has to be trusted to re-implement it.
  const existing = (await db.marketplaceAcceptance.findFirst({
    where: { provider: order.provider, externalOrderId: order.externalOrderId },
    select: { orderId: true },
  })) as { orderId: string } | null;
  if (existing) {
    return { orderId: existing.orderId, created: false, unmappedSkus: [], autoAccepted: false };
  }

  const accepted = settings.autoAccept;
  // ONE transaction for the host's order, the SKU rows, the acceptance row and
  // the liveness stamp: the host's `create` is handed the transaction's client,
  // so an acceptance that cannot be written (a concurrent ingest won the
  // unique) rolls the host's order back with it, and a redelivery never meets
  // an orphan host order to duplicate.
  const { orderId, unmappedSkus } = await ctx.ports.transaction(async (tx) => {
    const lines = await composeLines(tx, clientId, order, now);
    const created = await ctx.ports.order.create(clientId, order, lines, tx);
    await tx.marketplaceAcceptance.create({ data: acceptanceData(clientId, created, order, settings, now, clockStartsAt) });
    await markMarketplaceEventSeen(tx, clientId, order.provider, now);
    return { orderId: created, unmappedSkus: lines.filter((l) => l.subjectRef === null).map((l) => l.externalSku) };
  });

  if (accepted) {
    // Born accepted is still an acceptance the marketplace must hear about.
    // Queued FIRST, never called (no ingest waits on a marketplace's API), so
    // a host half that throws cannot lose it; the sweep re-queues it if the
    // queue refused it.
    await enqueueOutbound(ctx, { clientId, orderId, action: "confirm" }, order.provider);
    await ctx.ports.order.onAccepted(clientId, orderId);
  }

  ctx.ports.publishChanged(clientId);

  return { orderId, created: true, unmappedSkus, autoAccepted: accepted };
}
