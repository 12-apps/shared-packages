import { ProviderRequestError } from '../core/errors';
import type { ResolvedCredentials } from '../core/types';
import { basicAuth, formEncode, providerFetch } from './http';

/**
 * Stripe transport + Connect OAuth endpoints.
 *
 * Two ways a merchant can be connected, and they authenticate DIFFERENTLY:
 *
 *   - **OAuth (Connect)** — the store authorized the platform, and Stripe
 *     handed back an `access_token` that IS a secret key scoped to their
 *     account. Calls go out as that key, with no `Stripe-Account` header:
 *     the key already resolves to the connected account.
 *   - **Credentials** — the store pasted their own `sk_...`. Same thing, one
 *     key, except a platform charging on behalf of a separately-onboarded
 *     account also sends `Stripe-Account: acct_...`.
 *
 * Keeping both in one place is what lets `stripe.ts` stay pure mapping.
 */

export const NAME = 'stripe';

const API_BASE = 'https://api.stripe.com';
/** The OAuth endpoints live on connect.stripe.com, not the API host. */
const CONNECT_BASE = 'https://connect.stripe.com';

/** Stripe pins the API shape per request; pinning ours makes upgrades explicit. */
const API_VERSION = '2024-06-20';

/**
 * The key this merchant's calls authenticate with. OAuth's access token wins
 * over a pasted secret key — a store that reconnected via OAuth must not keep
 * transacting on a stale key they once typed in.
 */
function apiKeyOf(credentials: ResolvedCredentials): string {
  const key = credentials.fields['accessToken'] ?? credentials.fields['secretKey'] ?? '';
  if (!key) {
    throw new ProviderRequestError(NAME, 'Stripe: no access token or secret key configured.', {
      retriable: false,
    });
  }
  return key;
}

/**
 * Only meaningful in credentials mode: charging a connected account with the
 * PLATFORM's key. An OAuth access token is already account-scoped, so sending
 * the header alongside it would be redundant (and wrong if the ids disagree).
 */
function connectedAccountOf(credentials: ResolvedCredentials): string | undefined {
  if (credentials.fields['accessToken']) return undefined;
  return credentials.fields['connectedAccountId'] || undefined;
}

export async function stripeRequest<T>(
  path: string,
  credentials: ResolvedCredentials,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown>; idempotencyKey?: string },
): Promise<T> {
  const account = connectedAccountOf(credentials);
  const body = init.body === undefined ? undefined : formEncode(init.body);
  // GET params ride in the query string; Stripe rejects a GET with a body.
  const url =
    init.method === 'GET' && body
      ? `${API_BASE}${path}?${body}`
      : `${API_BASE}${path}`;
  return providerFetch<T>(NAME, 'Stripe', url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKeyOf(credentials)}`,
      'Stripe-Version': API_VERSION,
      ...(init.method === 'POST'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
      ...(account ? { 'Stripe-Account': account } : {}),
      // Stripe's native idempotency: a retried create is deduped server-side.
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.method === 'GET' ? undefined : body,
  });
}

// ── Connect OAuth ──────────────────────────────────────────────────────────

/** What `POST /oauth/token` answers with (authorization_code and refresh). */
interface StripeOAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  stripe_user_id?: string;
  stripe_publishable_key?: string;
  scope?: string;
  livemode?: boolean;
}

export function authorizeUrl(
  appCredentials: ResolvedCredentials,
  ctx: { state: string; redirectUri: string },
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appCredentials.fields['clientId'] ?? '',
    // read_write is the minimum that can CREATE charges; read_only would
    // connect successfully and then fail at the first payment.
    scope: appCredentials.fields['scope'] ?? 'read_write',
    redirect_uri: ctx.redirectUri,
    state: ctx.state,
  });
  return `${CONNECT_BASE}/oauth/authorize?${params.toString()}`;
}

/**
 * Token exchange and refresh share one endpoint, authenticated with the
 * PLATFORM's secret key (not a merchant's) — these calls act as the
 * application, before any per-merchant credential exists.
 */
export async function oauthToken(
  appCredentials: ResolvedCredentials,
  body: Record<string, string>,
): Promise<StripeOAuthTokenResponse> {
  const secret = appCredentials.fields['clientSecret'] ?? '';
  return providerFetch<StripeOAuthTokenResponse>(NAME, 'Stripe OAuth', `${CONNECT_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(secret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(body),
  });
}

export async function oauthDeauthorize(
  appCredentials: ResolvedCredentials,
  stripeUserId: string,
): Promise<void> {
  await providerFetch<unknown>(NAME, 'Stripe OAuth', `${CONNECT_BASE}/oauth/deauthorize`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(appCredentials.fields['clientSecret'] ?? ''),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode({
      client_id: appCredentials.fields['clientId'] ?? '',
      stripe_user_id: stripeUserId,
    }),
  });
}

/**
 * Map a token response onto the fields stored for the merchant.
 *
 * The platform's webhook signing secret is copied in DELIBERATELY: Connect
 * deliveries are signed with the PLATFORM's endpoint secret, not with
 * anything the store owns, and `webhook.verify` only ever sees the merchant's
 * resolved credentials. Copying it at connect time is what lets an
 * OAuth-connected store verify its deliveries at all.
 */
export function tokensToFields(
  res: StripeOAuthTokenResponse,
  appCredentials: ResolvedCredentials,
  previous: Record<string, string> = {},
): Record<string, string> {
  const fields: Record<string, string> = { ...previous };
  if (res.access_token) fields['accessToken'] = res.access_token;
  // A refresh response omits `refresh_token`; the original must survive.
  if (res.refresh_token) fields['refreshToken'] = res.refresh_token;
  if (res.stripe_user_id) fields['stripeUserId'] = res.stripe_user_id;
  if (res.stripe_publishable_key) fields['publishableKey'] = res.stripe_publishable_key;
  if (res.scope) fields['scope'] = res.scope;
  if (typeof res.livemode === 'boolean') fields['livemode'] = String(res.livemode);
  const webhookSecret = appCredentials.fields['webhookSecret'];
  if (webhookSecret) fields['webhookSecret'] = webhookSecret;
  return fields;
}
