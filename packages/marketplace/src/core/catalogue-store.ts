import type { CatalogueCallContext } from "./catalogue-port";
import { connectionMerchantId, readOutboundConnection } from "./integration";
import type { EngineContext, MarketplaceDb } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * The catalogue publication's rows and the reads every catalogue path shares
 * (FUT-4768). The table is `marketplace_catalogue_publications`; its states
 * are the mechanism's vocabulary, never a language.
 */

/** Where one product stands in one marketplace's catalogue. */
export type CatalogueStatus = "PUBLISHING" | "PUBLISHED" | "WITHDRAWING" | "WITHDRAWN" | "FAILED";

/** Which action a FAILED row failed at. */
export type CatalogueFailedAction = "PUBLISH" | "WITHDRAW";

/** One publication as a host reads it. */
export interface CataloguePublicationView {
  provider: MarketplaceProvider;
  productId: string;
  status: CatalogueStatus;
  /** The store's price for this marketplace; null is "the store's own price". */
  priceCents: number | null;
  /** The price the last successful publish sent. */
  sentPriceCents: number | null;
  /** The marketplace's id for the item, from the last successful publish. */
  externalId: string | null;
  failedAction: CatalogueFailedAction | null;
  /** The marketplace's reason, as it answered; null unless FAILED. */
  failureReason: string | null;
  requestedAt: Date;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
  failedAt: Date | null;
}

/** A publication row, with the engine's own id. */
export interface CatalogueRow extends CataloguePublicationView {
  id: string;
  clientId: string;
}

export const CATALOGUE_ROW_SELECT = {
  id: true,
  clientId: true,
  provider: true,
  productId: true,
  status: true,
  priceCents: true,
  sentPriceCents: true,
  externalId: true,
  failedAction: true,
  failureReason: true,
  requestedAt: true,
  publishedAt: true,
  withdrawnAt: true,
  failedAt: true,
} as const;

/** The delegate, or null on a host that has not composed the catalogue model. */
export type CatalogueTable = NonNullable<MarketplaceDb["marketplaceCataloguePublication"]>;

export async function catalogueTable(ctx: EngineContext): Promise<CatalogueTable | null> {
  return (await ctx.ports.db()).marketplaceCataloguePublication ?? null;
}

/** A row without the engine's own columns. */
export function viewOf(row: CatalogueRow): CataloguePublicationView {
  return {
    provider: row.provider,
    productId: row.productId,
    status: row.status,
    priceCents: row.priceCents,
    sentPriceCents: row.sentPriceCents,
    externalId: row.externalId,
    failedAction: row.failedAction,
    failureReason: row.failureReason,
    requestedAt: row.requestedAt,
    publishedAt: row.publishedAt,
    withdrawnAt: row.withdrawnAt,
    failedAt: row.failedAt,
  };
}

/** The longest failure reason a row keeps: the column is read by a person in a list. */
const REASON_LIMIT = 300;

export function truncateReason(reason: string): string {
  return reason.length > REASON_LIMIT ? reason.slice(0, REASON_LIMIT) : reason;
}

/**
 * Everything one catalogue call needs from the store's connection, or the
 * reason it cannot be used: none, archived, no credentials, no merchant id, or
 * credentials that will not open.
 */
export async function catalogueConnection(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
): Promise<Omit<CatalogueCallContext, "now"> | string> {
  const merchantId = await connectionMerchantId(ctx, clientId, provider);
  if (merchantId === null) return "no live connection with a merchant id";
  try {
    const connection = await readOutboundConnection(ctx, clientId, provider);
    if (!connection) return "no credentials on file";
    const catalogue = ctx.ports.catalogue;
    return {
      ...connection,
      http: ctx.ports.http,
      tokens: ctx.tokens,
      externalMerchantId: merchantId,
      loadImage: (url) => (catalogue ? catalogue.image(url) : Promise.resolve(null)),
    };
  } catch (error) {
    return `credentials do not open: ${error instanceof Error ? error.message : String(error)}`;
  }
}
