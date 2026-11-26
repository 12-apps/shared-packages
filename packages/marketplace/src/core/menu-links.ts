import type { EngineContext, MarketplaceDb } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * External SKU ↔ catalog mapping .
 *
 * The rule the whole module is built around: an unmapped SKU is a ROW, not an
 * absence. Every SKU an order has ever carried has a link row, mapped or not,
 * so the attention list is a query rather than a reconciliation, and mapping
 * one is an update on something the store can already see. Manual mapping
 * upkeep has to be visibly cheap or it does not happen — and a store that stops
 * doing it is a store quietly selling food it cannot make.
 *
 * The package never dereferences `menuItemId`. It asks the host whether the id
 * is theirs (`order.catalogHas`, in `./bulk.ts`) and stores it; what the id
 * MEANS is the host's.
 *
 * A link may narrow the mapping to ONE variation of that id (`variationId`,
 * FUT-4927): a marketplace SKU usually names one flavour or size, and the
 * host's order line is then the item plus that variation. `variationId` null
 * is the item alone, exactly as before it existed; it is never set without
 * `menuItemId`, and the host answers whether it belongs to the item
 * (`order.catalogHasVariation`).
 */

/** A link as every read surface sees it. */
export interface MarketplaceMenuLinkView {
  id: string;
  provider: MarketplaceProvider;
  externalSku: string;
  externalName: string;
  /** The host catalog id, or null while the SKU is unmapped. */
  menuItemId: string | null;
  /** The variation of `menuItemId` the SKU names, or null for the item alone. */
  variationId: string | null;
  lastSeenAt: Date;
}

/** What one SKU resolves to on the ingest path; both null while it is unmapped. */
interface ResolvedSku {
  menuItemId: string | null;
  variationId: string | null;
}

const LINK_SELECT = {
  id: true,
  provider: true,
  externalSku: true,
  externalName: true,
  menuItemId: true,
  variationId: true,
  lastSeenAt: true,
} as const;

interface LinkRow {
  id: string;
  provider: string;
  externalSku: string;
  externalName: string | null;
  menuItemId: string | null;
  variationId?: string | null;
  lastSeenAt: Date;
}

function toView(row: LinkRow): MarketplaceMenuLinkView {
  return {
    id: row.id,
    provider: row.provider as MarketplaceProvider,
    externalSku: row.externalSku,
    externalName: row.externalName ?? row.externalSku,
    menuItemId: row.menuItemId,
    // A row of a host whose client predates the column reads as the item alone.
    variationId: row.menuItemId === null ? null : (row.variationId ?? null),
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * A store's SKU map. `unmappedOnly` is the attention list.
 *
 * Ordered by `lastSeenAt` descending, which is the ordering that matters for
 * the unmapped half: a store fixing five mappings should fix the five that are
 * costing them money right now, not the five that happen to be oldest.
 */
export async function listMarketplaceMenuLinks(
  ctx: EngineContext,
  input: { clientId: string; provider?: MarketplaceProvider; unmappedOnly?: boolean; ids?: readonly string[] },
): Promise<MarketplaceMenuLinkView[]> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceMenuLink.findMany({
    where: {
      clientId: input.clientId,
      ...(input.ids ? { id: { in: [...input.ids] } } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.unmappedOnly ? { menuItemId: null } : {}),
    },
    select: LINK_SELECT,
    orderBy: { lastSeenAt: "desc" },
  })) as LinkRow[];
  return rows.map(toView);
}

/**
 * Point an external SKU at a catalog id, or unmap it, inside the caller's
 * transaction. The caller has already checked the id is this tenant's
 * (`order.catalogHas`). Creates the link if the SKU has never been seen: an
 * operator mapping ahead of the first order is doing the right thing.
 *
 * Every write sets BOTH halves: a mapping to the item alone (`variationId`
 * absent or null) clears a variation an earlier mapping named, and an unmap
 * clears both.
 */
export async function upsertLink(
  db: MarketplaceDb,
  input: {
    clientId: string;
    provider: MarketplaceProvider;
    externalSku: string;
    externalName?: string;
    menuItemId: string | null;
    variationId?: string | null;
  },
): Promise<MarketplaceMenuLinkView> {
  const variationId = input.menuItemId === null ? null : (input.variationId ?? null);
  const row = (await db.marketplaceMenuLink.upsert({
    where: {
      clientId_provider_externalSku: {
        clientId: input.clientId,
        provider: input.provider,
        externalSku: input.externalSku,
      },
    },
    create: {
      clientId: input.clientId,
      provider: input.provider,
      externalSku: input.externalSku,
      externalName: input.externalName ?? input.externalSku,
      menuItemId: input.menuItemId,
      variationId,
    },
    // `externalName` is NOT rewritten here. It is the marketplace's snapshot of
    // what it called the item, and an operator's typing is not a better record
    // of that than the marketplace's own text.
    update: { menuItemId: input.menuItemId, variationId },
    select: LINK_SELECT,
  })) as LinkRow;
  return toView(row);
}

/**
 * Resolve an order's SKUs to catalog ids, recording every one of them.
 *
 * Called on the ingestion path, so it does two jobs at once and both are
 * required: it answers what each SKU maps to, and it makes sure a row exists
 * for each — including the ones that map to nothing, which is how an unmapped
 * SKU reaches the attention list at all. Upserting on the ingest path is what
 * makes the list self-maintaining; a store never has to discover the gap by
 * reading a ticket.
 */
export async function resolveSkus(
  db: MarketplaceDb,
  input: {
    clientId: string;
    provider: MarketplaceProvider;
    skus: { externalSku: string; name: string }[];
    seenAt: Date;
  },
): Promise<Map<string, ResolvedSku>> {
  const resolved = new Map<string, ResolvedSku>();
  for (const sku of input.skus) {
    const row = (await db.marketplaceMenuLink.upsert({
      where: {
        clientId_provider_externalSku: {
          clientId: input.clientId,
          provider: input.provider,
          externalSku: sku.externalSku,
        },
      },
      create: {
        clientId: input.clientId,
        provider: input.provider,
        externalSku: sku.externalSku,
        externalName: sku.name,
        lastSeenAt: input.seenAt,
      },
      update: { lastSeenAt: input.seenAt },
      select: { menuItemId: true, variationId: true },
    })) as { menuItemId: string | null; variationId?: string | null };
    resolved.set(sku.externalSku, {
      menuItemId: row.menuItemId,
      variationId: row.menuItemId === null ? null : (row.variationId ?? null),
    });
  }
  return resolved;
}
