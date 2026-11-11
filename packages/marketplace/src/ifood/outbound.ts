import {
  answered,
  outboundResultOf,
  type AdapterCallContext,
  type CancellationRequestInput,
  type OutboundOrderRef,
  type OutboundResult,
} from "../core/adapter";

/**
 * The iFood adapter's OUTBOUND half: auth, URLs and payload shapes. Everything
 * here is iFood's wire format and nothing else — the job that calls it, its
 * retries and what a failure shows are the engine's (`../core/outbound.ts`).
 *
 * UNVERIFIED. iFood's developer portal refused our reader, so every URL, body
 * field below (and the reason codes in `./copy.ts`) comes from the portal's search snippets
 * (2026-11-11), not from a page we could read whole. They are in THIS file and
 * nowhere else so that the homologation run against iFood's sandbox, once
 * homologation credentials exist, corrects one file. Tests never reach
 * iFood: the HTTP client is the host's port, answered by a fake.
 */

/** iFood's merchant API. Sandbox and production share the host; the credentials differ. */
const API = "https://merchant-api.ifood.com.br";
const TOKEN_URL = `${API}/authentication/v1.0/oauth/token`;
const orderUrl = (externalOrderId: string, action: string): string =>
  `${API}/order/v1.0/orders/${encodeURIComponent(externalOrderId)}/${action}`;

/**
 * iFood's order-manager portal. No per-order deep link was found in the
 * snippets, so the app link opens the portal, where the order is on the
 * first screen while it is live.
 */
export const IFOOD_PORTAL_URL = "https://portal.ifood.com.br/";

/** A token is renewed this long before iFood says it expires. */
const TOKEN_MARGIN_MS = 60_000;

/** iFood's OAuth answer, read defensively: a missing field is "no token". */
function tokenOf(body: string): { token: string; expiresInSeconds: number } | null {
  try {
    const parsed = JSON.parse(body) as { accessToken?: unknown; expiresIn?: unknown };
    if (typeof parsed.accessToken !== "string" || parsed.accessToken === "") return null;
    const expires = typeof parsed.expiresIn === "number" && parsed.expiresIn > 0 ? parsed.expiresIn : 3600;
    return { token: parsed.accessToken, expiresInSeconds: expires };
  } catch {
    return null;
  }
}

/**
 * A bearer token for this merchant app, from the per-process cache or a fresh
 * client-credentials grant. Keyed by the app's client id, so two stores with
 * two apps never share one. The token lives in memory only.
 */
async function bearer(ctx: AdapterCallContext): Promise<{ token: string } | OutboundResult> {
  const key = `IFOOD:${ctx.environment}:${ctx.credentials.clientId}`;
  const cached = ctx.tokens.get(key);
  if (cached && cached.expiresAt > ctx.now.getTime() + TOKEN_MARGIN_MS) return { token: cached.token };
  const response = await ctx.http({
    method: "POST",
    url: TOKEN_URL,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "client_credentials",
      clientId: ctx.credentials.clientId,
      clientSecret: ctx.credentials.clientSecret,
    }).toString(),
  });
  if (response.status < 200 || response.status >= 300) return outboundResultOf(response);
  const token = tokenOf(response.body);
  if (!token) return { kind: "retry", reason: "iFood answered the token grant without a token" };
  ctx.tokens.set(key, { token: token.token, expiresAt: ctx.now.getTime() + token.expiresInSeconds * 1000 });
  return { token: token.token };
}

/** One authenticated POST to an order's resource. */
function postOrder(ctx: AdapterCallContext, externalOrderId: string, action: string, body?: unknown): Promise<OutboundResult> {
  return answered(async () => {
    const auth = await bearer(ctx);
    if (!("token" in auth)) return auth;
    const response = await ctx.http({
      method: "POST",
      url: orderUrl(externalOrderId, action),
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // A 401 is a token that went stale under us: forget it, and the retry fetches another.
    if (response.status === 401) ctx.tokens.delete(`IFOOD:${ctx.environment}:${ctx.credentials.clientId}`);
    return response.status === 401 ? { kind: "retry", reason: "iFood refused the token" } : outboundResultOf(response);
  });
}

/** Tell iFood the store accepted the order. No body: the URL names the order. */
export function ifoodConfirm(ctx: AdapterCallContext, order: OutboundOrderRef): Promise<OutboundResult> {
  return postOrder(ctx, order.externalOrderId, "confirm");
}

/** Ask iFood to cancel the order with one of its reason codes. */
export function ifoodRequestCancellation(
  ctx: AdapterCallContext,
  order: OutboundOrderRef,
  input: CancellationRequestInput,
): Promise<OutboundResult> {
  return postOrder(ctx, order.externalOrderId, "requestCancellation", {
    reason: input.text === "" ? input.reason.label : input.text,
    cancellationCode: input.reason.code,
  });
}
