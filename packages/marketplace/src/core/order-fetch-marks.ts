import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * A cancellation that outran its order's body.
 *
 * For a marketplace whose events only announce an order (`fetchOrder`), the
 * marketplace's CANCELLED can arrive while the fetch is still queued, held or
 * retrying, and the fetched body (Open Delivery's `Order` has no status) cannot
 * say the order was cancelled. For a marketplace whose webhook carries the
 * order, the same happens when the NEW_ORDER FAILED first: the retry sweep
 * re-runs that row after the CANCELLED. Without a trace either path would
 * ingest a cancelled order, send it to the kitchen and confirm it.
 *
 * So when a cancellation finds no acceptance to cancel, it leaves a MARKER, for
 * every adapter: an IGNORED inbox row under a key derived from the order
 * (`engine:cancelled:<id>`), found again through the inbox's own unique
 * `(provider, eventId)` index, with no new column or table. The fetch and the
 * carried ingest read it before they ingest.
 */

/** The settled reason of a row that was not ingested because its order was cancelled first. */
export const CANCELLED_BEFORE_INGEST_REASON = "cancelled before its order body arrived";

const MARKER_TYPE = "ENGINE_CANCELLED_BEFORE_INGEST";

const markerId = (externalOrderId: string): string => `engine:cancelled:${externalOrderId}`;

/** Leave the marker, for any adapter. Idempotent. */
export async function markCancelledBeforeIngest(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; externalOrderId: string },
): Promise<void> {
  const db = await ctx.ports.db();
  try {
    await db.marketplaceInboxEvent.create({
      data: {
        clientId: input.clientId,
        provider: input.provider,
        eventId: markerId(input.externalOrderId),
        eventType: MARKER_TYPE,
        externalOrderId: input.externalOrderId,
        payload: {},
        status: "IGNORED",
        error: "cancelled before the order was ingested",
        receivedAt: ctx.ports.clock.now(),
        processedAt: ctx.ports.clock.now(),
      },
      select: { id: true },
    });
  } catch (error) {
    // A redelivered cancellation: the marker is already there.
    if ((error as { code?: string }).code !== "P2002") throw error;
  }
}

/** Whether this store's order was cancelled before it was ingested. */
export async function cancelledBeforeIngest(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; externalOrderId: string },
): Promise<boolean> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceInboxEvent.findUnique({
    where: { provider_eventId: { provider: input.provider, eventId: markerId(input.externalOrderId) } },
    select: { clientId: true },
  })) as { clientId: string | null } | null;
  return row !== null && row.clientId === input.clientId;
}
