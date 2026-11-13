import { catalogueDedupeKey, enqueueCatalogue, type CatalogueJobPayload } from "./catalogue-job";
import type { CatalogueMenuEntry, CatalogueMenuOptions } from "./catalogue-port";
import {
  CATALOGUE_ROW_SELECT,
  NO_FAILURE,
  catalogueConnection,
  catalogueTable,
  viewOf,
  type CataloguePublicationView,
  type CatalogueRow,
  type CatalogueTable,
} from "./catalogue-store";
import { connectionMerchantId } from "./integration";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * Catalogue publishing, as a host calls it (FUT-4768): from a product's page,
 * the store turns the product ON (`publish`) or OFF (`withdraw`) per connected
 * marketplace, with an optional price for that marketplace, and reads where
 * each stands (`catalogueState`, one read for a whole page).
 *
 * Nothing here calls a marketplace: a publish or withdraw stamps the row and
 * queues `marketplace.catalogue`, whose job makes the call. The host's product
 * is read through its `catalogue` port, never from a host table, and only the
 * job reads it for sending, so what goes out is the product as it is then.
 */

/** Why a catalogue call was refused before anything was stamped. Vocabulary, not copy. */
export type CatalogueRefusalCode =
  /** The marketplace has no catalogue capability, or the host bound no catalogue port or table. */
  | "UNSUPPORTED"
  /** No live connection with credentials and a merchant id. */
  | "NOT_CONNECTED"
  /** The host's catalogue does not have this product. */
  | "UNKNOWN_PRODUCT"
  /** The price for the marketplace is not a positive integer of the smallest unit. */
  | "INVALID_PRICE";

/** What `publish` and `withdraw` answer. */
export type CatalogueActionResult =
  /** Stamped and queued (or already on its way: a double tap is this, with nothing new queued). */
  | { kind: "queued"; publication: CataloguePublicationView }
  /** Nothing to do: the product is not in that marketplace's catalogue, or was never there. */
  | { kind: "unchanged"; publication: CataloguePublicationView | null }
  | { kind: "refused"; code: CatalogueRefusalCode };

/** What a pull marketplace's menu document read answers. */
export type CatalogueDocumentResult =
  | { kind: "document"; document: unknown }
  | { kind: "refused"; code: Exclude<CatalogueRefusalCode, "UNKNOWN_PRODUCT" | "INVALID_PRICE"> };

/** One product on one marketplace. */
export interface CatalogueTarget {
  clientId: string;
  provider: MarketplaceProvider;
  productId: string;
}

/** A publish: the target, and the price for this marketplace — absent keeps the stored one, null is the store's. */
export interface CataloguePublishInput extends CatalogueTarget {
  priceCents?: number | null;
}

const refused = (code: CatalogueRefusalCode): CatalogueActionResult => ({ kind: "refused", code });

/** The table, or why the catalogue cannot be used at all for this marketplace. */
async function usableTable(ctx: EngineContext, provider: string): Promise<CatalogueTable | null> {
  if (!ctx.ports.catalogue || !ctx.registry.get(provider)?.catalogue) return null;
  return catalogueTable(ctx);
}

async function findRow(table: CatalogueTable, target: CatalogueTarget): Promise<CatalogueRow | null> {
  return (await table.findFirst({
    where: { clientId: target.clientId, provider: target.provider, productId: target.productId },
    select: CATALOGUE_ROW_SELECT,
  })) as CatalogueRow | null;
}

async function queue(ctx: EngineContext, row: CatalogueRow, action: CatalogueJobPayload["action"]): Promise<CatalogueActionResult> {
  const payload: CatalogueJobPayload = { clientId: row.clientId, publicationId: row.id, action };
  await enqueueCatalogue(ctx, payload, catalogueDedupeKey(payload, row.requestedAt));
  ctx.ports.publishChanged(row.clientId);
  return { kind: "queued", publication: viewOf(row) };
}

const validPrice = (price: number | null | undefined): boolean =>
  price === undefined || price === null || (Number.isInteger(price) && price > 0);

/** Why a publish cannot be asked, or null. */
async function publishRefusal(ctx: EngineContext, input: CataloguePublishInput): Promise<CatalogueRefusalCode | null> {
  if (!validPrice(input.priceCents)) return "INVALID_PRICE";
  if ("problem" in (await catalogueConnection(ctx, input.clientId, input.provider))) return "NOT_CONNECTED";
  const items = await ctx.ports.catalogue?.items(input.clientId, [input.productId]);
  return items?.has(input.productId) ? null : "UNKNOWN_PRODUCT";
}

/**
 * Put the product in the marketplace's catalogue, or send it again (a new
 * price, a retry after FAILED). A double tap while it is on its way keeps the
 * same ask and queues nothing new.
 */
