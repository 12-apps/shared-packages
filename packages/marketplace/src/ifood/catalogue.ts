import {
  answered,
  outboundResultOf,
  type MarketplaceHttpResponse,
  type OutboundResult,
} from "../core/adapter";
import { stableUuid } from "../core/catalogue-ids";
import type {
  CatalogueCallContext,
  CatalogueItemOut,
  CatalogueItemRef,
  CataloguePublishResult,
  CatalogueStoredImage,
  CatalogueWarningCode,
  PushCatalogue,
} from "../core/catalogue-port";
import { IFOOD_API, bearer, ifoodTokenKey } from "./outbound";

/**
 * The iFood adapter's CATALOGUE half: iFood's Catalog API v2.0, push (FUT-4768).
 *
 * Read 2026-11-13 from iFood's developer portal (the Catalog module's
 * Introduction, Fundamentals, Endpoints and Errors pages, and the rate-limit
 * page); the package README's "Catalogue publishing" table marks each fact
 * CONFIRMED with its URL or ESTIMATED. What is ESTIMATED here is said beside
 * it, and lives in this file only, so the homologation run corrects one file.
 *
 * One publish is, in order:
 * 1. the category, by name: `GET /categories`, else `POST /categories`
 *    (`template: "DEFAULT"`);
 * 2. the photo, when the item has one: the `imagePath` iFood already holds
 *    for the same photo URL, else `POST /image/upload` with a base64 data URL
 *    of the bytes the host's loader reads, which answers `imagePath`;
 * 3. the item: `PUT /items` with `item`, `products`, `optionGroups`,
 *    `options` — idempotent, it replaces the whole item, and the item appears
 *    at once (synchronous).
 *
 * iFood wants item and product ids the software generates, UUID v4 (any other
 * shape answers 404), so they are derived from the engine's publication
 * reference: a retried publish names the same item. The item's `externalCode`
 * is the host's product id (unique per merchant).
 *
 * A withdraw pauses the item, `PATCH /items/status` with `UNAVAILABLE`: the
 * Endpoints page lists no item delete, and a paused item is not shown in the
 * app (ESTIMATED that this is what "off" should mean; a re-publish puts it
 * back AVAILABLE with the same id).
 */

const catalogUrl = (merchantId: string, path: string): string =>
  `${IFOOD_API}/catalog/v2.0/merchants/${encodeURIComponent(merchantId)}/${path}`;

/** The item's and its product's ids, stable per publication. */
export const ifoodItemId = (ref: string): string => stableUuid(`${ref}:item`);
export const ifoodProductId = (ref: string): string => stableUuid(`${ref}:product`);

type Failure = Exclude<OutboundResult, { kind: "accepted" }>;

/** iFood's price object: a decimal of the currency's major unit. */
const priceOf = (cents: number): { value: number } => ({ value: Math.round(cents) / 100 });

