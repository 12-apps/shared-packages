import type { EngineContext } from "./ports";
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
 * is theirs (`order.catalogHas`) and stores it; what the id MEANS is the host's.
 */

/** A link as every read surface sees it. */
export interface MarketplaceMenuLinkView {
  id: string;
  provider: MarketplaceProvider;
  externalSku: string;
  externalName: string;
  /** The host catalog id, or null while the SKU is unmapped. */
  menuItemId: string | null;
  lastSeenAt: Date;
}

const LINK_SELECT = {
  id: true,
  provider: true,
  externalSku: true,
  externalName: true,
  menuItemId: true,
  lastSeenAt: true,
} as const;

interface LinkRow {
  id: string;
  provider: string;
  externalSku: string;
  externalName: string | null;
  menuItemId: string | null;
  lastSeenAt: Date;
}

function toView(row: LinkRow): MarketplaceMenuLinkView {
  return {
    id: row.id,
    provider: row.provider as MarketplaceProvider,
    externalSku: row.externalSku,
    externalName: row.externalName ?? row.externalSku,
    menuItemId: row.menuItemId,
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
  input: { clientId: string; provider?: MarketplaceProvider; unmappedOnly?: boolean },
): Promise<MarketplaceMenuLinkView[]> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceMenuLink.findMany({
    where: {
      clientId: input.clientId,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.unmappedOnly ? { menuItemId: null } : {}),
    },
    select: LINK_SELECT,
    orderBy: { lastSeenAt: "desc" },
  })) as LinkRow[];
  return rows.map(toView);
}

/**
 * Point an external SKU at one of the store's catalog rows, or unmap it.
 *
 * Returns `null` when the catalog id is not this tenant's — a VALUE rather than
 * a thrown error with a message, because the message would be copy and copy in
 * a package is a language chosen for every host that mounts it. The host turns
 * the null into whatever its API says "not found" looks like.
 *
 * Creates the link if the SKU has never been seen: an operator mapping ahead of
 * the first order is doing the right thing, and refusing them would make the
 * feature reactive by construction.
 */
export async function setMarketplaceMenuLink(
  ctx: EngineContext,
  input: {
    clientId: string;
    provider: MarketplaceProvider;
    externalSku: string;
    externalName?: string;
    menuItemId: string | null;
  },
): Promise<MarketplaceMenuLinkView | null> {
  if (input.menuItemId && !(await ctx.ports.order.catalogHas(input.clientId, input.menuItemId))) {
    return null;
  }
  const db = await ctx.ports.db();
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
    },
    // `externalName` is NOT rewritten here. It is the marketplace's snapshot of
    // what it called the item, and an operator's typing is not a better record
    // of that than the marketplace's own text.
    update: { menuItemId: input.menuItemId },
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
  ctx: EngineContext,
  input: {
    clientId: string;
    provider: MarketplaceProvider;
    skus: { externalSku: string; name: string }[];
    seenAt: Date;
  },
): Promise<Map<string, string | null>> {
  const db = await ctx.ports.db();
  const resolved = new Map<string, string | null>();
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
      select: { menuItemId: true },
    })) as { menuItemId: string | null };
    resolved.set(sku.externalSku, row.menuItemId);
  }
  return resolved;
}
