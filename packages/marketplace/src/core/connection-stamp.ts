import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * What a call no person made says about a connection's credentials (the order
 * fetch, FUT-5800): refused, or working again. Each stamp is guarded on the
 * sealed credentials the call was made with, as `./link-store.ts`'s
 * `markLinkFailed` is, so a call made with credentials since replaced never
 * judges the new ones.
 */

/**
 * The marketplace refused this connection's credentials on a call no person
 * made (the order fetch, FUT-5800): the connection reads FAILED, which is what
 * the connections screen shows, and the staff surfaces are told. Only the
 * credentials the call was made with (`sealed`) are judged: a store that
 * entered new ones meanwhile is left alone. Re-entering the credentials resets
 * it to UNVERIFIED; the next fetch that succeeds, to VERIFIED
 * ({@link markCredentialsAccepted}). Best-effort: never throws.
 */
export async function markCredentialsRefused(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; sealed: string },
): Promise<void> {
  await stampConnection(ctx, input, { archivedAt: null }, { status: "FAILED" });
}

/**
 * A call with these credentials (`sealed`) succeeded: a connection that read
 * FAILED for them reads VERIFIED again. Any other status is left as it is.
 * Best-effort: never throws.
 */
export async function markCredentialsAccepted(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; sealed: string },
): Promise<void> {
  await stampConnection(ctx, input, { status: "FAILED" }, { status: "VERIFIED", lastVerifiedAt: ctx.ports.clock.now() });
}

/** One guarded status write on the connection the call was made with; tells the staff surfaces when it moved. */
async function stampConnection(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; sealed: string },
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<void> {
  const { clientId, provider, sealed } = input;
  try {
    const db = await ctx.ports.db();
    const { count } = await db.marketplaceIntegration.updateMany({
      where: { clientId, provider, credentials: sealed, ...where },
      data,
    });
    if (count > 0) ctx.ports.publishChanged(clientId);
  } catch (error) {
    ctx.ports.logger.error(
      `marketplace: ${provider} connection of ${clientId} not stamped ${String(data.status)}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
