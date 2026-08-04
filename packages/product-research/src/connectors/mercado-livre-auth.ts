import { z } from 'zod';
import type { ConnectorContext } from './types';

/**
 * Central OAuth2 token seam for the Mercado Livre connector (FUT-417). ML's
 * search endpoints require an access token under current policy; one instance
 * per host acquires and refreshes it for every ML source, and any persistent
 * failure surfaces as `null` — the connector degrades the source, the token
 * machinery never throws into a research run.
 */

const DEFAULT_ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

/** ML app tokens live 6h; used when the token payload omits `expires_in`. */
const TOKEN_TTL_FALLBACK_SECONDS = 6 * 60 * 60;
/** Refresh this long before expiry so an in-flight search never races the cutoff. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export interface MercadoLivreCredentials {
  clientId: string;
  clientSecret: string;
  /** User token from the authorization-code flow; absent ⇒ app-only `client_credentials`. */
  refreshToken?: string;
}

/** Central token seam: one instance per host, shared by every ML source. */
export interface MercadoLivreAuth {
  /** Cached-or-fresh bearer token, or null on persistent auth failure. */
  getAccessToken(ctx: ConnectorContext): Promise<string | null>;
  /** Forget the cached token so the next call re-authenticates. */
  invalidate(): void;
}

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive().nullish(),
  refresh_token: z.string().min(1).nullish(),
});

export const createMercadoLivreAuth = (options: {
  /** Read per request so rotated env/Doppler values apply without a restart. */
  credentials: () => MercadoLivreCredentials | null;
  tokenUrl?: string;
  now?: () => number;
}): MercadoLivreAuth => {
  const tokenUrl = options.tokenUrl ?? DEFAULT_ML_TOKEN_URL;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  // ML rotates the refresh token on every grant; the configured value is only
  // the seed and the latest rotation lives here for the process's lifetime.
  let rotatedRefreshToken: string | undefined;
  let pending: Promise<string | null> | null = null;

  const grantForm = (credentials: MercadoLivreCredentials): Record<string, string> => {
    const refreshToken = rotatedRefreshToken ?? credentials.refreshToken;
    const client = { client_id: credentials.clientId, client_secret: credentials.clientSecret };
    return refreshToken
      ? { grant_type: 'refresh_token', ...client, refresh_token: refreshToken }
      : { grant_type: 'client_credentials', ...client };
  };

  const requestToken = async (ctx: ConnectorContext): Promise<string | null> => {
    const credentials = options.credentials();
    if (credentials === null) {
      ctx.logger.warn('mercado livre auth: no credentials configured');
      return null;
    }
    if (ctx.postForm === undefined) {
      ctx.logger.warn('mercado livre auth: host transport provides no postForm');
      return null;
    }
    const payload = await ctx.postForm(tokenUrl, grantForm(credentials));
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      ctx.logger.warn('mercado livre auth: token endpoint refused the grant');
      return null;
    }
    if (parsed.data.refresh_token) rotatedRefreshToken = parsed.data.refresh_token;
    cached = {
      token: parsed.data.access_token,
      expiresAt: now() + (parsed.data.expires_in ?? TOKEN_TTL_FALLBACK_SECONDS) * 1000,
    };
    return cached.token;
  };

  return {
    getAccessToken(ctx) {
      if (cached !== null && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > now()) {
        return Promise.resolve(cached.token);
      }
      pending ??= requestToken(ctx).finally(() => {
        pending = null;
      });
      return pending;
    },
    invalidate() {
      cached = null;
    },
  };
};
