import {
  outboundResultOf,
  type AdapterCallContext,
  type FetchOrderResult,
  type MarketplaceHttpResponse,
} from "../core/adapter";
import { firstString } from "../core/payload-read";
import { readIfoodOrder } from "./normalize";
import { IFOOD_API, bearer, ifoodTokenKey } from "./outbound";

/**
 * The iFood adapter's order read (FUT-5800): `GET /order/v1.0/orders/{id}`.
 *
 * iFood's events carry only the order id, so a PLACED with no items is marked
 * `orderToFetch` (`./normalize.ts`) and the engine's `marketplace.fetch-order`
 * job calls this, after the webhook's row is committed, never inside the
 * request. The order iFood serves has the fields the event's `order` would
 * have carried, so it is normalized by the same reader: a fetched order and a
 * carried one land identically.
 *
 * How an answer is read:
 * - 2xx with an order: the order, with the merchant its `merchant.id` names
 *   (the engine refuses one naming another merchant than the connection's).
 * - 2xx that is not JSON: retried. 2xx naming another order, or no items: refused.
 * - 401: the cached token is forgotten and a new one asked for, ONCE, in the
 *   same call. A second 401 is our credentials refused (`own`), as is a 403
 *   (the merchant has not authorized this app) and a token grant iFood refuses.
 * - 404: retried. ESTIMATED: an order read right after its PLACED may not be
 *   served yet; the job's attempt bound ends it.
 * - Everything else: the engine's one rule (`outboundResultOf`).
 */

const orderResourceUrl = (externalOrderId: string): string =>
  `${IFOOD_API}/order/v1.0/orders/${encodeURIComponent(externalOrderId)}`;

/** One authenticated GET, or the token's refusal or retry in its place. */
async function getOrder(
  ctx: AdapterCallContext,
  externalOrderId: string,
): Promise<{ response: MarketplaceHttpResponse } | Exclude<FetchOrderResult, { kind: "order" }>> {
  const auth = await bearer(ctx);
  if (!("token" in auth)) {
    return auth.kind === "accepted" ? { kind: "retry", reason: "iFood answered the token grant without a token" } : auth;
  }
  const response = await ctx.http({
    method: "GET",
    url: orderResourceUrl(externalOrderId),
    headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
  });
  return { response };
}

/** The order in a 2xx answer, or why it is not one. */
function orderOf(body: string, externalOrderId: string, missingStreetNumber: string): FetchOrderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return { kind: "retry", reason: "iFood answered the order read with a body that is not JSON" };
  }
  const named = firstString(parsed, [["id"]]);
  if (named !== null && named !== externalOrderId) {
    return { kind: "refused", status: 200, message: `iFood answered order ${named} for ${externalOrderId}` };
  }
  const order = readIfoodOrder(parsed, externalOrderId, missingStreetNumber);
  if (!order) return { kind: "refused", status: 200, message: "iFood answered an order with no items" };
  return { kind: "order", order: { ...order, externalMerchantId: firstString(parsed, [["merchant", "id"]]) } };
}

/** What a non-2xx answer means for the fetch. */
function failureOf(response: MarketplaceHttpResponse): Exclude<FetchOrderResult, { kind: "order" }> {
  const message = response.body.slice(0, 300);
  if (response.status === 401 || response.status === 403) {
    return { kind: "refused", status: response.status, message, own: true };
  }
  if (response.status === 404) return { kind: "retry", reason: `status 404: ${message}` };
  const result = outboundResultOf(response);
  return result.kind === "accepted" ? { kind: "retry", reason: `status ${response.status}` } : result;
}

/** Fetch one order iFood's event only named. Never throws: no answer is a retry. */
export async function ifoodFetchOrder(
  ctx: AdapterCallContext,
  ref: { externalOrderId: string },
  options: { missingStreetNumber: string },
): Promise<FetchOrderResult> {
  try {
    let answer = await getOrder(ctx, ref.externalOrderId);
    if ("response" in answer && answer.response.status === 401) {
      // A token that went stale under us: forget it and try once with a new one.
      ctx.tokens.delete(ifoodTokenKey(ctx));
      answer = await getOrder(ctx, ref.externalOrderId);
    }
    if (!("response" in answer)) return answer;
    const { response } = answer;
    if (response.status >= 200 && response.status < 300) {
      return orderOf(response.body, ref.externalOrderId, options.missingStreetNumber);
    }
    return failureOf(response);
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}
