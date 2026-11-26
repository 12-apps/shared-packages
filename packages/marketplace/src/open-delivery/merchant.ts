import { answered, outboundResultOf, type AdapterCallContext, type OutboundResult } from "../core/adapter";
import { stableUuid } from "../core/catalogue-ids";
import type { CatalogueMenuEntry, CatalogueMenuOptions } from "../core/catalogue-port";
import type { MarketplaceAvailability } from "../core/pause-port";
import { isStop, openDeliveryCall, type OpenDeliveryDialect } from "./client";

/**
 * The MERCHANT half every Open Delivery adapter shares: the menu part of the
 * `Merchant` document the host serves (`GET /v1/merchant`, PULL: FUT-4768),
 * the `merchantUpdate` notification, and the store pause built on it
 * (FUT-4851). Where a marketplace puts `merchantUpdate` and what it sends
 * with it is its adapter folder's.
 *
 * Every id in the document is a UUID the software generates (the standard's
 * `format: uuid`), derived from the publication's stable reference, so the
 * same product keeps the same ids across pulls.
 */

/** One category per host category name, in first-seen order. */
function categoriesOf(merchantId: string, entries: readonly CatalogueMenuEntry[]) {
  const byName = new Map<string, { id: string; name: string; offers: string[] }>();
  for (const entry of entries) {
    const name = entry.categoryName.trim();
    const category = byName.get(name) ?? { id: stableUuid(`${merchantId}:category:${name}`), name, offers: [] };
    category.offers.push(stableUuid(`${entry.ref}:offer`));
    byName.set(name, category);
  }
  return [...byName.values()];
}

/**
 * The menu part of Open Delivery's `Merchant`: `menus`, `categories`,
 * `items`, `itemOffers` (the price lives on the offer). Every item is a unit
 * (`UN`) with a status, and every offer states `originalValue`: what both
 * v1.7.1 and Keeta's v1.5.0 require.
 */
export function openDeliveryMenuDocument(input: {
  externalMerchantId: string;
  entries: readonly CatalogueMenuEntry[];
  options: CatalogueMenuOptions;
}) {
  const { externalMerchantId: merchantId, entries, options } = input;
  const categories = categoriesOf(merchantId, entries);
  return {
    menus: [
      {
        id: stableUuid(`${merchantId}:menu`),
        name: options.menuName,
        externalCode: "menu",
        categoryId: categories.map((category) => category.id),
      },
    ],
    categories: categories.map((category, index) => ({
      id: category.id,
      index,
      name: category.name,
      externalCode: category.name,
      status: "AVAILABLE",
      itemOfferId: category.offers,
    })),
    items: entries.map((entry) => ({
      id: stableUuid(`${entry.ref}:item`),
      name: entry.name,
      description: entry.description ?? "",
      externalCode: entry.productId,
      status: "AVAILABLE",
      unit: "UN",
      ...(entry.imageUrl === null ? {} : { image: { URL: entry.imageUrl } }),
    })),
    itemOffers: entries.map((entry, index) => {
      const value = Math.round(entry.priceCents) / 100;
      return {
        id: stableUuid(`${entry.ref}:offer`),
        itemId: stableUuid(`${entry.ref}:item`),
        index,
        status: "AVAILABLE",
        price: { value, originalValue: value, currency: options.currency },
      };
    }),
  };
}

/** One `merchantUpdate` call, where and with what the marketplace takes it. */
export interface OpenDeliveryMerchantUpdate {
  /** From the base: `/v1/merchantUpdate`, or a marketplace's own (Keeta's names the merchant). */
  path: string;
  /** Absent: the empty body that means "pull the whole merchant again". */
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
}

/** `POST {merchantUpdate}`: 2xx accepted (the standard answers 204, 200 "for compatibility"). */
export function openDeliveryMerchantUpdate(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  update: OpenDeliveryMerchantUpdate,
): Promise<OutboundResult> {
  return answered(async () => {
    const response = await openDeliveryCall(ctx, dialect, {
      method: "POST",
      path: update.path,
      ...(update.body === undefined ? {} : { body: update.body }),
      ...(update.headers === undefined ? {} : { headers: update.headers }),
    });
    return isStop(response) ? response : outboundResultOf(response);
  });
}

/**
 * The store pause on `merchantUpdate`'s `merchantStatus` (`AVAILABLE` /
 * `UNAVAILABLE`): a SWITCH, with no id and no end ("you don't know when the
 * service will be re-established"), so an adapter offers it only when its
 * host opts in (see `../core/pause-port.ts`).
 */
export function openDeliverySwitchAvailability(
  setStatus: (ctx: AdapterCallContext, merchantId: string, status: "AVAILABLE" | "UNAVAILABLE") => Promise<OutboundResult>,
): MarketplaceAvailability {
  return {
    kind: "switch",
    pause: async (ctx, request) => {
      const result = await setStatus(ctx, request.merchantId, "UNAVAILABLE");
      return result.kind === "accepted" ? { kind: "paused", externalId: null, until: request.until } : result;
    },
    resume: (ctx, ref) => setStatus(ctx, ref.merchantId, "AVAILABLE"),
  };
}
