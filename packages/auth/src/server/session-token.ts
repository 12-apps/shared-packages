/**
 * Minting a session cookie by hand — the half of a cross-domain sign-in handoff
 * that is pure Auth.js mechanism.
 *
 * WHY A HOST NEEDS THIS AT ALL. An OAuth client registers a FIXED list of
 * redirect URIs, so a platform selling custom domains cannot add every tenant's
 * hostname to the provider's console: the round trip has to happen on the
 * platform origin. That leaves the half nobody sees until they try it — the
 * session cookie Auth.js writes at the end is HOST-ONLY to the platform. It is
 * not a `Domain=` cookie and could not be, because the store's domain is a
 * different registrable domain entirely. So "come back afterwards" is not
 * enough; coming back has to also bring a session, which means minting one on
 * the other origin.
 *
 * Everything here mirrors a derivation Auth.js already makes, and every one of
 * them fails SILENTLY when it is wrong — no error anywhere, just a cookie
 * nothing looks for and a storefront that stays logged out. That is precisely
 * the kind of rule that must not be re-derived per host:
 *
 *  - the cookie NAME follows the `__Secure-` prefix from the resolved base
 *    URL's protocol, because that is how Auth.js picks it;
 *  - the encryption key is SALTED with that name, so a token encoded under a
 *    different string cannot be decrypted by the handler that reads it back;
 *  - the claim names are Auth.js's own (`sub`, `name`, `email`, `picture`),
 *    which is what its default session callback reads to build `session.user`.
 *
 * What stays the HOST's is the ticket that authorizes the mint — a row, a
 * single-use claim, a hostname check — because that is a table this package
 * does not own.
 */

import { encode } from '@auth/core/jwt';

/** The identity claims a minted session carries. */
export interface SessionTokenIdentity {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  provider: string | null;
  isSuperadmin: boolean;
}

export interface SessionTokenConfig {
  /** `AUTH_SECRET`. Without it a minted session cannot be decrypted. */
  secret: string;
  /**
   * The deployment's resolved base URL (`AUTH_URL`). Only its PROTOCOL is
   * read, and only to mirror how Auth.js decides the `__Secure-` prefix.
   */
  baseUrl: string | undefined;
  /** Session lifetime. Must match what the host's Auth.js config issues. */
  maxAgeSeconds: number;
}

/**
 * Whether Auth.js is using `__Secure-`-prefixed cookies on this deployment.
 *
 * Auth.js derives this from the protocol of its resolved base URL, so mirroring
 * that derivation — rather than picking a name — is what keeps the cookie
 * readable by the session handler that has to read it back.
 */
function usesSecureCookies(config: SessionTokenConfig): boolean {
  return (config.baseUrl ?? '').startsWith('https://');
}

/** The cookie name Auth.js reads the session from on this deployment. */
export function sessionCookieName(config: SessionTokenConfig): string {
  return `${usesSecureCookies(config) ? '__Secure-' : ''}authjs.session-token`;
}

/**
 * Encrypt a session token for `identity`, in the exact shape Auth.js's
 * `jwt`/`session` callbacks put there at an ordinary sign-in.
 *
 * A session minted here is therefore indistinguishable from one minted by the
 * OAuth flow — which is the point, because everything downstream reads it
 * through the same `auth()`.
 */
export function encodeSessionToken(
  config: SessionTokenConfig,
  identity: SessionTokenIdentity,
): Promise<string> {
  if (!config.secret) {
    throw new Error('A session secret is required to mint a session token');
  }
  return encode({
    secret: config.secret,
    // Auth.js salts the derived encryption key with the COOKIE NAME, so this
    // must be the same string the cookie is written under or the token it
    // reads back cannot be decrypted.
    salt: sessionCookieName(config),
    maxAge: config.maxAgeSeconds,
    token: {
      sub: identity.id,
      id: identity.id,
      email: identity.email,
      name: identity.name,
      picture: identity.image,
      provider: identity.provider,
      isSuperadmin: identity.isSuperadmin,
    },
  });
}

/**
 * `Set-Cookie` for a freshly minted session.
 *
 * `SameSite=Lax`, matching Auth.js's own cookie: the claim arrives as a
 * top-level GET navigation, which `Lax` allows, and anything stricter would
 * make the session invisible on the very redirect that follows.
 */
export function sessionCookieHeader(config: SessionTokenConfig, token: string): string {
  const parts = [
    `${sessionCookieName(config)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${config.maxAgeSeconds}`,
  ];
  if (usesSecureCookies(config)) parts.push('Secure');
  return parts.join('; ');
}