export async function publishToCatalogue(ctx: EngineContext, input: CataloguePublishInput): Promise<CatalogueActionResult> {
  const table = await usableTable(ctx, input.provider);
  if (!table) return refused("UNSUPPORTED");
  const refusal = await publishRefusal(ctx, input);
  if (refusal) return refused(refusal);
  const existing = await findRow(table, input);
  const now = ctx.ports.clock.now();
  const price = input.priceCents === undefined ? {} : { priceCents: input.priceCents };
  // A double tap keeps the ask on its way; a NEW price is a new ask, so the
  // run already queued (which reads the row's price at its own instant) misses
  // its stamp and the new run sends the new price.
  const samePrice = input.priceCents === undefined || input.priceCents === existing?.priceCents;
  const asked = existing?.status === "PUBLISHING" && samePrice ? {} : { requestedAt: now };
  const row = (await table.upsert({
    where: { clientId_provider_productId: { clientId: input.clientId, provider: input.provider, productId: input.productId } },
    create: { clientId: input.clientId, provider: input.provider, productId: input.productId, status: "PUBLISHING", requestedAt: now, ...price },
    update: { status: "PUBLISHING", ...NO_FAILURE, ...asked, ...price },
    select: CATALOGUE_ROW_SELECT,
  })) as CatalogueRow;
  return queue(ctx, row, "publish");
}

/**
 * Take the product out of the marketplace's catalogue. A product never
 * switched on (no row, or WITHDRAWN) is `unchanged`; a double tap while it is
 * on its way out queues nothing new; a withdraw while a publish is on its way
 * wins (the job re-withdraws a publish that lands after it).
 *
 * A withdraw is SENT even after a publish that FAILED: a call whose answer was
 * lost may have put the item there, and a marketplace answers a withdraw of
 * an item it does not have as done. Only a store with no live connection any
 * more (archived, removed) ends WITHDRAWN at once: there is nobody to tell.
 */
export async function withdrawFromCatalogue(ctx: EngineContext, target: CatalogueTarget): Promise<CatalogueActionResult> {
  const table = await usableTable(ctx, target.provider);
  if (!table) return refused("UNSUPPORTED");
  const existing = await findRow(table, target);
  if (!existing || existing.status === "WITHDRAWN") return { kind: "unchanged", publication: existing && viewOf(existing) };
  if (existing.status === "WITHDRAWING") return queue(ctx, existing, "withdraw");
  const now = ctx.ports.clock.now();
  // No live connection (archived, removed): nothing to tell, so it is out here and now.
  const local = (await connectionMerchantId(ctx, target.clientId, target.provider)) === null;
  const data = local
    ? { status: "WITHDRAWN", withdrawnAt: now, requestedAt: now, ...NO_FAILURE }
    : { status: "WITHDRAWING", requestedAt: now, ...NO_FAILURE };
  const moved = await table.updateMany({ where: { id: existing.id, status: existing.status }, data });
  // Lost a race with another write: answer what the row now says.
  const row = (await findRow(table, target)) ?? existing;
  if (moved.count === 0 || local) {
    ctx.ports.publishChanged(target.clientId);
    return { kind: "unchanged", publication: viewOf(row) };
  }
  return queue(ctx, row, "withdraw");
}

/**
 * Where these products stand on these marketplaces, in ONE read: a product's
 * page asks for one product on every connected marketplace; a list asks for
 * many. Rows only for what was ever switched on.
 */
export async function readCatalogueState(
  ctx: EngineContext,
  input: { clientId: string; productIds: readonly string[]; providers?: readonly string[] },
): Promise<CataloguePublicationView[]> {
  const table = await catalogueTable(ctx);
  if (!table || input.productIds.length === 0) return [];
  const rows = (await table.findMany({
    where: {
      clientId: input.clientId,
      productId: { in: [...input.productIds] },
      ...(input.providers ? { provider: { in: [...input.providers] } } : {}),
    },
    select: CATALOGUE_ROW_SELECT,
  })) as CatalogueRow[];
  return rows.map(viewOf);
}

/** Every product a pull marketplace's menu lists: switched on, or on its way. */
const IN_MENU = ["PUBLISHING", "PUBLISHED"];

/**
 * The menu part of the document a pull marketplace reads, for the host to
 * serve (merged into the rest of that document, which is the host's). Built
 * from every product switched on for the connection, read through the host's
 * catalogue port; a product that no longer exists is left out.
 */
export async function readCatalogueDocument(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; options: CatalogueMenuOptions },
): Promise<CatalogueDocumentResult> {
  const catalogue = ctx.registry.get(input.provider)?.catalogue;
  const table = await usableTable(ctx, input.provider);
  if (!table || catalogue?.mode !== "pull") return { kind: "refused", code: "UNSUPPORTED" };
  const connection = await catalogueConnection(ctx, input.clientId, input.provider);
  if ("problem" in connection) return { kind: "refused", code: "NOT_CONNECTED" };
  const rows = (await table.findMany({
    where: { clientId: input.clientId, provider: input.provider, status: { in: IN_MENU } },
    select: CATALOGUE_ROW_SELECT,
    orderBy: { createdAt: "asc" },
  })) as CatalogueRow[];
  const items = (await ctx.ports.catalogue?.items(input.clientId, rows.map((row) => row.productId))) ?? new Map();
  const entries: CatalogueMenuEntry[] = rows.flatMap((row) => {
    const item = items.get(row.productId);
    if (!item) return [];
    return [{ ...item, priceCents: row.priceCents ?? item.priceCents, ref: row.id, productId: row.productId, externalId: row.externalId }];
  });
  const document = catalogue.menuDocument({ externalMerchantId: connection.externalMerchantId, entries, options: input.options });
  return { kind: "document", document };
}
