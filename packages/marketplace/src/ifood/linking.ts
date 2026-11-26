import { outboundResultOf, type MarketplaceHttpRequest } from "../core/adapter";
import type { LinkCallContext, LinkCode, LinkGrant, LinkResult, LinkedMerchant, MarketplaceLinking } from "../core/linking-port";
import { asString, pick } from "../core/payload-read";
import { IFOOD_API } from "./outbound";

/**
 * iFood's DISTRIBUTED-APP authentication, the wire format only (FUT-5613).
 * Read 2026-11-26 off iFood's own pages, served as Markdown at
 * https://developer.ifood.com.br/pt-BR/docs/guides/modules/authentication/distributed.md
 * and .../merchant/endpoints.md:
 *
 * - `POST /authentication/v1.0/oauth/userCode`, form `clientId` → 200
 *   `{ userCode, authorizationCodeVerifier, verificationUrl,
 *   verificationUrlComplete, expiresIn }` ("valid for 10 minutes", 600).
 * - `POST /authentication/v1.0/oauth/token`, form `grantType=authorization_code`,
 *   `clientId`, `clientSecret`, `authorizationCode`, `authorizationCodeVerifier`
 *   → 200 `{ accessToken, type: "bearer", expiresIn }` (6 hours by default)
 *   and a refresh token ("returns an access token and a refresh token").
 * - The same URL, `grantType=refresh_token`, `clientId`, `clientSecret`,
 *   `refreshToken`.
 * - `GET /merchant/v1.0/merchants?page=&size=` (size default 100) → 200
 *   `[{ id, name, corporateName }]`: every store the token covers.
 *
 * ESTIMATED, not settled by those pages:
 * - the refresh token's FIELD name in the token answer: the page's table
 *   lists only `accessToken`, `type`, `expiresIn`; `refreshToken` (the name
 *   the request takes) is read, and the snake-case twin as a fallback;
 * - whether a refresh ROTATES the refresh token: a new one is stored when
 *   answered, the old one kept when not;
 * - the refresh token's own lifetime (unstated: "if the refreshToken
 *   expires, the user must authorize again"): a refused refresh marks the
 *   connection FAILED for the store to link again;
 * - the status of a wrong or used authorization code: any final 4xx is
 *   `refused`.
 */

const USER_CODE_URL = `${IFOOD_API}/authentication/v1.0/oauth/userCode`;
const TOKEN_URL = `${IFOOD_API}/authentication/v1.0/oauth/token`;
const MERCHANTS_URL = `${IFOOD_API}/merchant/v1.0/merchants`;

/** iFood's documented lifetime of a user code, used when the answer states none. */
const USER_CODE_SECONDS = 600;
/** iFood's documented default lifetime of an access token: 6 hours. */
const ACCESS_TOKEN_SECONDS = 21_600;
/** One page of the merchant list; iFood's documented default. */
const MERCHANT_PAGE_SIZE = 100;
/** A ceiling on pages read, so a misbehaving answer cannot loop. */
const MAX_MERCHANT_PAGES = 20;

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

function json(body: string): unknown {
  try {
    return body === "" ? null : (JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

/** One call whose 2xx body `read` turns into the value; anything else ends it. */
async function call<T>(
  ctx: LinkCallContext,
  request: MarketplaceHttpRequest,
  read: (body: unknown) => T | null,
): Promise<LinkResult<T>> {
  try {
    const response = await ctx.http(request);
    const result = outboundResultOf(response);
    if (result.kind !== "accepted") return result;
    const value = read(json(response.body));
    return value === null
      ? { kind: "refused", status: response.status, message: "iFood's answer is not the documented shape" }
      : { kind: "ok", value };
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

const positive = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

function codeOf(body: unknown): LinkCode | null {
  const userCode = asString(pick(body, "userCode"));
  const verifier = asString(pick(body, "authorizationCodeVerifier"));
  const verificationUrl = asString(pick(body, "verificationUrl"));
  if (!userCode || !verifier || !verificationUrl) return null;
  return {
    userCode,
    verifier,
    verificationUrl,
    verificationUrlComplete: asString(pick(body, "verificationUrlComplete")) ?? verificationUrl,
    expiresInSeconds: positive(pick(body, "expiresIn"), USER_CODE_SECONDS),
  };
}

function grantOf(body: unknown, requireRefresh: boolean): LinkGrant | null {
  const accessToken = asString(pick(body, "accessToken"));
  const refreshToken = asString(pick(body, "refreshToken")) ?? asString(pick(body, "refresh_token"));
  if (!accessToken || (requireRefresh && !refreshToken)) return null;
  return { accessToken, refreshToken, expiresInSeconds: positive(pick(body, "expiresIn"), ACCESS_TOKEN_SECONDS) };
}

function merchantsOf(body: unknown): LinkedMerchant[] | null {
  if (!Array.isArray(body)) return null;
  return body.flatMap((raw: unknown) => {
    const id = asString(pick(raw, "id"));
    return id ? [{ id, name: asString(pick(raw, "name")), corporateName: asString(pick(raw, "corporateName")) }] : [];
  });
}

const tokenRequest = (fields: Record<string, string>): MarketplaceHttpRequest => ({
  method: "POST",
  url: TOKEN_URL,
  headers: FORM,
  body: new URLSearchParams(fields).toString(),
});

/** Every merchant the token covers, page by page until a short page. */
async function listMerchants(ctx: LinkCallContext, accessToken: string): Promise<LinkResult<LinkedMerchant[]>> {
  const all: LinkedMerchant[] = [];
  for (let page = 1; page <= MAX_MERCHANT_PAGES; page += 1) {
    const answer = await call(
      ctx,
      {
        method: "GET",
        url: `${MERCHANTS_URL}?page=${page}&size=${MERCHANT_PAGE_SIZE}`,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      merchantsOf,
    );
    if (answer.kind !== "ok") return answer;
    all.push(...answer.value);
    if (answer.value.length < MERCHANT_PAGE_SIZE) break;
  }
  return { kind: "ok", value: all };
}

/** The iFood adapter's linking half. */
export const IFOOD_LINKING: MarketplaceLinking = {
  requestCode: (ctx) =>
    call(
      ctx,
      { method: "POST", url: USER_CODE_URL, headers: FORM, body: new URLSearchParams({ clientId: ctx.credentials.clientId }).toString() },
      codeOf,
    ),
  exchange: (ctx, input) =>
    call(
      ctx,
      tokenRequest({
        grantType: "authorization_code",
        clientId: ctx.credentials.clientId,
        clientSecret: ctx.credentials.clientSecret,
        authorizationCode: input.authorizationCode,
        authorizationCodeVerifier: input.verifier,
      }),
      (body) => grantOf(body, true),
    ),
  refresh: (ctx, input) =>
    call(
      ctx,
      tokenRequest({
        grantType: "refresh_token",
        clientId: ctx.credentials.clientId,
        clientSecret: ctx.credentials.clientSecret,
        refreshToken: input.refreshToken,
      }),
      (body) => grantOf(body, false),
    ),
  merchants: (ctx, input) => listMerchants(ctx, input.accessToken),
};
