import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { PaymentEnvironment } from '../core/types';

/**
 * CSRF state for the provider connect flow — the double-submit machinery
 * (ported from the first adopting host, FUT-760).
 *
 * OAuth's `state` only protects anything if the value that comes back on the
 * callback is compared against one the host minted for THIS admin's browser:
 *
 *   1. `mint` generates a random value, returns it to the browser AND encodes
 *      it into an httpOnly cookie the browser cannot read.
 *   2. The provider echoes the value back on the callback query string.
 *   3. `consume` requires the two to match — constant-time, because a state
 *      check is an authentication check — then the host deletes the cookie so
 *      a replayed callback cannot connect a second time.
 *
 * WHICH merchant a callback belongs to (and which environment) travels in the
 * cookie, never in the redirect URI: providers pin the redirect URI to one
 *
 * pre-registered string per application, so it cannot vary by tenant, and
 * everything the provider echoes back is attacker-writable.
 *
 * The package still never SEES a cookie — transport is a host concern by this
 * package's own contract. What lives here is the state machine around the
 * value: minting, encoding, the parse-from-the-ends layout, the constant-time
 * match. The host contributes only its facts, all REQUIRED: its cookie name
 * prefix, the callback path its route answers on, and its public origin.
 */
export interface ConnectStateConfig {
  /** The host's cookie namespace — the cookie is `<prefix>_<provider>`. */
  cookiePrefix: string;
  /**
   * The single path every provider callback lands on. The cookie is scoped to
   * it so the browser sends the state back on that top-level navigation and
   * on nothing else.
   */
  callbackPath: string;
  /**
   * The deployment's public origin, resolved per call (hosts derive it from
   * env). `secure` is derived from it: plain-http development keeps working,
   * https production gets a secure cookie.
   */
  baseUrl: () => string;
  /**
   * Cookie lifetime. Defaults to 600s — longer than any consent screen,
   * shorter than a stale tab. A duration is flow mechanism, not a host
   * vocabulary, which is why this one may default.
   */
  maxAgeSeconds?: number;
}

interface ConnectStateCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: string;
    maxAge: number;
  };
}

export interface MintedConnectState {
  state: string;
  redirectUri: string;
  environment: PaymentEnvironment;
  cookie: ConnectStateCookie;
}

/** What a valid, unexpired connect cookie attributes a callback to. */
export interface ConnectAttribution {
  environment: PaymentEnvironment;
  tenantSlug: string;
}

/**
 * SANDBOX unless PRODUCTION was asked for explicitly. The safe default
 * matters: a garbled or missing value must not silently authorize and store a
 * LIVE grant.
 */
export function parseEnvironment(value: string | null | undefined): PaymentEnvironment {
  return value === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
}

/**
 * Layout is `environment.tenantSlug.state`, parsed from the ENDS rather than
 * by a plain split so a slug containing a dot cannot shift the fields.
 */
function decodeCookie(value: string | undefined): {
  state: string;
  environment: PaymentEnvironment;
  tenantSlug: string;
} {
  const parts = (value ?? '').split('.');
  // environment + tenantSlug + state — anything shorter is truncated garbage.
  if (parts.length < 3) return { state: '', environment: 'SANDBOX', tenantSlug: '' };
  return {
    environment: parseEnvironment(parts[0]),
    state: parts[parts.length - 1] ?? '',
    tenantSlug: parts.slice(1, -1).join('.'),
  };
}

/** Constant-time comparison — a state check is an authentication check. */
function stateMatches(expected: string | undefined, presented: string | null): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ConnectState {
  /** The cookie a pending connect for `provider` lives in. */
  stateCookieName: (provider: string) => string;
  /**
   * Where the provider sends the merchant back — ONE registered URL per
   * provider for the whole deployment, never per tenant.
   */
  redirectUri: (provider: string) => string;
  /**
   * Mint the state and the cookie that carries it. `sameSite: 'lax'`, not
   * `'strict'`: the callback arrives as a top-level navigation from the
   * provider's domain, and a strict cookie would not be sent with it.
   */
  mint: (
    tenantSlug: string,
    provider: string,
    environment: PaymentEnvironment,
  ) => MintedConnectState;
  /**
   * Check the echoed state against the cookie and recover what the connect
   * was started for. Null when the two do not match or the cookie names no
   * merchant — the only signals a callback should act on.
   */
  consume: (cookieValue: string | undefined, presented: string | null) => ConnectAttribution | null;
  /**
   * Recover ONLY the merchant a pending connect belongs to, without
   * validating the state — a refusal still has to land the admin back on the
   * right settings page. Safe to read early precisely because the value is
   * server-authored; never a substitute for `consume`.
   */
  peekTenant: (cookieValue: string | undefined) => string | null;
}

export function createConnectState(config: ConnectStateConfig): ConnectState {
  const maxAge = config.maxAgeSeconds ?? 600;
  return {
    stateCookieName: (provider) => `${config.cookiePrefix}_${provider}`,
    redirectUri: (provider) =>
      `${config.baseUrl()}${config.callbackPath}/${encodeURIComponent(provider)}`,
    mint(tenantSlug, provider, environment) {
      const state = randomBytes(32).toString('hex');
      return {
        state,
        redirectUri: this.redirectUri(provider),
        environment,
        cookie: {
          name: this.stateCookieName(provider),
          value: `${environment}.${tenantSlug}.${state}`,
          options: {
            httpOnly: true,
            secure: config.baseUrl().startsWith('https://'),
            sameSite: 'lax',
            path: config.callbackPath,
            maxAge,
          },
        },
      };
    },
    consume(cookieValue, presented) {
      const { state, environment, tenantSlug } = decodeCookie(cookieValue);
      if (!tenantSlug) return null;
      return stateMatches(state, presented) ? { environment, tenantSlug } : null;
    },
    peekTenant(cookieValue) {
      const { tenantSlug } = decodeCookie(cookieValue);
      return tenantSlug || null;
    },
  };
}
