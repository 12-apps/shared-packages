/**
 * The request-session seam: one function every guard calls, so that adding a
 * SECOND way to authenticate does not fork the guards.
 *
 * A host's guards ask "who is signed in" by calling Auth.js `auth()`, which
 * reads the session cookie. The moment anything else may authenticate — an MCP
 * agent presenting `Authorization: Bearer <token>`, a service credential — the
 * host either forks every guard or introduces a shim. Every host introduces the
 * shim, and it is the same shim: read the header, hand the token to a verifier
 * the host installed, and synthesize a session of the SAME shape from the
 * verified identity, so that everything downstream re-derives what it trusts
 * from `session.user.email` exactly as before.
 *
 * That shape is `ExtendedSession`, which is this package's. Building it by hand
 * in a host is how the `isSuperadmin` claim drifts from the resolver the sign-in
 * path uses — this module derives it from the SAME
 * {@link SessionAdminResolver} the config holds, so the synthesized claim
 * cannot disagree with the cookie one.
 *
 * The shim holds NO authorization logic. The verifier produces identity +
 * scopes; the scopes ride on the session so a mutating caller can refuse a
 * read-only token with `insufficient_scope`, and everything else stays in the
 * host's unchanged guards.
 */

import type { ExtendedSession } from '../build-config';

/**
 * The verified identity carried by a validated access token.
 *
 * PRODUCING it — validating the token's signature, audience and scope — is the
 * host's resource-server responsibility, and is deliberately not implemented
 * here: this module only maps a verified identity onto the session shape.
 */
export interface VerifiedBearerIdentity {
  email: string;
  name?: string | null;
  image?: string | null;
  /** OAuth subject claim, for logging and traceability. */
  subject?: string;
  /** Scopes the access token granted (empty when the verifier omits them). */
  scopes?: string[];
}

/**
 * The host's resource-server verifier: the incoming token and the request
 * origin (needed to check the token's `iss`/`aud`), resolving to an identity or
 * `null` on ANY failure. The origin is optional so a single-argument verifier
 * still satisfies it.
 */
export type BearerVerifier = (
  token: string,
  origin?: string,
) => Promise<VerifiedBearerIdentity | null>;

/**
 * A cookie session augmented with the scopes granted to a bearer. Absent for
 * cookie callers.
 */
export type RequestSession = ExtendedSession & { scopes?: string[] };

/**
 * The verifier lives on a process-global keyed by a registry SYMBOL rather than
 * a module-level `let`.
 *
 * A bundler can give the instrumentation module graph and the request module
 * graph SEPARATE instances of a module, so a `let` written by the startup
 * install is invisible to the read on the request path — still null, so every
 * token 401s, and nothing about it looks broken. `Symbol.for` resolves to the
 * same symbol across every bundle in the process, which makes the install
 * observable wherever it is read.
 */
const VERIFIER_KEY = Symbol.for('12-apps.auth.bearerVerifier');
const verifierStore = globalThis as unknown as Record<
  symbol,
  BearerVerifier | null | undefined
>;

/** The installed verifier, or `null` while bearer auth is off. */
export function getBearerVerifier(): BearerVerifier | null {
  return verifierStore[VERIFIER_KEY] ?? null;
}

/**
 * Install the verifier (once, at startup). Until it is installed, bearer tokens
 * are IGNORED and only cookie sessions resolve — so enabling token auth is an
 * explicit, reviewable step rather than a default.
 */
export function setBearerVerifier(verifier: BearerVerifier | null): void {
  verifierStore[VERIFIER_KEY] = verifier;
}

/**
 * `Authorization: Bearer <token>` -> the token, or `null`.
 *
 * Parsed by SCANNING rather than with `/^Bearer\s+(.+)$/i`, which is what this
 * replaced. That pattern is a polynomial ReDoS on a header an attacker
 * controls: `\s+` and `(.+)` can both match a space, so for an input where the
 * anchor cannot hold — `"Bearer"`, many spaces, then a newline, which `.` may
 * not cross — the engine retries every split point and rescans from each.
 * Measured on Node 22: 2k spaces 4.5ms, 8k 78ms, 16k 310ms, 32k 1,196ms. Four
 * times the input, sixteen times the work, and one request can spend it.
 *
 * The scan below is linear: 200k of the same input costs 0.56ms.
 */