/** One authenticated call to the catalogue: the raw answer, or the failure that ends it. */
async function call(
  ctx: CatalogueCallContext,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
): Promise<MarketplaceHttpResponse | Failure> {
  const auth = await bearer(ctx);
  if (!("token" in auth)) return auth.kind === "accepted" ? { kind: "retry", reason: "unexpected token answer" } : auth;
  const response = await ctx.http({
    method,
    url: catalogUrl(ctx.externalMerchantId, path),
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status !== 401) return response;
  ctx.tokens.delete(ifoodTokenKey(ctx));
  return { kind: "retry", reason: "iFood refused the token" };
}

/** A non-2xx answer as the failure it is (never `accepted`). */
function failureOf(response: MarketplaceHttpResponse): Failure {
  const result = outboundResultOf(response);
  return result.kind === "accepted" ? { kind: "retry", reason: "unexpected answer" } : result;
}

const ok = (response: MarketplaceHttpResponse): boolean => response.status >= 200 && response.status < 300;

function parse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/** The id of the category named `name`, from a category list. ESTIMATED: the list answers an array of `{ id, name }`. */
function categoryIdIn(body: string, name: string): string | null {
  const parsed = parse(body);
  if (!Array.isArray(parsed)) return null;
  const wanted = name.trim().toLowerCase();
  const found = parsed.find(
    (entry: unknown) =>
      typeof entry === "object" && entry !== null && String((entry as { name?: unknown }).name ?? "").trim().toLowerCase() === wanted,
  ) as { id?: unknown } | undefined;
  return typeof found?.id === "string" ? found.id : null;
}

/** The category named `name` on iFood, or null; the failure that ended the read otherwise. */
async function findCategory(ctx: CatalogueCallContext, name: string): Promise<{ id: string | null } | Failure> {
  const listed = await call(ctx, "GET", "categories");
  if ("kind" in listed) return listed;
  if (!ok(listed)) return failureOf(listed);
  return { id: categoryIdIn(listed.body, name) };
}

/**
 * Find the category by name, else create it, then read the list again and
 * adopt the first of that name: a POST whose answer was lost and was retried
 * is found rather than created twice. The engine runs this once per
 * (connection, name) at a time and stores the id (`ctx.category`).
 */
async function findOrCreateCategory(ctx: CatalogueCallContext, name: string): Promise<{ id: string } | Failure> {
  const found = await findCategory(ctx, name);
  if ("kind" in found) return found;
  if (found.id) return { id: found.id };
  const created = await call(ctx, "POST", "categories", { name, status: "AVAILABLE", template: "DEFAULT" });
  if ("kind" in created) return created;
  if (!ok(created)) return failureOf(created);
  const id = (parse(created.body) as { id?: unknown } | null)?.id;
  if (typeof id !== "string") return { kind: "retry", reason: "iFood created the category without an id" };
  // ESTIMATED: the list answers categories in creation order, so the first match is the oldest.
  const again = await findCategory(ctx, name);
  return "id" in again && again.id ? { id: again.id } : { id };
}

const categoryId = (ctx: CatalogueCallContext, name: string): Promise<{ id: string } | Failure> =>
  ctx.category(name, () => findOrCreateCategory(ctx, name));

/** The photo the item goes out with, and what the publish could not do about it. */
interface PhotoOutcome {
  image: CatalogueStoredImage | null;
  warning?: CatalogueWarningCode;
}

/**
 * The photo for this publish, uploading only when it must:
 * - no `imageUrl`: no photo;
 * - the photo iFood already holds was made from this same URL: reuse it;
 * - else upload the bytes the host's loader reads; when it reads nothing,
 *   keep the photo iFood holds, if any (PUT replaces the whole item, so
 *   sending none would drop it);
 * - an upload iFood refuses (413 over 5 MB, another final 4xx) publishes
 *   without a photo and says why as a warning, rather than failing the item.
 */
async function photoFor(ctx: CatalogueCallContext, item: CatalogueItemOut): Promise<PhotoOutcome | Failure> {
  const stored = item.storedImage;
  if (item.imageUrl === null) return { image: null };
  if (stored && stored.sourceUrl === item.imageUrl) return { image: stored };
  const bytes = await ctx.loadImage(item.imageUrl);
  if (!bytes) return { image: stored };
  const uploaded = await call(ctx, "POST", "image/upload", { image: `data:${bytes.contentType};base64,${bytes.base64}` });
  if ("kind" in uploaded) return uploaded;
  if (!ok(uploaded)) {
    const failure = failureOf(uploaded);
    if (failure.kind === "retry") return failure;
    return { image: null, warning: uploaded.status === 413 ? "IMAGE_TOO_LARGE" : "IMAGE_REFUSED" };
  }
  const path = (parse(uploaded.body) as { imagePath?: unknown } | null)?.imagePath;
  if (typeof path !== "string") return { kind: "retry", reason: "iFood answered the upload without an imagePath" };
  return { image: { ref: path, sourceUrl: item.imageUrl } };
}

/** The `PUT /items` body for one simple item with no add-ons. */
export function ifoodItemBody(item: CatalogueItemOut, category: string, image: string | null): unknown {
  const itemId = ifoodItemId(item.ref);
  const productId = ifoodProductId(item.ref);
  return {
    item: {
      id: itemId,
      type: "DEFAULT",
      categoryId: category,
      status: "AVAILABLE",
      price: priceOf(item.priceCents),
      externalCode: item.productId,
      // ESTIMATED: the guide's examples link item and product implicitly; the
      // field naming the product is not shown on the pages read.
      productId,
    },
    products: [
      {
        id: productId,
        name: item.name,
        description: item.description ?? "",
        externalCode: `${item.productId}-product`,
        // ESTIMATED field name: the Errors page names `imagePath` as what the upload returns and the item carries.
        ...(image === null ? {} : { imagePath: image }),
      },
    ],
    optionGroups: [],
    options: [],
  };
}

async function publish(ctx: CatalogueCallContext, item: CatalogueItemOut): Promise<CataloguePublishResult> {
  const category = await categoryId(ctx, item.categoryName);
  if ("kind" in category) return category;
  const photo = await photoFor(ctx, item);
  if ("kind" in photo) return photo;
  const put = await call(ctx, "PUT", "items", ifoodItemBody(item, category.id, photo.image?.ref ?? null));
  if ("kind" in put) return put;
  if (!ok(put)) return failureOf(put);
  // iFood's orders carry the item's `externalCode` as the line's SKU (the order normalizer reads it).
  const published = { kind: "published" as const, externalId: ifoodItemId(item.ref), sku: item.productId, image: photo.image };
  return photo.warning ? { ...published, warning: photo.warning } : published;
}

async function withdraw(ctx: CatalogueCallContext, item: CatalogueItemRef): Promise<OutboundResult> {
  const itemId = item.externalId ?? ifoodItemId(item.ref);
  const patched = await call(ctx, "PATCH", "items/status", { itemId, status: "UNAVAILABLE" });
  if ("kind" in patched) return patched;
  // ESTIMATED: a 404 means iFood does not have the item, so it is already out
  // of its catalogue (the Errors page says 404 is "the resource does not exist").
  if (patched.status === 404) return { kind: "accepted" };
  return outboundResultOf(patched);
}

/** A call that never got an answer is a retry. */
async function publishedOrRetry(run: () => Promise<CataloguePublishResult>): Promise<CataloguePublishResult> {
  try {
    return await run();
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** iFood's catalogue capability. */
export const IFOOD_CATALOGUE: PushCatalogue = {
  mode: "push",
  publishItem: (ctx, item) => publishedOrRetry(() => publish(ctx, item)),
  withdrawItem: (ctx, item) => answered(() => withdraw(ctx, item)),
};
