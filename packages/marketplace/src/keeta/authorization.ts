import { outboundResultOf, type AdapterCallContext } from "../core/adapter";
import { asString, firstString, pick } from "../core/payload-read";
import { isStop, openDeliveryCall, type OpenDeliveryDialect, type OpenDeliveryStop } from "../open-delivery/client";

/**
 * Keeta's MERCHANT AUTHORIZATION, automated from the software (Keeta's
 * "Autorização Self-serve do Merchant", read 2026-11-26 at
 * https://api-docs.mykeeta.com/apis/opendelivery/merchant-self-serve-authorization).
 * Not on the adapter port: connecting a store is the host's flow, and these
 * are the calls it is built from.
 *
 * 1. {@link KeetaAuthorization.authorizationUrl}: `GET
 *    /oauth/authorization/url?clientId=&redirectUri=` (no token: a token
 *    needs at least one authorized store), the link the merchant opens.
 * 2. The merchant authorizes; Keeta redirects to `redirectUri` with `authId`
 *    (and `state`, `appId`, `timestamp`), and POSTs the authorization webhook
 *    ({@link normalizeKeetaAuthorizationEvent}: `opType` 1 added, 2 revoked).
 * 3. {@link KeetaAuthorization.authorizedShops}: `GET
 *    /oauth/authorized/{authId}/merchantInfo?pageNum=&pageSize=` lists the
 *    stores of that authorization (Keeta's ids, names, addresses, time zones).
 * 4. The host maps a Keeta store to its own, then
 *    {@link KeetaAuthorization.onboard}: `PUT /v1/merchantOnboarding?merchantId=`
 *    binds the SOFTWARE's merchant id (the connection's `externalMerchantId`)
 *    to `keetaMerchantId` and registers the `GET /v1/merchant` URL and the
 *    orders webhook. "Without onboarding there are no order events"; sending
 *    it again for the same id REPLACES the mapping. Answer 201.
 *
 * ESTIMATED: the JSON answer the authorization webhook wants ("200 within
 * ~5 s, with JSON containing `code` and `message`": the values are not
 * given, {@link KEETA_AUTHORIZATION_WEBHOOK_ANSWER} sends 0 and "success").
 */

/** What the authorization webhook is answered with, 200, within ~5 s. ESTIMATED values. */
export const KEETA_AUTHORIZATION_WEBHOOK_ANSWER = { code: 0, message: "success" } as const;

/** One authorization change Keeta reported (event 1301 added, 1302 revoked). */
export interface KeetaAuthorizationEvent {
  authId: string;
  change: "AUTHORIZED" | "REVOKED";
  /** Keeta's store id (an integer on the wire, text here). */
  shopId: string;
  shopName: string | null;
  /** The application's id. */
  clientId: string | null;
  at: Date | null;
}

/** Read the authorization webhook's body (`WebhookNotification`). Null when it names no authorization or store. */
export function normalizeKeetaAuthorizationEvent(payload: unknown): KeetaAuthorizationEvent | null {
  const authId = firstString(payload, [["authId"]]);
  const shopId = firstString(payload, [["shopId"]]);
  const opType = pick(payload, "opType");
  const change = opType === 1 ? "AUTHORIZED" : opType === 2 ? "REVOKED" : null;
  if (!authId || !shopId || !change) return null;
  const millis = pick(payload, "createTime");
  return {
    authId,
    change,
    shopId,
    shopName: firstString(payload, [["shopName"]]),
    clientId: firstString(payload, [["clientId"]]),
    at: typeof millis === "number" && Number.isFinite(millis) ? new Date(millis) : null,
  };
}

/** One store of an authorization, as `merchantInfo` lists it. */
export interface KeetaAuthorizedShop {
  /** Keeta's store id: the `keetaMerchantId` the onboarding takes. */
  id: string;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  timeZone: string | null;
}

/** One page of an authorization's stores. */
export interface KeetaAuthorizedShops {
  brandId: string | null;
  brandName: string | null;
  shops: KeetaAuthorizedShop[];
  page: { pageNum: number; totalPage: number; totalCount: number };
}

/** What the host registers for one store at onboarding. */
export interface KeetaOnboarding {
  /** The SOFTWARE's merchant id: the connection's `externalMerchantId`, the `Merchant.id` the host serves. */
  merchantId: string;
  /** Keeta's store id, from `authorizedShops` or Keeta's portal. */
  keetaMerchantId: number;
  /** Where Keeta reads this store's `GET /v1/merchant` (one URL per store), and its key if it wants one. */
  merchantDocument?: { url: string; apiKey?: string };
  /** The engine's webhook for this store: `…/webhooks/marketplace/:tenantSlug/KEETA`. */
  ordersWebhookUrl?: string;
}