export function readBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const value = headerValue.trim();
  const scheme = 'bearer';
  if (value.length <= scheme.length) return null;
  if (value.slice(0, scheme.length).toLowerCase() !== scheme) return null;

  // At least one space or tab must separate the scheme from the token;
  // anything else means a different scheme that merely starts the same way
  // (`BearerToken …`).
  let index = scheme.length;
  const isSeparator = (char: string | undefined) => char === ' ' || char === '\t';
  if (!isSeparator(value[index])) return null;
  while (index < value.length && isSeparator(value[index])) index += 1;

  const token = value.slice(index).trim();
  return token ? token : null;
}

export interface RequestSessionConfig {
  /** Auth.js `auth()` — the one thing that decides what a cookie session is. */
  auth: (request: Request) => Promise<unknown>;
  /**
   * The incoming `Authorization` header when no explicit `Request` is given —
   * an ambient request scope. Throwing means "not in a request", which is not
   * an error: there is simply no bearer, and the caller falls back to the
   * cookie exactly as it did before the shim existed.
   */
  ambientAuthorization?: () => Promise<string | null>;
  /** The request a cookie session is read from when the caller passes none. */
  ambientRequest?: () => Request | undefined;
  /** The origin the verifier checks `iss`/`aud` against. */
  resolveOrigin?: (request?: Request) => Promise<string | undefined>;
  /**
   * The SAME resolver the sign-in path uses, so the synthesized `isSuperadmin`
   * cannot diverge from the cookie one.
   */
  isSuperadmin: (email: string | null | undefined) => boolean | Promise<boolean>;
}

/** Build a session from a verified identity, in the cookie session's shape. */
async function sessionFromIdentity(
  config: RequestSessionConfig,
  identity: VerifiedBearerIdentity,
): Promise<RequestSession> {
  const isSuperadmin = await config.isSuperadmin(identity.email);
  return {
    user: {
      // Best-effort: the OAuth subject. Guards needing the host's own user id
      // resolve it by email regardless, which is why a correctly-verified
      // email is all the passthrough has to produce.
      id: identity.subject ?? '',
      email: identity.email,
      name: identity.name ?? null,
      image: identity.image ?? null,
      provider: 'bearer',
      isSuperadmin,
    },
    scopes: identity.scopes ?? [],
    // The session shape requires `expires`; token lifetime is enforced by the
    // verifier (an expired token verifies to null), so a nominal value is right.
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as RequestSession;
}

async function incomingToken(
  config: RequestSessionConfig,
  request?: Request,
): Promise<string | null> {
  if (request) return readBearerToken(request.headers.get('authorization'));
  if (!config.ambientAuthorization) return null;
  try {
    return readBearerToken(await config.ambientAuthorization());
  } catch {
    return null;
  }
}

/**
 * Build the resolver every guard calls.
 *
 * A verified bearer takes precedence; otherwise the cookie session.
 *
 * A bearer that is PRESENT but does not verify resolves to `null` rather than
 * falling back to the cookie: the caller asked for token auth and it failed,
 * and silently answering with whoever happens to hold a cookie in that browser
 * is a different principal than the one the request named.
 */
export function createRequestSession(config: RequestSessionConfig) {
  return async function getRequestSession(request?: Request): Promise<RequestSession | null> {
    const token = await incomingToken(config, request);
    const verifier = getBearerVerifier();

    if (token && verifier) {
      const identity = await verifier(token, await config.resolveOrigin?.(request));
      return identity ? sessionFromIdentity(config, identity) : null;
    }

    // With neither an explicit nor an ambient request, a cookie-less request
    // stands in rather than an early `null`. The outcome is the same, but it
    // keeps `auth()` the one thing that decides what a session is instead of
    // putting a second "there is no session" rule here that could drift.
    const cookieRequest =
      request ?? config.ambientRequest?.() ?? new Request('http://localhost/');
    return (await config.auth(cookieRequest)) as RequestSession | null;
  };
}

/**
 * Verify an incoming token and return it VERBATIM for forwarding.
 *
 * A proxy that replays the caller's own token on the wrapped endpoint — where
 * it is verified again — is how an agent's call stays authorized exactly like
 * the user's own, rather than being re-minted with authority nobody granted.
 * `null` when there is no bearer, or it does not verify, or bearer auth is off.
 */
export function createBearerForwarder(config: RequestSessionConfig) {
  return async function verifyIncomingBearer(request?: Request): Promise<string | null> {
    const token = await incomingToken(config, request);
    const verifier = getBearerVerifier();
    if (!token || !verifier) return null;
    const identity = await verifier(token, await config.resolveOrigin?.(request));
    return identity ? token : null;
  };
}
