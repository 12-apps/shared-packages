import type { CatalogueFailure } from "./catalogue-port";
import type { EngineContext, MarketplaceDb } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * The marketplace's id for a host category, found or created ONCE per
 * (connection, name) and reused (FUT-4768).
 *
 * A push marketplace issues its own category ids, so an adapter finds a
 * category by name and creates it when it is missing. Two products switched
 * on at once into a new category would each miss it and each create it,
 * leaving two categories of the same name in front of the buyer. So the engine
 * stores the id, and the first publish to need it CLAIMS the creation: its
 * row holds the name with no id yet; a second publish meanwhile is told to
 * retry (the job's backoff), and finds the id stored when it does. A claim
 * whose publish died is taken over once it is older than {@link CLAIM_STALE_MS}.
 */

/** A claim older than this was left by a publish that died; another takes it over. */
export const CLAIM_STALE_MS = 2 * 60_000;

type CategoryTable = NonNullable<MarketplaceDb["marketplaceCatalogueCategory"]>;

interface CategoryRow {
  externalId: string | null;
}

/** Take the creation of this category, or learn someone else holds it. */
async function claim(table: CategoryTable, key: Record<string, string>, row: CategoryRow | null, now: Date): Promise<boolean> {
  if (!row) {
    try {
      await table.create({ data: { ...key, claimedAt: now } });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return false;
      throw error;
    }
  }
  const stale = new Date(now.getTime() - CLAIM_STALE_MS);
  const moved = await table.updateMany({
    where: { ...key, externalId: null, OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }] },
    data: { claimedAt: now },
  });
  return moved.count > 0;
}

/**
 * The category's id: the stored one, else `resolve()` (the adapter's find or
 * create) run under this publish's claim and stored. A host without the
 * category table resolves every time, unserialized, as before it.
 */
export async function resolveCategory(
  ctx: EngineContext,
  connection: { clientId: string; provider: MarketplaceProvider },
  name: string,
  resolve: () => Promise<{ id: string } | CatalogueFailure>,
): Promise<{ id: string } | CatalogueFailure> {
  const table = (await ctx.ports.db()).marketplaceCatalogueCategory;
  if (!table) return resolve();
  const key = { clientId: connection.clientId, provider: connection.provider, name: name.trim() };
  const row = (await table.findFirst({ where: key, select: { externalId: true } })) as CategoryRow | null;
  if (row?.externalId) return { id: row.externalId };
  const now = ctx.ports.clock.now();
  if (!(await claim(table, key, row, now))) {
    return { kind: "retry", reason: `another publish is creating the category "${key.name}"` };
  }
  const result = await resolve();
  const resolved = "id" in result;
  await table.updateMany({
    where: { ...key, externalId: null },
    data: resolved ? { externalId: result.id, claimedAt: null } : { claimedAt: null },
  });
  return result;
}
