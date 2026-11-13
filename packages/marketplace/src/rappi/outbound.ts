import {
  answered,
  outboundResultOf,
  type AdapterCallContext,
  type CancellationRequestInput,
  type MarketplaceHttpResponse,
  type OutboundOrderRef,
  type OutboundResult,
} from "../core/adapter";
import { RAPPI_PROVIDER } from "./normalize";

/**
 * The Rappi adapter's OUTBOUND half, from Rappi's public developer portal
 * (dev-portal.rappi.com: authentication-process, api-reference/orders), read
 * 2026-11-13: the token, take and reject. The job that calls these, its
 * retries and what a failure shows are the engine's.
 *
 * - Token: `POST https://{NEW_DOMAIN}/restaurants/auth/v1/token/login/integrations`,
 *   JSON `{ client_id, client_secret }`; "the system responds with your
 *   access_token", valid "1 week"; sent as `x-authorization: Bearer <token>`.
 * - Take: `PUT https://{COUNTRY_DOMAIN}/api/v2/restaurants-integrations-public-api/orders/{orderId}/take/{cookingTime}`,
 *   the cooking time optional ("leave this field empty to keep the default");
 *   200 taken, 400 "Invalid state transition", 404 not found.
 * - Reject: `PUT …/orders/{orderId}/reject` with `{ reason, cancel_type,
 *   items_skus }`, only from SENT; 200 rejected, 400, 404.
 *
 * WHERE is not public per partner: the portal names its domains by country
 * (`{COUNTRY_DOMAIN}`, and a "new" one for the token), and Rappi's account
 * manager opens the sandbox. So the orders API's base and the token URL, per
 * environment, are the adapter's REQUIRED config, never a guessed default. Tests never reach
 * Rappi: the HTTP client is the host's port, answered by a fake.
 */

/** One https URL per environment. */
export type RappiBaseUrls = Readonly<Record<"SANDBOX" | "PRODUCTION", string>>;

/**
 * The two places the adapter calls, both host config (the portal's paths
 * carry the origin application's own noun, so they are the host's to state):
 * - `api`: the orders API's base, the portal's
 *   `https://{COUNTRY_DOMAIN}/api/v2/restaurants-integrations-public-api`, to
 *   which the adapter appends `/orders/{orderId}/…`;
 * - `token`: the token endpoint itself, the portal's
 *   `https://{NEW_DOMAIN}/restaurants/auth/v1/token/login/integrations`.
 */
export interface RappiHosts {
  api: RappiBaseUrls;
  token: RappiBaseUrls;
}
/** A token is renewed this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;
/**
 * The portal: "Your access token has a validity of 1 week". Used when the
 * answer states no `expires_in` (the answer's shape beyond `access_token` is
 * not shown: ESTIMATED).
 */
const DEFAULT_TOKEN_SECONDS = 7 * 24 * 60 * 60;

/** A base URL with its trailing slashes cut, by a loop: a `/\/+$/` regex backtracks polynomially on many slashes. */
function trimmed(base: string): string {
  let end = base.length;
  while (end > 0 && base.charCodeAt(end - 1) === 47) end -= 1;
  return base.slice(0, end);
}

const tokenKey = (ctx: AdapterCallContext): string => `${RAPPI_PROVIDER}:${ctx.environment}:${ctx.credentials.clientId}`;

/** The token answer, read defensively: `access_token`, and `expires_in` when present. */
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
 * A token from the per-process cache, or a fresh one from the token endpoint
 * (the M2M client credentials). Keyed by environment and client id; memory
 * only, written to no row or log.
 */
