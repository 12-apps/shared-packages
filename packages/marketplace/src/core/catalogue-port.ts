import type { AdapterCallContext, OutboundResult } from "./adapter";

/**
 * The catalogue half of the adapter port (FUT-4768): a store turns one of its
 * products ON or OFF per connected marketplace, with an optional price for
 * that marketplace, and the engine keeps the marketplace's catalogue in step.
 *
 * Marketplaces differ in exactly one way that shapes the engine: who moves the
 * menu.
 *
 * - **push** — the store's software writes each item to the marketplace's API
 *   (iFood's Catalog API v2.0). The adapter publishes and withdraws ONE item.
 * - **pull** — the marketplace reads the menu from the store's software (Open
 *   Delivery's `GET /v1/merchant`, which 99Food implements). The adapter turns
 *   the published items into the marketplace's menu document, which the HOST
 *   serves, and tells the marketplace the menu changed.
 *
 * A marketplace whose adapter states no `catalogue` cannot be published to,
 * and the host says so (`engine.catalogueMode(provider)` is null). Everything
 * else — the publication record and its states, the job, its retries, the
 * sweep, the price rule — is the engine's and does not change with the
 * marketplace.
 */

/** One product as it goes out to a marketplace. The host maps its product into this shape. */
export interface CatalogueItem {
  name: string;
  description: string | null;
  /** An absolute https URL of the product's photo, or null. */
  imageUrl: string | null;
  /** The name of the host category the product sits in; the adapter finds or creates it. */
  categoryName: string;
  /** The store's own price, in the smallest currency unit. */
  priceCents: number;
}

/**
 * What the adapter is handed to publish: the host's item with `priceCents`
 * already the price for THIS marketplace (the connection's own price when the
 * store set one, else the store's), and the engine's stable reference.
 */
export interface CatalogueItemOut extends CatalogueItem {
  /**
   * The engine's stable id for this (connection, product) publication. The
   * same across retries and re-publishes, so an adapter that must invent the
   * marketplace's id (iFood wants a UUID it does not issue) derives it from
   * this and a lost answer never creates a second item.
   */
  ref: string;
  /** The host's product id: the item's external code on the marketplace. */
  productId: string;
  /** The marketplace's id from the last publish, or null before the first. */
  externalId: string | null;
}

/** What the adapter is handed to withdraw. */
export type CatalogueItemRef = Pick<CatalogueItemOut, "ref" | "productId" | "externalId">;

/** An image's bytes, for a marketplace that takes an upload rather than a URL. */
export interface CatalogueImage {
  contentType: string;
  /** The file, base64-encoded, no data-URL prefix. */
  base64: string;
}

/** An outbound call's answer when it is not a success: refused (final) or retry. */
export type CatalogueFailure = Exclude<OutboundResult, { kind: "accepted" }>;

/** What one catalogue call is handed: the outbound context plus the store's merchant id and the image loader. */
export interface CatalogueCallContext extends AdapterCallContext {
  /** The connection's merchant id on the marketplace. */
  externalMerchantId: string;
  /** The host's image loader: the bytes behind an item's `imageUrl`, or null when it cannot load them. */
  loadImage(url: string): Promise<CatalogueImage | null>;
  /**
   * The marketplace's id for the host category `name`: the one the engine
   * stored for this connection, else `resolve()` (the adapter's find-or-create)
   * run by ONE publish at a time and stored. A second publish into a category
   * being created is answered `retry`, so a new category is created once.
   */
  category(name: string, resolve: () => Promise<{ id: string } | CatalogueFailure>): Promise<{ id: string } | CatalogueFailure>;
}

/** A publish's answer: the marketplace's id for the item, or the refusal and retry shapes of every outbound call. */
export type CataloguePublishResult = { kind: "published"; externalId: string } | CatalogueFailure;

/** A marketplace the store's software writes to. */
export interface PushCatalogue {
  readonly mode: "push";
  /** Create or replace ONE item in the marketplace's catalogue, available for sale. Idempotent by `item.ref`. */
  publishItem(ctx: CatalogueCallContext, item: CatalogueItemOut): Promise<CataloguePublishResult>;
  /** Take ONE item out of the marketplace's catalogue. An item already absent is `accepted`. */
  withdrawItem(ctx: CatalogueCallContext, item: CatalogueItemRef): Promise<OutboundResult>;
}

/** One published item, as a pull marketplace's menu document lists it. */
export type CatalogueMenuEntry = CatalogueItemOut;

/** What the host states about the menu a pull marketplace reads: its words and money, never the engine's. */
export interface CatalogueMenuOptions {
  /** The menu's display name, in the store's language. */
  menuName: string;
  /** ISO 4217 code of the prices. */
  currency: string;
}

/** A marketplace that reads the menu from the store's software. */
export interface PullCatalogue {
  readonly mode: "pull";
  /**
   * The menu part of the document the marketplace pulls, built from every item
   * published to this connection. Pure and offline: the host serves it, merged
   * into whatever else that document carries (the store's own details).
   */
  menuDocument(input: {
    externalMerchantId: string;
    entries: readonly CatalogueMenuEntry[];
    options: CatalogueMenuOptions;
  }): unknown;
  /** Tell the marketplace the menu changed, so it pulls it again. */
  notifyMenuChanged(ctx: CatalogueCallContext): Promise<OutboundResult>;
}

/** The catalogue capability an adapter states, or leaves out. */
export type MarketplaceCatalogue = PushCatalogue | PullCatalogue;
