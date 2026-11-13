import { forgetCategory, resolveCategory, type CategoryRunState } from "./catalogue-category";
import type { CatalogueCallContext, CatalogueWarningCode } from "./catalogue-port";
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

/**
 * Why a row FAILED, as a code the host turns into its own words. Vocabulary,
 * not copy: the engine writes no sentence a person reads.
 *
 * - `REFUSED` — the marketplace said no; its own words are in `failureReason`.
 * - `UNAVAILABLE` — no usable answer on any attempt (5xx, 429, timeouts).
 * - `TIMEOUT` — still on its way a day later (the sweep gave up).
 * - `NOT_CONNECTED` — no live connection with a merchant id (archived, removed).
 * - `CREDENTIALS` — no credentials on file, or they would not open.
 * - `PRODUCT_GONE` — the host's catalogue no longer has the product.
 * - `UNSUPPORTED` — the marketplace has no catalogue capability any more.
 * - `INTERNAL` — the engine or the adapter threw (logged, never shown).
 */
export type CatalogueFailureCode =
  | "REFUSED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "NOT_CONNECTED"
  | "CREDENTIALS"
  | "PRODUCT_GONE"
  | "UNSUPPORTED"
  | "INTERNAL";

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
  /** What the last successful publish could not do (the photo); null when it did everything. */
  warningCode: CatalogueWarningCode | null;
  failedAction: CatalogueFailedAction | null;
  /** Why it FAILED; null unless FAILED. The host's copy is keyed by it. */
  failureCode: CatalogueFailureCode | null;
  /**
   * The marketplace's OWN words for a `REFUSED` (its answer's body, truncated);
   * null for every other code. Never an engine or internal message.
   */
  failureReason: string | null;
  requestedAt: Date;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
  failedAt: Date | null;
}

/** A publication row, with the engine's own columns. */
export interface CatalogueRow extends CataloguePublicationView {
  id: string;
  clientId: string;
  imageRef: string | null;
  imageSourceUrl: string | null;
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
  imageRef: true,
  imageSourceUrl: true,
  warningCode: true,
  failedAction: true,
  failureCode: true,
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
    warningCode: row.warningCode,
    failedAction: row.failedAction,
    failureCode: row.failureCode,
    failureReason: row.failureReason,
    requestedAt: row.requestedAt,
    publishedAt: row.publishedAt,
    withdrawnAt: row.withdrawnAt,
    failedAt: row.failedAt,
  };
}

/** The failure columns cleared, for every write that leaves FAILED. */
export const NO_FAILURE = { failedAction: null, failureCode: null, failureReason: null, failedAt: null } as const;

/** The longest failure reason a row keeps: the column is read by a person in a list. */
const REASON_LIMIT = 300;

export function truncateReason(reason: string): string {
  return reason.length > REASON_LIMIT ? reason.slice(0, REASON_LIMIT) : reason;
}

/** Why a connection cannot carry a catalogue call. */
export interface ConnectionProblem {
  problem: "NOT_CONNECTED" | "CREDENTIALS";
}

/**
 * Everything one catalogue call needs from the store's connection, or why it
 * cannot be used: NOT_CONNECTED (none, archived, no merchant id) or
 * CREDENTIALS (none on file, or they will not open).
 */
export async function catalogueConnection(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
  categoryState?: CategoryRunState,
): Promise<Omit<CatalogueCallContext, "now"> | ConnectionProblem> {
  const merchantId = await connectionMerchantId(ctx, clientId, provider);
  if (merchantId === null) return { problem: "NOT_CONNECTED" };
  try {
    const connection = await readOutboundConnection(ctx, clientId, provider);
    if (!connection) return { problem: "CREDENTIALS" };
    const catalogue = ctx.ports.catalogue;
    return {
      ...connection,
      http: ctx.ports.http,
      tokens: ctx.tokens,
      externalMerchantId: merchantId,
      loadImage: (url) => (catalogue ? catalogue.image(url) : Promise.resolve(null)),
      category: (name, resolve) => resolveCategory(ctx, { clientId, provider }, name, resolve, categoryState),
      forgetCategory: (name) => forgetCategory(ctx, { clientId, provider }, name),
    };
  } catch (error) {
    ctx.ports.logger.error(
      `marketplace.catalogue: ${provider} credentials of ${clientId} do not open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { problem: "CREDENTIALS" };
  }
}
