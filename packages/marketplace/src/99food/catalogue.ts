import { answered, outboundResultOf, type OutboundResult } from "../core/adapter";
import { stableUuid } from "../core/catalogue-ids";
import type { CatalogueCallContext, CatalogueMenuEntry, CatalogueMenuOptions, PullCatalogue } from "../core/catalogue-port";
import { baseOf, bearer, tokenKey, type NinetyNineFoodApiBaseUrls } from "./outbound";

/**
 * The 99Food adapter's CATALOGUE half, on Open Delivery v1.7.1: PULL (FUT-4768).
 *
 * In Open Delivery the store's software does not write the menu to the
 * marketplace. The SOFTWARE SERVICE (the host) serves `GET /v1/merchant`, a
 * `Merchant` document carrying `menus`, `categories`, `items` and
 * `itemOffers` (the price lives on the offer), and the ORDERING APPLICATION
 * (99Food) pulls it, again when its `TTL` runs out or when told the merchant
 * changed (`POST /v1/merchantUpdate`, sent with an empty body: "pull
 * everything again"). Spec: https://abrasel-nacional.github.io/opendelivery/openapi.yaml
 *
 * So the adapter does two things: build the menu part of that document from
 * the items the store switched on (`menuDocument`, pure; the host merges it
 * into the rest of the `Merchant`, which is its own: `basicInfo`, `services`,
 * `lastUpdate`, `TTL`, `status`), and tell 99Food the menu changed
 * (`notifyMenuChanged`).
 *
 * ESTIMATED, to be checked once 99Food grants partner access:
 * - the path: the spec's route table and prose name `POST /merchantUpdate`
 *   (`/v1/merchantUpdate`), while its path key is `/v1/menuUpdated`; this
 *   sends the prose's;
 * - the `X-App-MerchantId` header on it: the operation lists none, and one
 *   client app may serve many merchants, so it is sent to name which;
 * - that 99Food reads the whole `Merchant` on that notification (scenario 1
 *   of the operation) rather than needing `entityType`/`updatedObjects`.
 *
 * Every id in the document is a UUID the software generates (the spec's
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

/** The menu part of Open Delivery's `Merchant`: `menus`, `categories`, `items`, `itemOffers`. */
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

/** `POST /v1/merchantUpdate` with no body: 99Food pulls the whole `Merchant` again. 200 or 204. */
async function notify(ctx: CatalogueCallContext, bases: NinetyNineFoodApiBaseUrls): Promise<OutboundResult> {
  const auth = await bearer(ctx, bases);
  if (!("token" in auth)) return auth;
  const response = await ctx.http({
    method: "POST",
    url: `${baseOf(ctx, bases)}/v1/merchantUpdate`,
    headers: { Authorization: `Bearer ${auth.token}`, "X-App-MerchantId": ctx.externalMerchantId },
  });
  if (response.status !== 401) return outboundResultOf(response);
  ctx.tokens.delete(tokenKey(ctx));
  return { kind: "retry", reason: "99Food refused the token" };
}

/** 99Food's catalogue capability, for the base URLs it was given. */
export function openDeliveryCatalogue(bases: NinetyNineFoodApiBaseUrls): PullCatalogue {
  return {
    mode: "pull",
    menuDocument: openDeliveryMenuDocument,
    notifyMenuChanged: (ctx) => answered(() => notify(ctx, bases)),
  };
}
