import {
  answered,
  outboundResultOf,
  type AdapterCallContext,
  type CancellationRequestInput,
  type FetchOrderResult,
  type MarketplaceHttpResponse,
  type OutboundOrderRef,
  type OutboundResult,
} from "../core/adapter";
import { NINETY_NINE_FOOD_PROVIDER, normalizeOpenDeliveryOrder } from "./normalize";

/**
 * The 99Food adapter's OUTBOUND half, on Open Delivery v1.7.1: the OAuth
 * grant, the order fetch, confirm and requestCancellation. Paths, verbs,
 * bodies and answers are the spec's; the job that calls these, its retries
 * and what a failure shows are the engine's.
 *
 * The one thing the spec cannot pin is WHERE: Open Delivery standardizes the
 * paths under each Ordering Application's own base URL, and 99Food gives its
 * base URLs to a partner at onboarding. So the base URL per environment is
 * the adapter's REQUIRED config, never a guessed default. Tests never reach
 * 99Food: the HTTP client is the host's port, answered by a fake.
 */

/** Where 99Food serves Open Delivery, per environment (given at partner onboarding). */
export type NinetyNineFoodApiBaseUrls = Readonly<Record<"SANDBOX" | "PRODUCTION", string>>;

/** A token is renewed this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;
/** `expires_in` is optional in the spec's `TokenResponse`; an hour when absent. ESTIMATED. */
const DEFAULT_TOKEN_SECONDS = 3600;

/** The base URL with its trailing slashes cut, by a loop: a `/\/+$/` regex backtracks polynomially on many slashes. */
function baseOf(ctx: AdapterCallContext, bases: NinetyNineFoodApiBaseUrls): string {
  const base = bases[ctx.environment];
  let end = base.length;
  while (end > 0 && base.charCodeAt(end - 1) === 47) end -= 1;
  return base.slice(0, end);
}
const tokenKey = (ctx: AdapterCallContext): string =>
  `${NINETY_NINE_FOOD_PROVIDER}:${ctx.environment}:${ctx.credentials.clientId}`;

/** The spec's `TokenResponse` (`access_token`, `token_type`, `expires_in`), read defensively. */
function tokenOf(body: string): { token: string; expiresInSeconds: number } | null {
  try {
    const parsed = JSON.parse(body) as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") return null;
    const expires =
      typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : DEFAULT_TOKEN_SECONDS;
    return { token: parsed.access_token, expiresInSeconds: expires };
  } catch {
    return null;
  }
}

/**
 * A bearer token from the per-process cache, or a fresh `client_credentials`
 * grant (`POST /oauth/token`, form-encoded `client_id`, `client_secret`,
 * `grant_type`). Keyed by environment and client id; memory only.
 */
async function bearer(
  ctx: AdapterCallContext,
  bases: NinetyNineFoodApiBaseUrls,
): Promise<{ token: string } | Exclude<OutboundResult, { kind: "accepted" }>> {
  const cached = ctx.tokens.get(tokenKey(ctx));
  if (cached && cached.expiresAt > ctx.now.getTime() + TOKEN_MARGIN_MS) return { token: cached.token };
  const response = await ctx.http({
    method: "POST",
    url: `${baseOf(ctx, bases)}/oauth/token`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ctx.credentials.clientId,
      client_secret: ctx.credentials.clientSecret,
      grant_type: "client_credentials",
    }).toString(),
  });
  if (response.status < 200 || response.status >= 300) {
    const result = outboundResultOf(response);
    return result.kind === "accepted" ? { kind: "retry", reason: "unexpected token answer" } : result;
  }
  const token = tokenOf(response.body);
  if (!token) return { kind: "retry", reason: "99Food answered the token grant without a token" };
  ctx.tokens.set(tokenKey(ctx), { token: token.token, expiresAt: ctx.now.getTime() + token.expiresInSeconds * 1000 });
  return { token: token.token };
}

