import { Auth, setEnvDefaults as coreSetEnvDefaults } from "@auth/core";
import type { AuthConfig } from "@auth/core";
import type { DefaultSession, Session, User } from "@auth/core/types";

import { authConfig } from "./config";
import { isAdminEmail, parseAdminEmails } from "./admin";

/**
 * The app's Auth.js entrypoint (FUT-665).
 *
 * `apps/web` used to get these from `NextAuth(authConfig)`. That wrapper did
 * three things: apply the `AUTH_*` env defaults, rewrite the request's origin to
 * `AUTH_URL`, and expose a `next/headers`-backed `auth()`. The first two are
 * reproduced here against `@auth/core` (which is what the wrapper called);
 * the third becomes an `auth(request)` that takes the request explicitly — which
 * is what its one caller had in hand anyway, and is why nothing about the
 * sign-in flow, the cookie or the callback URLs changed.
 */

setEnvDefaults(authConfig);

/**
 * Apply the `AUTH_*` environment defaults, matching `next-auth`'s behaviour.
 *
 * Its `NEXTAUTH_SECRET`/`NEXTAUTH_URL` fallbacks are dropped: they were v4
 * compatibility aliases, and nothing in this repo — compose, Doppler, the
 * deploy scripts — has ever set one.
 *
 * `basePath` is the part that matters: Auth.js core defaults to `/auth`, while
 * the next-auth wrapper defaulted to `/api/auth` — which is where this app's
 * route lives and what every issued callback URL already points at. Taking
 * core's default instead would invalidate the OAuth redirect URIs registered
 * with Google, Facebook and Apple.
 */
function setEnvDefaults(config: AuthConfig): void {
  config.secret ??= process.env.AUTH_SECRET;
  try {
    const url = process.env.AUTH_URL;
    if (url) {
      const { pathname } = new URL(url);
      if (pathname !== "/") config.basePath ||= pathname;
    }
  } catch {
    // A malformed AUTH_URL falls through to the `/api/auth` default below.
  }
  config.basePath ||= "/api/auth";
  coreSetEnvDefaults(process.env, config, true);
}

/**
 * Re-origin a request onto `AUTH_URL`.
 *
 * Behind Caddy the app is reached as `web:3000`, so the URL Auth.js sees is not
 * the one the browser used — and Auth.js derives the OAuth `redirect_uri` and
 * the cookie attributes from it. `next-auth` rewrote the origin for exactly this
 * reason; dropping the rewrite would send merchants back to `http://web:3000`
 * after they authorize at the provider.
 *
 * The body is forwarded as a stream (`duplex: "half"`, which Node requires for
 * one), and that matters here: the OAuth callback and sign-out both POST a form.
 */
function reqWithEnvUrl(request: Request): Request {
  const url = process.env.AUTH_URL;
  if (!url) return request;
  const { origin: envOrigin } = new URL(url);
  const { origin } = new URL(request.url);
  if (origin === envOrigin) return request;
  return new Request(request.url.replace(origin, envOrigin), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

/**
 * Serve an `/api/auth/**` request (sign-in, callback, session, CSRF, sign-out).
 *
 * The single replacement for `NextAuth().handlers`, which was itself only
 * `Auth(reqWithEnvURL(req), config)`.
 */
export function authHandler(request: Request): Promise<Response> {
  return Auth(reqWithEnvUrl(request), authConfig) as Promise<Response>;
}

/** The GET/POST pair the auth route exports, keeping the old `handlers` shape. */
export const handlers = { GET: authHandler, POST: authHandler };

/**
 * The session for an incoming request, or `null`.
 *
 * Deliberately routed through {@link authHandler} rather than decoding the
 * cookie here: the reader and the writer are then the SAME code path, so a
 * change to the session strategy, the cookie name or the callbacks cannot leave
 * the two disagreeing about what a session is.
 *
 * Only the request's cookies are forwarded. Nothing else about the incoming
 * request should decide what its session is, and passing the rest through would
 * let a caller's `Origin`/`Referer` reach Auth.js's CSRF checks from a route
 * that never meant to perform an auth action.
 */
export async function auth(request: Request): Promise<Session | null> {
  const { origin } = new URL(request.url);
  const basePath = authConfig.basePath ?? "/api/auth";
  const cookie = request.headers.get("cookie");
  const sessionRequest = new Request(`${origin}${basePath}/session`, {
    headers: cookie ? { cookie } : {},
  });
  const response = await authHandler(sessionRequest);
  if (!response.ok) return null;
  // Auth.js answers 200 `{}` — not 401 — when there is no valid session.
  const session = (await response.json()) as Partial<Session> | null;
  return session?.user ? (session as Session) : null;
}

/**
 * Re-export the config (and its `ExtendedSession` type) so consumers can reach
 * it from the package root, while `@12-apps/auth/config` stays importable without
 * applying the env defaults (tests).
 */
export { authConfig };
export { setSignInGate, setSessionAdminResolver } from "./config";
export type { ExtendedSession, SignInGate, SessionAdminResolver } from "./config";

/**
 * Admin allowlist helpers (also available via `@12-apps/auth/admin` for
 * dependency-free contexts such as unit tests).
 */
export { isAdminEmail, parseAdminEmails };

/**
 * Type exports for consumers
 */
export type { AuthConfig, DefaultSession, Session, User };
