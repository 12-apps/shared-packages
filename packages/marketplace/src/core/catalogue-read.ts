import type { CatalogueReadResult } from "./catalogue-read-port";
import { connectionMerchantId, readOutboundConnection } from "./integration";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * Reading the menu a store keeps on a marketplace, as a host calls it
 * (FUT-951): through the store's OWN connection (its merchant id and its
 * sealed credentials), with the adapter's `catalogueReader`. Nothing is
 * stamped or queued: the read is a question the host asks while the store
 * waits, and it answers the snapshot or why there is none.
 */
export async function readMarketplaceCatalogue(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; now?: Date },
): Promise<CatalogueReadResult> {
  const reader = ctx.registry.get(input.provider)?.catalogueReader;
  if (!reader) return engineRefusal("UNSUPPORTED");
  const merchantId = await connectionMerchantId(ctx, input.clientId, input.provider);
  if (merchantId === null) return engineRefusal("NOT_CONNECTED");
  let connection: Awaited<ReturnType<typeof readOutboundConnection>>;
  try {
    connection = await readOutboundConnection(ctx, input.clientId, input.provider);
  } catch (error) {
    ctx.ports.logger.error(
      `marketplace.catalogue-read: ${input.provider} credentials of ${input.clientId} do not open: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return engineRefusal("CREDENTIALS");
  }
  if (!connection) return engineRefusal("CREDENTIALS");
  try {
    return await reader.read({
      ...connection,
      http: ctx.ports.http,
      tokens: ctx.tokens,
      now: input.now ?? ctx.ports.clock.now(),
      externalMerchantId: merchantId,
    });
  } catch (error) {
    // The port says an adapter never throws; one that does is asked again later, not crashed on.
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

const engineRefusal = (code: "UNSUPPORTED" | "NOT_CONNECTED" | "CREDENTIALS"): CatalogueReadResult => ({
  kind: "refused",
  code,
  status: null,
  message: null,
});
