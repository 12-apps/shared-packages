import { ProviderRequestError } from '../core/errors';
import { pagbankConnectError } from './pagbank-connect-errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { OAuthTokens, ResolvedCredentials } from '../core/types';
import { providerFetch } from './http';
import { NAME } from './pagbank-http';

/**
 * PagBank Connect — the OAuth2 flow that lets a store authorize the host
 * platform on their EXISTING PagBank account instead of pasting a token.
 *
 * Of the four providers this package integrates, PagBank is one of only two
 * with a genuine merchant-authorization flow (Stripe is the other), so this is
 * the happy path for onboarding. The pasted-token form stays as a fallback for
 * stores connected before Connect existed.
 *
 * Two things about PagBank's flow that differ from Stripe's:
 *   - The authorization CODE is single-use and expires in 10 minutes, so the
 *     callback must exchange it immediately.
 *   - The access token EXPIRES. `expiresAt` is returned so the host's refresh
 *     sweep can renew it before a store silently stops taking payments.
 */

/**
 * Consent screens are hosted on connect.*, the token endpoint on the API host.
 *
 * Both consent hosts are on `pagbank.com.br`. The legacy PagSeguro host
 * (`connect.pagseguro.uol.com.br`) no longer serves the flow — it bounces to
 * `connect-web.pagbank.com.br/error` ("Não foi possível seguir com a
 * integração de contas") BEFORE the merchant ever sees a consent screen, so
 * the failure looks like a rejected application rather than a dead host.
 */
const AUTHORIZE_BASE = {
  PRODUCTION: 'https://connect.pagbank.com.br',
  SANDBOX: 'https://connect.sandbox.pagbank.com.br',
} as const;

const TOKEN_BASE = {
  PRODUCTION: 'https://api.pagseguro.com',
  SANDBOX: 'https://sandbox.api.pagseguro.com',
} as const;

/**
 * Least privilege that still runs a store: read and create payments, plus
 * refunds. Overridable per deployment because PagBank grants scopes per
 * registered application.
 */
const DEFAULT_SCOPES = 'payments.read payments.create payments.refund';

function baseFor(
  table: typeof AUTHORIZE_BASE | typeof TOKEN_BASE,
  credentials: ResolvedCredentials,
): string {
  return credentials.environment === 'PRODUCTION' ? table.PRODUCTION : table.SANDBOX;
}

interface PagBankTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  account_id?: string;
}

/**
 * The token endpoint takes THREE credentials, not two, and none of them the
 * RFC 6749 way:
 *
 *   - `X_CLIENT_ID` / `X_CLIENT_SECRET` — the application's own pair, in
 *     bespoke headers rather than HTTP Basic, with a JSON (not form-encoded)
 *     body. Sending the conventional shape fails the exchange.
 *   - `Authorization: Bearer <account token>` — the PARTNER's account token.
 *     Required in addition to the pair above, which is easy to miss because
 *     no other OAuth2 server asks for it and the application credentials look
 *     complete on their own.
 *
 * Omitting the Bearer costs a whole afternoon to diagnose, because PagBank
 * answers `401 41008 invalid_token` — a message that reads like "your client
 * credentials are wrong" and sends you auditing env vars that were correct all
 * along. It is `invalid_token` literally: the missing *token* is this header.
 * The giveaway is that the error is identical whatever id/secret you send,
 * including none at all, since it is raised before they are examined.
 */
