import { outboundResultOf, type MarketplaceHttpResponse, type OutboundResult } from "../core/adapter";
import type {
  CatalogueReadContext,
  CatalogueReader,
  CatalogueReadNotice,
  CatalogueReadResult,
  CatalogueSnapshotCategory,
  CatalogueSnapshotItem,
} from "../core/catalogue-read-port";
import { availableOf, entriesOf, indexOf, itemOf, record, text } from "./catalogue-snapshot";
import { IFOOD_API, bearer, ifoodTokenKey } from "./outbound";

/**
 * The iFood adapter's catalogue READ (FUT-951): the menu a store already keeps
 * on iFood, read through the store's OWN connection (its merchant id, and the
 * client-credentials token of its app, `bearer`), for the host to import.
 *
 * One read is, in order:
 * 1. `GET /categories` — the merchant's categories (CONFIRMED, the Endpoints
 *    page as read 2026-11-13; ESTIMATED that it answers an array of
 *    `{ id, name, status, externalCode }`, the same estimate the push makes);
 * 2. `GET /categories/{categoryId}/items` for each, in the list's order
 *    (CONFIRMED, the Introduction's step 5, read 2026-11-16), mapped by
 *    `./catalogue-snapshot.ts`.
 *
 * Pagination: none. The pages read show no page, size or cursor parameter on
 * either call (ESTIMATED that there is none), so the menu is read one category
 * per call, which bounds each answer by a category's size.
 *
 * Failures:
 * - a 401 drops the cached token and asks once more with a fresh one (as the
 *   push's `call` does); a second 401 is a `retry`;
 * - the token grant refused (400, 401, 403) is `CREDENTIALS`;
 * - 403 (the Errors page: the app is not allowed this merchant, or the
 *   catalogue module is not enabled for it) and 404 on the category list (no
 *   such merchant for this app, ESTIMATED) are `NOT_AUTHORIZED`;
 * - 429, 408, 425, 5xx and a call with no answer are `retry`;
 * - any other 4xx is `REFUSED`, with iFood's words.
 * A category whose own items answer 404 (deleted between the two calls), or
 * answer in a shape other than `{ items: [...] }`, is left out with a
 * CATEGORY_UNREADABLE notice rather than failing the read; an entry of a list
 * that is not an object is a notice too. Only a category LIST that is not a
 * list refuses the read (REFUSED): without it there is no menu to keep.
 */

const catalogUrl = (merchantId: string, path: string): string =>
  `${IFOOD_API}/catalog/v2.0/merchants/${encodeURIComponent(merchantId)}/${path}`;

type Failure = Exclude<CatalogueReadResult, { kind: "snapshot" }>;

/** The token grant's failure: a refusal is the store's credentials, anything else is asked again. */
function tokenFailure(result: OutboundResult): Failure {
  if (result.kind === "refused") return { kind: "refused", code: "CREDENTIALS", status: result.status, message: result.message };
  return { kind: "retry", reason: result.kind === "retry" ? result.reason : "unexpected token answer" };
}

/** A non-2xx catalogue answer as the failure it is. */
function failureOf(response: MarketplaceHttpResponse): Failure {
  const result = outboundResultOf(response);
  if (result.kind !== "refused") return { kind: "retry", reason: result.kind === "retry" ? result.reason : "unexpected answer" };
  const code = response.status === 403 || response.status === 404 ? "NOT_AUTHORIZED" : "REFUSED";
  return { kind: "refused", code, status: result.status, message: result.message };
}

/** One authenticated GET: iFood's answer (any status but 401), or the failure that ends the read. */
async function get(ctx: CatalogueReadContext, path: string): Promise<MarketplaceHttpResponse | Failure> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const auth = await bearer(ctx);
    if (!("token" in auth)) return tokenFailure(auth);
    const response = await ctx.http({
      method: "GET",
      url: catalogUrl(ctx.externalMerchantId, path),
      headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
    });
    if (response.status !== 401) return response;
    // A token that went stale under us: forget it, and the next turn grants another.
    ctx.tokens.delete(ifoodTokenKey(ctx));
  }
  return { kind: "retry", reason: "iFood refused a fresh token" };
}

