import type { AdapterCallContext } from "./adapter";

/**
 * The catalogue READ half of the adapter port (FUT-951): the menu a store
 * already keeps on a marketplace, read through the store's own connection, so
 * the host can import it (onboarding: "bring my menu over").
 *
 * The opposite direction of `catalogue-port.ts` and independent of it: an
 * adapter may read a menu it cannot publish to, or publish to one it cannot
 * read. Nothing here names a marketplace; each adapter maps its own catalogue
 * into the {@link CatalogueSnapshot} below.
 *
 * Money is integer cents of the menu's currency ({@link centsFromMajor}).
 * Nothing the adapter cannot map is dropped silently: a field it could not read
 * is a {@link CatalogueReadWarning} on the item, and an item or category it
 * could not read at all is a {@link CatalogueReadNotice} on the snapshot.
 */

/** Why part of an item could not be mapped. Vocabulary, not copy: the host words it. */
export type CatalogueReadWarningCode =
  /** The item carries no readable price: `priceCents` is null. */
  | "PRICE_MISSING"
  /** An option carries no readable price: its `priceDeltaCents` is null. */
  | "OPTION_PRICE_MISSING"
  /** A group of choices could not be read (no name, no options, bounds that make no sense): left out. */
  | "OPTION_GROUP_UNREADABLE"
  /** One choice of a group could not be read (no name): left out of its group. */
  | "OPTION_UNREADABLE"
  /** The photo reference is there but is not a path or URL the adapter can resolve: `photoUrl` is null. */
  | "PHOTO_UNREADABLE"
  /** The item is of a kind this reader maps only partly (a combo, a pizza by halves): read as a plain item. */
  | "ITEM_TYPE_UNSUPPORTED";

/** One thing about an item the read could not map. */
export interface CatalogueReadWarning {
  code: CatalogueReadWarningCode;
  /** The marketplace's id of the group or option concerned, or null when it is the item itself. */
  subject: string | null;
  /** What the marketplace sent, for a developer (never shown as copy). */
  detail: string | null;
}

/** One choice of a group: a size, a flavour, an add-on. */
export interface CatalogueSnapshotOption {
  externalId: string;
  /** The store's own code for it on the marketplace, when it set one. */
  externalCode: string | null;
  name: string;
  description: string | null;
  /** What choosing it adds to the item's price, in cents (0 = free); null when the marketplace sent none. */
  priceDeltaCents: number | null;
  photoUrl: string | null;
  available: boolean;
}

/** A group of choices on an item: "Size" (min 1, max 1), "Extras" (min 0, max 3). */
export interface CatalogueSnapshotOptionGroup {
  externalId: string;
  externalCode: string | null;
  name: string;
  /** At least this many choices (0 = optional). */
  min: number;
  /** At most this many choices (always >= `min` and >= 1). */
  max: number;
  available: boolean;
  options: CatalogueSnapshotOption[];
}

/** One item as the marketplace sells it. */
export interface CatalogueSnapshotItem {
  externalId: string;
  externalCode: string | null;
  name: string;
  description: string | null;
  /** The item's own price in cents; null when the marketplace sent none (with a PRICE_MISSING warning). */
  priceCents: number | null;
  /** An absolute https URL of the photo, or null when the item has none. */
  photoUrl: string | null;
  /** Whether the marketplace sells it now (a paused item is still read). */
  available: boolean;
  optionGroups: CatalogueSnapshotOptionGroup[];
  warnings: CatalogueReadWarning[];
}

/** One category, its items in the marketplace's order. */
export interface CatalogueSnapshotCategory {
  externalId: string;
  externalCode: string | null;
  name: string;
  available: boolean;
  items: CatalogueSnapshotItem[];
}

/** An item or a category the read could not map at all, said rather than dropped. */
export interface CatalogueReadNotice {
  code: "ITEM_UNREADABLE" | "CATEGORY_UNREADABLE";
  /** The category it was found in (the category itself for CATEGORY_UNREADABLE), or null when it had no id. */
  categoryExternalId: string | null;
  /** The item's id, when it had one; null for a category. */
  externalId: string | null;
  detail: string;
}

/** The store's menu on a marketplace, as read. */
export interface CatalogueSnapshot {
  categories: CatalogueSnapshotCategory[];
  notices: CatalogueReadNotice[];
}

/**
 * Why a read failed for good. Vocabulary, not copy.
 * - `UNSUPPORTED`: the marketplace's adapter states no catalogue read.
 * - `NOT_CONNECTED`: no live connection with a merchant id for that marketplace.
 * - `CREDENTIALS`: no credentials on file, they do not open, or the marketplace refused them.
 * - `NOT_AUTHORIZED`: the marketplace refused this merchant to this app (not
 *   authorized, the catalogue module not enabled, an unknown merchant id).
 * - `REFUSED`: any other final refusal.
 */
export type CatalogueReadRefusalCode = "UNSUPPORTED" | "NOT_CONNECTED" | "CREDENTIALS" | "NOT_AUTHORIZED" | "REFUSED";

/** What a read answers: the snapshot, a final refusal, or a failure worth asking again later (429, 5xx, a timeout). */
export type CatalogueReadResult =
  | { kind: "snapshot"; snapshot: CatalogueSnapshot }
  /** `status` and `message` are the marketplace's answer; null when the engine refused before calling. */
  | { kind: "refused"; code: CatalogueReadRefusalCode; status: number | null; message: string | null }
  | { kind: "retry"; reason: string };

/** What one catalogue read is handed: the outbound context plus the connection's merchant id. */
export interface CatalogueReadContext extends AdapterCallContext {
  externalMerchantId: string;
}

/** A marketplace whose menu can be read. */
export interface CatalogueReader {
  /** Read the whole menu. Never throws: a call with no answer is a `retry`. */
  read(ctx: CatalogueReadContext): Promise<CatalogueReadResult>;
}

/**
 * A price in the currency's MAJOR unit (`25.9`) as integer cents (`2590`), or
 * null when it is not a finite, non-negative number.
 *
 * Rounding is explicit: the product is first cut to 12 significant digits,
 * which removes binary floating-point error (`1.005 * 100` is
 * `100.49999999999999`), and then rounded half up to the cent (`1.005` →
 * `101`, `0.125` → `13`).
 */
export function centsFromMajor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(Number((value * 100).toPrecision(12)));
}
