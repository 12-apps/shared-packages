import type { EngineContext, MarketplaceDb } from "./ports";

/**
 * One marketplace store, one live connection (FUT-5613).
 *
 * The app's single webhook address finds the store a delivery belongs to by
 * the merchant id it names, so a merchant id held by two live connections of
 * one marketplace would hand one store's orders to another. Every write that
 * sets or revives a merchant id refuses one another store's live connection
 * holds, and the migration's partial unique index
 * (`marketplace_integrations_live_merchant_key`) closes the race between the
 * check and the write: the loser's unique violation reads as the same refusal.
 */

/** Thrown by a single save whose merchant id another store's live connection holds. */
export class MarketplaceMerchantTakenError extends Error {
  readonly code = "MERCHANT_TAKEN" as const;
  /** The field the refusal is about, as a problem path. */
  readonly path = ["externalMerchantId"] as const;
  constructor(provider: string, merchantId: string) {
    super(`The ${provider} merchant ${merchantId} is already held by another store's live connection.`);
    this.name = "MarketplaceMerchantTakenError";
  }
}

/** A unique violation, as Prisma (`P2002`) or Postgres (`23505`) reports it. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "23505";
}

/** Whether another store's live connection to this marketplace already holds this merchant. */
export async function merchantHeldElsewhere(
  db: MarketplaceDb,
  clientId: string,
  provider: string,
  merchantId: string,
): Promise<boolean> {
  const rows = (await db.marketplaceIntegration.findMany({
    where: { provider, externalMerchantId: merchantId, archivedAt: null },
    select: { clientId: true },
  })) as { clientId: string }[];
  return rows.some((row) => row.clientId !== clientId);
}

/** Throw {@link MarketplaceMerchantTakenError} when a write would set a merchant id another store's live connection holds. */
export async function assertMerchantFree(
  db: MarketplaceDb,
  clientId: string,
  provider: string,
  merchantId: string | null | undefined,
): Promise<void> {
  if (merchantId && (await merchantHeldElsewhere(db, clientId, provider, merchantId))) {
    throw new MarketplaceMerchantTakenError(provider, merchantId);
  }
}

/**
 * Run a write that sets `merchantId` on this store's connection. A unique
 * violation it raises is the merchant index's when, read again on a fresh
 * client (the write's transaction is gone), another store holds the merchant:
 * it is thrown as {@link MarketplaceMerchantTakenError}. Anything else is thrown
 * as it came.
 */
export async function guardMerchantClaim<T>(
  ctx: EngineContext,
  claim: { clientId: string; provider: string; merchantId: string | null | undefined },
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const { merchantId } = claim;
    if (!isUniqueViolation(error) || !merchantId) throw error;
    if (!(await merchantHeldElsewhere(await ctx.ports.db(), claim.clientId, claim.provider, merchantId))) throw error;
    throw new MarketplaceMerchantTakenError(claim.provider, merchantId);
  }
}

/**
 * Which tenant a delivery belongs to, resolved from the merchant id the
 * marketplace names.
 *
 * Matched against the column OUTSIDE the ciphertext, which is the whole reason
 * `externalMerchantId` lives there: attributing a delivery must not require
 * decrypting every store's secrets to find the match. A merchant two live
 * connections hold (rows a host wrote before the unique index) attributes to
 * nobody: picking one would hand one store's orders to another.
 */
export async function resolveTenantByMerchant(
  ctx: EngineContext,
  provider: string,
  externalMerchantId: string,
): Promise<string | null> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceIntegration.findMany({
    where: { provider, externalMerchantId, archivedAt: null },
    select: { clientId: true },
    take: 2,
  })) as { clientId: string }[];
  if (rows.length > 1) {
    ctx.ports.logger.warn(`marketplace: ${provider} merchant ${externalMerchantId} is held by several live connections`);
    return null;
  }
  return rows[0]?.clientId ?? null;
}