/** The bespoke header trio every Connect call needs — see the note above. */
function connectHeaders(appCredentials: ResolvedCredentials): Record<string, string> {
  const accountToken = appCredentials.fields['accountToken'];
  if (!accountToken) {
    // Fail with the cause named, rather than letting PagBank answer with the
    // `invalid_token` that points at the wrong credential entirely.
    throw new ProviderRequestError(
      NAME,
      'PagBank OAuth needs the partner account token (accountToken) for the ' +
        'Authorization header; set PAGBANK_TOKEN (or PAGBANK_TOKEN_PROD).',
      { retriable: false },
    );
  }
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accountToken}`,
    X_CLIENT_ID: appCredentials.fields['clientId'] ?? '',
    X_CLIENT_SECRET: appCredentials.fields['clientSecret'] ?? '',
  };
}

/**
 * Re-throw a Connect failure with PagBank's code translated into its meaning.
 *
 * The raw error already carries the status and the first 300 characters of the
 * body, which is how the code reaches us at all — but a bare `41008` reads as
 * "bad client credentials" and is not. Naming it in the message is the whole
 * fix: this is the string that lands in the log and in the OAuth callback's
 * failure detail, which is where anyone diagnosing a broken connect will look.
 */
async function connectRequest<T>(url: string, appCredentials: ResolvedCredentials, body: unknown): Promise<T> {
  try {
    return await providerFetch<T>(NAME, 'PagBank OAuth', url, {
      method: 'POST',
      headers: connectHeaders(appCredentials),
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!(error instanceof ProviderRequestError)) throw error;
    const named = pagbankConnectError(error.message);
    if (!named) throw error;
    throw new ProviderRequestError(NAME, `${error.message} [${named}]`, {
      httpStatus: error.options.httpStatus,
      retriable: error.options.retriable,
      body: error.options.body,
    });
  }
}

async function tokenRequest(
  appCredentials: ResolvedCredentials,
  body: Record<string, string>,
  path: '/oauth2/token' | '/oauth2/refresh' = '/oauth2/token',
): Promise<PagBankTokenResponse> {
  return connectRequest<PagBankTokenResponse>(
    `${baseFor(TOKEN_BASE, appCredentials)}${path}`,
    appCredentials,
    body,
  );
}

/**
 * Token types a disconnect must invalidate.
 *
 * BOTH, and the refresh token is not optional: killing only the access token
 * leaves a refresh token that can mint a fresh one, so the merchant would have
 * revoked nothing they could observe. Ordered access-first only so the shorter-
 * lived credential dies soonest; the Authorization header carries the PLATFORM
 * account token, so revoking either does not cost us the ability to send the
 * other.
 */
const REVOCABLE: readonly (readonly [hint: string, field: string])[] = [
  ['access_token', 'token'],
  ['refresh_token', 'refreshToken'],
];

/**
 * Map a token response onto the merchant's stored fields.
 *
 * `token` is deliberately the key the charge path already reads, so an
 * OAuth-connected store and a token-pasting store take the exact same code
 * path from here on.
 *
 * The platform's `webhookToken` and `notificationUrl` are copied in because
 * Connect deliveries are authenticated with the PLATFORM's webhook token —
 * a connected store never sees one of its own.
 */
function toTokens(
  res: PagBankTokenResponse,
  appCredentials: ResolvedCredentials,
  previous: Record<string, string> = {},
): OAuthTokens {
  if (!res.access_token) {
    throw new ProviderRequestError(NAME, 'PagBank OAuth response carried no access token.', {
      retriable: false,
    });
  }
  const fields: Record<string, string> = { ...previous, token: res.access_token };
  // A refresh response may omit the refresh token; the original must survive.
  if (res.refresh_token) fields['refreshToken'] = res.refresh_token;
  if (res.account_id) fields['accountId'] = res.account_id;
  if (res.scope) fields['scope'] = res.scope;
  for (const key of ['webhookToken', 'notificationUrl', 'publicKey'] as const) {
    const value = appCredentials.fields[key];
    if (value) fields[key] = value;
  }
  return {
    fields,
    // Subtract nothing: the host's sweep decides its own safety margin.
    expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null,
  };
}

export const pagbankOAuth: NonNullable<PaymentProviderAdapter['oauth']> = {
  async buildAuthorizeUrl(appCredentials, ctx) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: appCredentials.fields['clientId'] ?? '',
      redirect_uri: ctx.redirectUri,
      scope: appCredentials.fields['scope'] ?? DEFAULT_SCOPES,
      state: ctx.state,
    });
    return {
      url: `${baseFor(AUTHORIZE_BASE, appCredentials)}/oauth2/authorize?${params.toString()}`,
      state: ctx.state,
    };
  },

  async exchangeCode(code, appCredentials, ctx) {
    const res = await tokenRequest(appCredentials, {
      grant_type: 'authorization_code',
      code,
      // PagBank re-validates the redirect URI against the one authorized.
      redirect_uri: ctx.redirectUri,
    });
    return toTokens(res, appCredentials);
  },

  /**
   * Renewal lives at its OWN endpoint — `/oauth2/refresh`, not `/oauth2/token`.
   *
   * Sending `grant_type=refresh_token` to the token endpoint answers `41005
   * unsupported_grant_type`, which reads as "PagBank cannot refresh" and is the
   * opposite of what that code means: its published definition is *"only
   * `authorization_code` and `refresh_token` grant types are supported"*. The
   * grant was always supported; the URL was wrong, and no grant could be
   * renewed for as long as that shipped.
   *
   * PagBank ROTATES on every renewal — the response carries a new
   * `refresh_token` and the one just spent is invalidated immediately — so a
   * response without one leaves us holding a dead token. Failing here marks the
   * connection for reauthorization now, rather than letting it look healthy and
   * die at the next renewal, far from the cause.
   */
  async refresh(current, appCredentials) {
    const refreshToken = current.fields['refreshToken'];
    if (!refreshToken) {
      throw new ProviderRequestError(NAME, 'PagBank connection has no refresh token.', {
        retriable: false,
      });
    }
    const res = await tokenRequest(
      appCredentials,
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      '/oauth2/refresh',
    );
    if (!res.refresh_token) {
      throw new ProviderRequestError(
        NAME,
        'PagBank renewed the access token but returned no refresh token; the previous one is ' +
          'already invalid, so this connection must be reauthorized.',
        { retriable: false },
      );
    }
    return toTokens(res, appCredentials, current.fields);
  },

  /**
   * Actually disconnect at PagBank — `POST /oauth2/revoke`.
   *
   * Without this the adapter had no `revoke` at all, so the disconnect path
   * skipped revocation entirely and merely cleared our own row: the grant
   * stayed live at PagBank indefinitely, while the confirmation dialog told the
   * merchant their authorization would be revoked and their store would stop
   * being chargeable immediately. Neither was true.
   *
   * Every token type is attempted even if an earlier one fails, because a
   * partial revocation is the worst outcome available — a surviving refresh
   * token can mint a new access token, so stopping at the first error would
   * leave the connection alive while reporting that it had been closed.
   */
  async revoke(current, appCredentials) {
    // Resolved once up front so a missing account token fails before any
    // token is sent, rather than partway through the loop.
    connectHeaders(appCredentials);
    const url = `${baseFor(TOKEN_BASE, appCredentials)}/oauth2/revoke`;
    const failures: string[] = [];

    for (const [hint, field] of REVOCABLE) {
      const token = current.fields[field];
      if (!token) continue;
      try {
        // The response carries no body worth reading; `providerFetch` already
        // treats an empty one as success for exactly these calls.
        await connectRequest<unknown>(url, appCredentials, { token_type_hint: hint, token });
      } catch (error) {
        failures.push(`${hint}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (failures.length > 0) {
      throw new ProviderRequestError(
        NAME,
        `PagBank did not revoke every token (${failures.join('; ')}).`,
        { retriable: true },
      );
    }
  },
};
