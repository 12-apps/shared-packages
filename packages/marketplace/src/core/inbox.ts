import type { EngineContext } from "./ports";
import type { MarketplaceProvider, NormalizedEvent } from "./types";

/**
 * The durable inbox , needed here for two reasons rather than one.
 *
 * A marketplace's delivery is not reliably exactly-once, so the SAME event
 * arrives more than once and the pipeline must be able to say "already seen".
 * It is not reliably at-least-once either, so reconciliation polling has to be
 * able to inject an event the webhook never brought. Both paths write here, and
 * `(provider, eventId)` is what collapses them onto one row — a duplicate is a
 * DB-level no-op rather than a second order.
 *
 * The RAW payload is stored because normalization is the part most likely to be
 * wrong. When a mapping bug drops a line, the only way to reconstruct what the
 * marketplace actually said is to have kept it.
 */

/** What {@link recordInboxEvent} tells the caller about a delivery. */
interface InboxRecord {
  id: string;
  /** False when this exact delivery had already been recorded. */
  fresh: boolean;
}

/**
 * Record one delivery, deduped on `(provider, eventId)`.
 *
 * Returns `fresh: false` for a redelivery, which is the pipeline's whole
 * idempotency story at the door: the caller stops there and answers the
 * marketplace 200. Answering 200 to a duplicate matters as much as processing
 * the original — a marketplace that gets an error redelivers, and a pipeline
 * that errors on its own duplicates never stops receiving them.
 */
export async function recordInboxEvent(
  ctx: EngineContext,
  input: { clientId: string | null; event: NormalizedEvent; payload: unknown },
): Promise<InboxRecord> {
  const db = await ctx.ports.db();
  const key = { provider_eventId: { provider: input.event.provider, eventId: input.event.eventId } };
  const existing = (await db.marketplaceInboxEvent.findUnique({
    where: key,
    select: { id: true },
  })) as { id: string } | null;
  if (existing) return { id: existing.id, fresh: false };

  try {
    const row = (await db.marketplaceInboxEvent.create({
      data: {
        clientId: input.clientId,
        provider: input.event.provider,
        eventId: input.event.eventId,
        eventType: input.event.eventType,
        externalOrderId: input.event.externalOrderId,
        payload: input.payload,
      },
      select: { id: true },
    })) as { id: string };
    return { id: row.id, fresh: true };
  } catch (error) {
    // The check-then-insert above is not atomic, and two simultaneous
    // redeliveries are exactly the shape that loses that race. The unique index
    // is the real guard; this turns losing the race into the same answer the
    // check would have given, rather than a 500 that provokes another retry.
    if ((error as { code?: string }).code !== "P2002") throw error;
    const raced = (await db.marketplaceInboxEvent.findUnique({
      where: key,
      select: { id: true },
    })) as { id: string } | null;
    return { id: raced?.id ?? "", fresh: false };
  }
}

/** How an inbox row ended up. */
type InboxOutcome = "PROCESSED" | "FAILED" | "IGNORED";

/**
 * Close out an inbox row.
 *
 * `attempts` increments on every close, including the successful one, so the
 * count reads as "how many times did we touch this" rather than "how many times
 * did we fail" — a row PROCESSED on its third attempt is a different story from
 * one processed on its first, and only the incrementing version can tell them
 * apart.
 */
export async function settleInboxEvent(
  ctx: EngineContext,
  id: string,
  outcome: InboxOutcome,
  error?: string,
): Promise<void> {
  if (!id) return;
  const db = await ctx.ports.db();
  await db.marketplaceInboxEvent.update({
    where: { id },
    data: {
      status: outcome,
      // Truncated: a provider's error body can be a page of HTML, and the
      // column exists to be read by a human in a list.
      error: error ? error.slice(0, 500) : null,
      processedAt: ctx.ports.clock.now(),
      attempts: { increment: 1 },
    },
  });
}

/**
 * Leave a row PENDING with its reason recorded, and count the attempt.
 *
 * The state between "done" and "broken": the delivery is fine and the STORE is
 * not ready for it — the channel is switched off, or was mid-onboarding when
 * the order came in. Settling it either way would be a lie (IGNORED discards an
 * order that could still be ingested; FAILED blames the payload), so it stays
 * PENDING and the sweep picks it up again.
 *
 * The attempt still counts, which is what stops the churn: the sweep's own
 * attempt bound retires a row after a few passes over a store that never turned
 * the channel on, instead of re-reading it forever.
 */
export async function deferInboxEvent(
  ctx: EngineContext,
  id: string,
  reason: string,
): Promise<void> {
  if (!id) return;
  const db = await ctx.ports.db();
  await db.marketplaceInboxEvent.update({
    where: { id },
    data: { error: reason.slice(0, 500), attempts: { increment: 1 } },
  });
}

/** One stored delivery, as the retry sweep re-reads it. */
export interface PendingInboxEvent {
  id: string;
  clientId: string;
  provider: MarketplaceProvider;
  payload: unknown;
}

/**
 * Deliveries recorded but never processed, oldest first.
 *
 * PENDING and FAILED both qualify: a row left PENDING is one whose process died
 * between recording and processing — the exact crash the durable inbox exists
 * to survive — and dropping it would make the inbox a log rather than a queue.
 *
 * Unattributed events (`clientId` null) are deliberately NOT returned. There is
 * no tenant to ingest them into, so retrying achieves nothing; they stay in the
 * table as the evidence of a half-finished onboarding.
 */
export async function listRetryableInboxEvents(
  ctx: EngineContext,
): Promise<PendingInboxEvent[]> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceInboxEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      clientId: { not: null },
      attempts: { lt: ctx.ports.maxInboxAttempts },
    },
    orderBy: { receivedAt: "asc" },
    take: ctx.ports.reconcileBatchSize,
    select: { id: true, clientId: true, provider: true, payload: true },
  })) as { id: string; clientId: string; provider: string; payload: unknown }[];
  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    provider: row.provider as MarketplaceProvider,
    payload: row.payload,
  }));
}