const ok = (response: MarketplaceHttpResponse): boolean => response.status >= 200 && response.status < 300;

function parse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

const unexpected = (what: string, body: string): Failure => ({
  kind: "refused",
  code: "REFUSED",
  status: 200,
  message: `unexpected ${what} answer: ${body.slice(0, 200)}`,
});

/** One category's items, or the notice that leaves the category out, or the failure that ends the read. */
async function categoryOf(
  ctx: CatalogueReadContext,
  raw: Record<string, unknown>,
  notices: CatalogueReadNotice[],
): Promise<CatalogueSnapshotCategory | null | Failure> {
  const id = text(raw.id);
  const name = text(raw.name);
  if (id === null || name === null) {
    notices.push(unreadableCategory(id, raw));
    return null;
  }
  const answered = await get(ctx, `categories/${encodeURIComponent(id)}/items`);
  if ("kind" in answered) return answered;
  if (answered.status === 404) {
    notices.push(unreadableCategory(id, "its items answered 404"));
    return null;
  }
  if (!ok(answered)) return failureOf(answered);
  const items = itemsOf(answered.body, id, notices);
  return items && { externalId: id, externalCode: text(raw.externalCode), name, available: availableOf(raw.status), items };
}

const unreadableCategory = (categoryExternalId: string | null, detail: unknown): CatalogueReadNotice => ({
  code: "CATEGORY_UNREADABLE",
  categoryExternalId,
  externalId: null,
  detail: (typeof detail === "string" ? detail : JSON.stringify(detail) ?? String(detail)).slice(0, 300),
});

/**
 * One category's items, each one it cannot read an ITEM_UNREADABLE notice; or
 * null, with a CATEGORY_UNREADABLE notice, when the answer is not the expected
 * `{ items: [...] }` (ESTIMATED: the PUT's four lists, `items` plural). A
 * notice rather than refusing the whole read: one category answered in an odd
 * shape keeps the rest of the menu importable, and the host shows which
 * category did not come over; a shape iFood changed everywhere leaves a notice
 * on every category, never a silent empty menu.
 */
function itemsOf(rawBody: string, categoryId: string, notices: CatalogueReadNotice[]): CatalogueSnapshotItem[] | null {
  const body = record(parse(rawBody));
  if (!body || !Array.isArray(body.items)) {
    notices.push(unreadableCategory(categoryId, `unexpected items answer: ${rawBody}`));
    return null;
  }
  const index = indexOf(body);
  const { entries, others } = entriesOf(body.items);
  for (const other of others) {
    notices.push({ code: "ITEM_UNREADABLE", categoryExternalId: categoryId, externalId: null, detail: String(JSON.stringify(other)).slice(0, 300) });
  }
  const items: CatalogueSnapshotItem[] = [];
  for (const entry of entries) {
    const mapped = itemOf(entry, index, categoryId);
    if ("code" in mapped) notices.push(mapped);
    else items.push(mapped);
  }
  return items;
}

async function read(ctx: CatalogueReadContext): Promise<CatalogueReadResult> {
  const listed = await get(ctx, "categories");
  if ("kind" in listed) return listed;
  if (!ok(listed)) return failureOf(listed);
  const parsed = parse(listed.body);
  if (!Array.isArray(parsed)) return unexpected("category list", listed.body);
  const categories: CatalogueSnapshotCategory[] = [];
  const notices: CatalogueReadNotice[] = [];
  const { entries, others } = entriesOf(parsed);
  // A category entry that is not an object is said, never skipped.
  for (const other of others) notices.push(unreadableCategory(null, other));
  for (const raw of entries) {
    const category = await categoryOf(ctx, raw, notices);
    if (category === null) continue;
    if ("kind" in category) return category;
    categories.push(category);
  }
  return { kind: "snapshot", snapshot: { categories, notices } };
}

/** iFood's catalogue read. */
export const IFOOD_CATALOGUE_READER: CatalogueReader = {
  read: async (ctx) => {
    try {
      return await read(ctx);
    } catch (error) {
      return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