async function bearer(
  ctx: AdapterCallContext,
  hosts: RappiHosts,
): Promise<{ token: string } | Exclude<OutboundResult, { kind: "accepted" }>> {
  const cached = ctx.tokens.get(tokenKey(ctx));
  if (cached && cached.expiresAt > ctx.now.getTime() + TOKEN_MARGIN_MS) return { token: cached.token };
  const response = await ctx.http({
    method: "POST",
    url: hosts.token[ctx.environment],
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: ctx.credentials.clientId, client_secret: ctx.credentials.clientSecret }),
  });
  if (response.status < 200 || response.status >= 300) {
    const result = outboundResultOf(response);
    return result.kind === "accepted" ? { kind: "retry", reason: "unexpected token answer" } : result;
  }
  const token = tokenOf(response.body);
  if (!token) return { kind: "retry", reason: "Rappi answered the token request without a token" };
  ctx.tokens.set(tokenKey(ctx), { token: token.token, expiresAt: ctx.now.getTime() + token.expiresInSeconds * 1000 });
  return { token: token.token };
}

/** One authenticated PUT to an order's resource: the raw answer, or the result that ends it. */
async function putOrder(
  ctx: AdapterCallContext,
  hosts: RappiHosts,
  request: { externalOrderId: string; action: string; body?: unknown },
): Promise<MarketplaceHttpResponse | Exclude<OutboundResult, { kind: "accepted" }>> {
  const auth = await bearer(ctx, hosts);
  if (!("token" in auth)) return auth;
  const response = await ctx.http({
    method: "PUT",
    url: `${trimmed(hosts.api[ctx.environment])}/orders/${encodeURIComponent(request.externalOrderId)}/${request.action}`,
    headers: {
      "x-authorization": `Bearer ${auth.token}`,
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  // A 401 is a token that went stale under us: forget it, and the retry fetches another.
  if (response.status !== 401) return response;
  ctx.tokens.delete(tokenKey(ctx));
  return { kind: "retry", reason: "Rappi refused the token" };
}

/**
 * Take the order: `PUT …/orders/{orderId}/take/{cookingTime}`, the store's
 * preparation minutes as the cooking time, or `…/take/` to keep the order's
 * own (the portal: outside the order's range, Rappi uses the nearest bound).
 * The empty segment is how the portal's guide spells it
 * (`PUT /orders/{orderId}/take/`); ESTIMATED that Rappi's router serves it
 * (a 404 there would read as a refusal and show the portal link).
 * Every refused answer (400 "Invalid state transition", 404) is a refusal: the
 * store sees "não confirmou" and the app link.
 */
export function rappiTake(
  ctx: AdapterCallContext,
  hosts: RappiHosts,
  order: OutboundOrderRef,
  input: { preparationMinutes: number | null },
): Promise<OutboundResult> {
  const minutes = input.preparationMinutes === null ? "" : String(Math.round(input.preparationMinutes));
  return answered(async () => {
    const response = await putOrder(ctx, hosts, { externalOrderId: order.externalOrderId, action: `take/${minutes}` });
    return "kind" in response ? response : outboundResultOf(response);
  });
}

/**
 * Reject the order: `PUT …/orders/{orderId}/reject` with `reason` (required
 * free text: the store's, else the reason's label), `cancel_type` (one of the
 * portal's six) and `items_skus` (the offending SKUs, required by the three
 * item reasons). The answer IS the outcome: 200 rejected (the engine stamps
 * CONFIRMED), any refusal FAILED with the app link.
 *
 * `items_skus` carries the engine's SKUs, which are the store's own `sku`
 * where the order states one. A line Rappi sent with no `sku` keys on Rappi's
 * item id, which the portal wants under `items_ids` instead; it is sent under
 * `items_skus` all the same (ESTIMATED: Rappi may refuse it, which reads as a
 * refusal and puts the app link in front of a person).
 */
export function rappiReject(
  ctx: AdapterCallContext,
  hosts: RappiHosts,
  order: OutboundOrderRef,
  input: CancellationRequestInput,
): Promise<OutboundResult> {
  const body = {
    reason: input.text === "" ? input.reason.label : input.text,
    cancel_type: input.reason.code,
    ...(input.offendingSkus.length > 0 ? { items_skus: [...input.offendingSkus] } : {}),
  };
  return answered(async () => {
    const response = await putOrder(ctx, hosts, { externalOrderId: order.externalOrderId, action: "reject", body });
    return "kind" in response ? response : outboundResultOf(response);
  });
}