export type KeetaAuthorizationResult<T> = { kind: "ok"; value: T } | OpenDeliveryStop;

const numberOr = (value: unknown, fallback: number | null): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function shopOf(raw: unknown): KeetaAuthorizedShop | null {
  const id = firstString(raw, [["id"]]);
  if (!id) return null;
  return {
    id,
    name: firstString(raw, [["name"]]),
    address: firstString(raw, [["address"]]),
    latitude: numberOr(pick(raw, "latitude"), null),
    longitude: numberOr(pick(raw, "longitude"), null),
    timeZone: firstString(raw, [["timeZone"]]),
  };
}

function shopsOf(body: unknown): KeetaAuthorizedShops {
  const raw = pick(body, "authorizedShops");
  return {
    brandId: asString(pick(body, "brandId")),
    brandName: firstString(body, [["brandName"]]),
    shops: (Array.isArray(raw) ? raw : []).map(shopOf).filter((shop): shop is KeetaAuthorizedShop => shop !== null),
    page: {
      pageNum: numberOr(pick(body, "page", "pageNum"), 1) ?? 1,
      totalPage: numberOr(pick(body, "page", "totalPage"), 1) ?? 1,
      totalCount: numberOr(pick(body, "page", "totalCount"), 0) ?? 0,
    },
  };
}

/** One call whose 2xx answer is read by `read`: the value, or the result that ends it. */
async function readCall<T>(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  call: Parameters<typeof openDeliveryCall>[2],
  read: (body: unknown) => T | null,
): Promise<KeetaAuthorizationResult<T>> {
  try {
    const response = await openDeliveryCall(ctx, dialect, call);
    if (isStop(response)) return response;
    const result = outboundResultOf(response);
    if (result.kind !== "accepted") return result;
    let body: unknown = null;
    try {
      body = response.body === "" ? null : JSON.parse(response.body);
    } catch {
      body = null;
    }
    const value = read(body);
    return value === null
      ? { kind: "refused", status: response.status, message: "Keeta's answer is not the documented shape" }
      : { kind: "ok", value };
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The self-serve authorization calls, bound to Keeta's dialect. */
export interface KeetaAuthorization {
  authorizationUrl(ctx: AdapterCallContext, input: { redirectUri?: string }): Promise<KeetaAuthorizationResult<string>>;
  authorizedShops(
    ctx: AdapterCallContext,
    input: { authId: string; pageNum?: number; pageSize?: number },
  ): Promise<KeetaAuthorizationResult<KeetaAuthorizedShops>>;
  onboard(ctx: AdapterCallContext, input: KeetaOnboarding): Promise<KeetaAuthorizationResult<true>>;
}

/** An https URL Keeta answered, or null. */
function httpsUrl(body: unknown): string | null {
  const url = firstString(body, [["merchantAuthorizationUrl"]]);
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function keetaAuthorization(dialect: OpenDeliveryDialect): KeetaAuthorization {
  return {
    authorizationUrl: (ctx, input) =>
      readCall(
        ctx,
        dialect,
        {
          method: "GET",
          path: "/oauth/authorization/url",
          query: { clientId: ctx.credentials.clientId, ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) },
          authenticated: false,
        },
        httpsUrl,
      ),
    authorizedShops: (ctx, input) =>
      readCall(
        ctx,
        dialect,
        {
          method: "GET",
          path: `/oauth/authorized/${encodeURIComponent(input.authId)}/merchantInfo`,
          query: { pageNum: String(input.pageNum ?? 1), pageSize: String(Math.min(input.pageSize ?? 100, 100)) },
        },
        (body) => (body === null ? null : shopsOf(body)),
      ),
    onboard: (ctx, input) =>
      readCall(
        ctx,
        dialect,
        {
          method: "PUT",
          path: "/v1/merchantOnboarding",
          query: { merchantId: input.merchantId },
          body: {
            keetaMerchantId: input.keetaMerchantId,
            ...(input.merchantDocument
              ? {
                  getMerchantURL: {
                    baseURL: input.merchantDocument.url,
                    ...(input.merchantDocument.apiKey ? { apiKey: input.merchantDocument.apiKey } : {}),
                  },
                }
              : {}),
            ...(input.ordersWebhookUrl ? { ordersWebhookURL: input.ordersWebhookUrl } : {}),
          },
        },
        () => true as const,
      ),
  };
}
