import type { AcceptanceStatus, CancellationStatus } from "./acceptance";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * What the host's order reads need to draw a marketplace order: where its
 * aceite and its cancellation request stand, and where a person goes when the
 * API could not do it. One read for a batch, so a list stays one statement.
 */
export interface MarketplaceOrderState {
  orderId: string;
  provider: MarketplaceProvider;
  externalOrderId: string;
  externalDisplayId: string | null;
  status: AcceptanceStatus;
  confirmedAt: Date | null;
  confirmFailedAt: Date | null;
  cancellation: CancellationStatus | null;
  cancellationReasonCode: string | null;
  /** The adapter's app link, or null when no adapter is registered for it. */
  appUrl: string | null;
}

interface StateRow {
  orderId: string;
  provider: string;
  externalOrderId: string;
  externalDisplayId: string | null;
  status: string;
  confirmedAt: Date | null;
  confirmFailedAt: Date | null;
  cancellationStatus: string | null;
  cancellationReasonCode: string | null;
}

/** The state of each of these orders that is a marketplace order, keyed by id. */
export async function readOrderStates(
  ctx: EngineContext,
  clientId: string,
  orderIds: readonly string[],
): Promise<Map<string, MarketplaceOrderState>> {
  if (orderIds.length === 0) return new Map();
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceAcceptance.findMany({
    where: { clientId, orderId: { in: [...orderIds] } },
    select: {
      orderId: true,
      provider: true,
      externalOrderId: true,
      externalDisplayId: true,
      status: true,
      confirmedAt: true,
      confirmFailedAt: true,
      cancellationStatus: true,
      cancellationReasonCode: true,
    },
  })) as StateRow[];
  return new Map(
    rows.map((row) => {
      const adapter = ctx.registry.get(row.provider);
      const state: MarketplaceOrderState = {
        orderId: row.orderId,
        provider: row.provider,
        externalOrderId: row.externalOrderId,
        externalDisplayId: row.externalDisplayId,
        status: row.status as AcceptanceStatus,
        confirmedAt: row.confirmedAt,
        confirmFailedAt: row.confirmFailedAt,
        cancellation: row.cancellationStatus as CancellationStatus | null,
        cancellationReasonCode: row.cancellationReasonCode,
        appUrl: adapter ? adapter.appLink(row) : null,
      };
      return [row.orderId, state];
    }),
  );
}