/** One authenticated call to an order's resource, the raw answer or the result that ends it. */
async function callOrder(
  ctx: AdapterCallContext,
  bases: NinetyNineFoodApiBaseUrls,
  request: { method: "GET" | "POST"; externalOrderId: string; action: string | null; body?: unknown },
): Promise<MarketplaceHttpResponse | Exclude<OutboundResult, { kind: "accepted" }>> {
  const auth = await bearer(ctx, bases);
  if (!("token" in auth)) return auth;
  const suffix = request.action === null ? "" : `/${request.action}`;
  const response = await ctx.http({
    method: request.method,
    url: `${baseOf(ctx, bases)}/v1/orders/${encodeURIComponent(request.externalOrderId)}${suffix}`,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  // A 401 is a token that went stale under us: forget it, and the retry fetches another.
  if (response.status !== 401) return response;
  ctx.tokens.delete(tokenKey(ctx));
  return { kind: "retry", reason: "99Food refused the token" };
}

/** Whether a 422 answer's `CancellationError.cancellationStatus` says the order is already cancelled. */
function alreadyCancelled(response: MarketplaceHttpResponse): boolean {
  if (response.status !== 422) return false;
  try {
    return (JSON.parse(response.body) as { cancellationStatus?: unknown }).cancellationStatus === "CANCELLED";
  } catch {
    return false;
  }
}

/** {@link answered} for a fetch: a call that never got an answer is a retry. */
async function fetched(call: () => Promise<FetchOrderResult>): Promise<FetchOrderResult> {
  try {
    return await call();
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** `GET /v1/orders/{orderId}`: the order an event announced, normalized. A 404 is an expired order: refused. */
export function openDeliveryFetchOrder(
  ctx: AdapterCallContext,
  bases: NinetyNineFoodApiBaseUrls,
  order: { externalOrderId: string },
  options: { missingStreetNumber: string },
): Promise<FetchOrderResult> {
  return fetched(async () => {
    const response = await callOrder(ctx, bases, { method: "GET", externalOrderId: order.externalOrderId, action: null });
    if ("kind" in response) return response;
    const result = outboundResultOf(response);
    if (result.kind !== "accepted") return result;
    let body: unknown;
    try {
      body = JSON.parse(response.body);
    } catch {
      return { kind: "refused", status: response.status, message: "the order is not JSON" };
    }
    const normalized = normalizeOpenDeliveryOrder(body, options);
    return normalized
      ? { kind: "order", order: normalized }
      : { kind: "refused", status: response.status, message: "the order carries no id or no line" };
  });
}

/**
 * `POST /v1/orders/{orderId}/confirm` with the spec's `OrderConfirmed`:
 * `orderExternalCode` (the host's own order id) and `createdAt`, plus the
 * `preparationTime` in minutes when the store stated one. The spec describes
 * `createdAt` with the ORDER's creation text (a copy of another schema's), so
 * it is sent as the moment of the confirmation: ESTIMATED.
 *
 * Every 422 is a refusal. It is the spec's generic `UnprocessableEntity`
 * ("unable to process the contained instructions. (Check if the instruction
 * has not been sent before.)"), and its body cannot tell a duplicate from a
 * cancelled order. So a retried confirm whose first answer was lost reads
 * "não confirmou" with the app link — a false alarm a person dismisses on
 * 99Food — and a confirm 99Food truly refused is never stamped confirmed.
 */
export function openDeliveryConfirm(
  ctx: AdapterCallContext,
  bases: NinetyNineFoodApiBaseUrls,
  order: OutboundOrderRef,
  input: { preparationMinutes: number | null },
): Promise<OutboundResult> {
  return answered(async () => {
    const response = await callOrder(ctx, bases, {
      method: "POST",
      externalOrderId: order.externalOrderId,
      action: "confirm",
      body: {
        orderExternalCode: order.hostOrderCode,
        createdAt: ctx.now.toISOString(),
        ...(input.preparationMinutes === null ? {} : { preparationTime: input.preparationMinutes }),
      },
    });
    if ("kind" in response) return response;
    return outboundResultOf(response);
  });
}

/**
 * `POST /v1/orders/{orderId}/requestCancellation` with the spec's
 * `RequestCancelled`: `reason` (free text: the store's, else the label),
 * `code` (one of the spec's codes) and `mode` (`MANUAL` or `AUTO`). 202 means
 * taken; the outcome is a later `CANCELLED` or `CANCELLATION_REQUEST_DENIED`
 * event. A 422 whose `cancellationStatus` is `CANCELLED` means the order is
 * cancelled already, which is what the request wanted.
 *
 * `outOfStockItems` is not sent: the spec wants the ITEM ids (uuids) there,
 * and the engine keeps the marketplace's SKUs (`externalCode`), which the SKU
 * map is keyed on. The field is optional.
 */
export function openDeliveryRequestCancellation(
  ctx: AdapterCallContext,
  bases: NinetyNineFoodApiBaseUrls,
  order: OutboundOrderRef,
  input: CancellationRequestInput,
): Promise<OutboundResult> {
  return answered(async () => {
    const response = await callOrder(ctx, bases, {
      method: "POST",
      externalOrderId: order.externalOrderId,
      action: "requestCancellation",
      body: { reason: input.text === "" ? input.reason.label : input.text, code: input.reason.code, mode: input.mode },
    });
    if ("kind" in response) return response;
    return alreadyCancelled(response) ? { kind: "accepted" } : outboundResultOf(response);
  });
}
