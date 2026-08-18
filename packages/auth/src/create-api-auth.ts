import { Auth, setEnvDefaults as coreSetEnvDefaults } from "@auth/core";
import type { AuthConfig } from "@auth/core";
import type { Provider } from "@auth/core/providers";
import type { Session } from "@auth/core/types";

import { isAdminEmail } from "./admin";
import {
  buildAuthConfig,
  buildProviders,
  getEnv,
  type SessionAdminResolver,
  type SignInGate,
} from "./build-config";
import {
  credentialsProvider,
  type CredentialsProviderConfig,
} from "./credentials-provider";

/**
 * The backend half of `@12-apps/auth`, as one factory taking one config object.
 *
 * ## What this replaces
 *
 * Adopting auth used to be three separate acts in the host, in the right order:
 *
 * ```ts
 * setSignInGate(signInGate);              // module-level global
 * setSessionAdminResolver(isSuperadmin);  // module-level global
 * export const { GET, POST } = handlers;  // a THIRD import
 * ```
 *
 * Three things to wire, two of them mutable module state that any importer could
 * overwrite, and an ordering constraint nothing enforced — install a gate after
 * the first request and every sign-in before it failed closed. The porting rule
 * asks for one factory and no second thing to wire; this is it:
 *
 * ```ts
 * const { handlers, auth } = createApiAuth({ signInGate, sessionAdmin });
 * export const { GET, POST } = handlers;
 * ```
 *
 * Nothing is global, so two instances cannot interfere and a test needs no
 * reset hook.
 *
 * ## What this package does NOT own
 *
 * **Any database table.** The session strategy is JWT with no adapter, so there
 * are no `User` / `Account` / `Session` rows here and no Prisma partial to
 * adopt. A host's user record is the host's, created by whatever its
 * {@link ApiAuthConfig.signInGate} does. This is worth stating because the
 * obvious assumption — "auth owns the user table" — would have this package
 * shipping migrations for tables nobody writes.
 */

export interface ApiAuthConfig {
  /**
   * Session encryption secret. Defaults to `AUTH_SECRET`.
   */
  secret?: string;
  /**
   * The public origin the app is reached at. Defaults to `AUTH_URL`.
   *
   * Load-bearing behind a reverse proxy: the app is reached internally as
   * `web:3000`, so the URL Auth.js would otherwise see is not the one the
   * browser used — and it derives the OAuth `redirect_uri` and the cookie
   * attributes from it. Without this, a merchant returning from the provider
   * lands on `http://web:3000`.
   */
  authUrl?: string;
  /**
   * Where the auth endpoints are mounted. Defaults to `AUTH_URL`'s pathname,
   * then to `/api/auth`.
   *
   * Auth.js core defaults to `/auth` while the old `next-auth` wrapper defaulted
   * to `/api/auth`, which is what every already-registered OAuth redirect URI
   * points at. Taking core's default would invalidate them.
   */
  basePath?: string;
  /** OAuth providers. Defaults to whatever the environment configures. */
  providers?: Provider[];
  /**
   * Turn on e-mail + password sign-in by handing over the flow's
   * `authenticate` (see `createEmailCredentials`).
   *
   * The credentials provider is APPENDED to the OAuth ones rather than
   * replacing them, which is what lets one account carry both: a person who
   * signed up with Google can add a password later and afterwards use either.
   * Omit this and nothing changes — no provider is registered and
   * `{basePath}/callback/credentials` 404s, so the surface cannot be reached by
   * a host that has not opted in.
   */
  emailPassword?: CredentialsProviderConfig;
  /**
   * Comma-separated allowlist (or an array) used to answer
   * {@link ApiAuth.isAdmin} and to stamp `isSuperadmin` when no
   * {@link ApiAuthConfig.sessionAdmin} is given. Defaults to `ADMIN_EMAILS`.
   */
  adminEmails?: string | readonly string[];
  /**
   * Reject a sign-in before a session exists. **With none supplied every
   * sign-in is refused** — the gate fails closed on purpose, so a host that
   * forgets to pass one gets no sessions rather than open registration.
   */
  signInGate?: SignInGate;
  /**
   * Decide `session.user.isSuperadmin` at sign-in. Defaults to the allowlist.
   * Pass the SAME resolver the server-side gate uses, or the session claim and
   * the gate can disagree.
   */
  sessionAdmin?: SessionAdminResolver;
  /** Where an unauthenticated visitor is sent. Defaults to `/login`. */
  signInPage?: string;
  /** Session lifetime in seconds. Defaults to 30 days. */
  maxAge?: number;
}

export interface ApiAuth {
  /** The GET/POST pair an auth route exports. */
  handlers: {
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
  };
  /** Serve one `/api/auth/**` request. */
  handler: (request: Request) => Promise<Response>;
  /** The session for an incoming request, or `null`. */
  auth: (request: Request) => Promise<Session | null>;
  /** Is this email on the admin allowlist? */
  isAdmin: (email: string | null | undefined) => boolean;
  /** The built Auth.js config, for hosts that need to inspect it. */
  config: AuthConfig;
}

/** Normalise the allowlist to the comma-separated form `isAdminEmail` takes. */
function toAllowlist(
  adminEmails: string | readonly string[] | undefined,
): string | undefined {
  if (adminEmails === undefined) return undefined;
  return Array.isArray(adminEmails) ? adminEmails.join(",") : (adminEmails as string);
}

/**
 * Apply the `AUTH_*` environment defaults, matching `next-auth`'s behaviour.
 *
 * Its `NEXTAUTH_SECRET` / `NEXTAUTH_URL` fallbacks are dropped: they were v4
 * compatibility aliases and nothing in this org has ever set one.
 */
function applyEnvDefaults(config: AuthConfig, options: ApiAuthConfig): void {
  config.secret ??= options.secret ?? process.env.AUTH_SECRET;

  if (options.basePath) {
    config.basePath = options.basePath;
  } else {
    try {
      const url = options.authUrl ?? process.env.AUTH_URL;
      if (url) {
        const { pathname } = new URL(url);
        if (pathname !== "/") config.basePath ||= pathname;
      }
    } catch {
      // A malformed AUTH_URL falls through to the /api/auth default below.
    }
    config.basePath ||= "/api/auth";
  }

  coreSetEnvDefaults(process.env, config, true);
}

/**
 * Re-origin a request onto the configured auth URL.
 *
 * The body is forwarded as a stream (`duplex: "half"`, which Node requires for
 * one), and that matters: the OAuth callback and sign-out both POST a form.
 */
function reqWithEnvUrl(request: Request, authUrl: string | undefined): Request {
  if (!authUrl) return request;
  const { origin: envOrigin } = new URL(authUrl);
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
 * The provider list: whatever OAuth is configured, plus the credentials
 * provider when the host opted into e-mail + password.
 *
 * `undefined` when there is nothing to add, so `buildAuthConfig` keeps its own
 * environment default and this function stays invisible to hosts that do not
 * use passwords.
 */
function resolveProviders(options: ApiAuthConfig): Provider[] | undefined {
  if (!options.emailPassword) return options.providers;
  const oauth = options.providers ?? buildProviders();
  return [...oauth, credentialsProvider(options.emailPassword)];
}

/**
 * Build the backend auth surface. One call, one config object, nothing global.
 */
export function createApiAuth(options: ApiAuthConfig = {}): ApiAuth {
  const allowlist = toAllowlist(options.adminEmails);
  const getAdminEmails = (): string | undefined => allowlist ?? getEnv().ADMIN_EMAILS;

  const config = buildAuthConfig({
    getSignInGate: () => options.signInGate ?? null,
    getSessionAdmin: () => options.sessionAdmin ?? null,
    providers: resolveProviders(options),
    getAdminEmails,
    signInPage: options.signInPage,
    maxAge: options.maxAge,
  });

  applyEnvDefaults(config, options);

  const handler = (request: Request): Promise<Response> =>
    Auth(
      reqWithEnvUrl(request, options.authUrl ?? process.env.AUTH_URL),
      config,
    ) as Promise<Response>;

  /**
   * Deliberately routed through {@link handler} rather than decoding the cookie
   * here: the reader and the writer are then the SAME code path, so a change to
   * the session strategy, the cookie name or the callbacks cannot leave the two
   * disagreeing about what a session is.
   *
   * Only the request's cookies are forwarded. Nothing else about the incoming
   * request should decide what its session is, and passing the rest through
   * would let a caller's `Origin`/`Referer` reach Auth.js's CSRF checks from a
   * route that never meant to perform an auth action.
   */
  const auth = async (request: Request): Promise<Session | null> => {
    const { origin } = new URL(request.url);
    const basePath = config.basePath ?? "/api/auth";
    const cookie = request.headers.get("cookie");
    const sessionRequest = new Request(`${origin}${basePath}/session`, {
      headers: cookie ? { cookie } : {},
    });
    const response = await handler(sessionRequest);
    if (!response.ok) return null;
    // Auth.js answers 200 `{}` — not 401 — when there is no valid session.
    const session = (await response.json()) as Partial<Session> | null;
    return session?.user ? (session as Session) : null;
  };

  return {
    handler,
    handlers: { GET: handler, POST: handler },
    auth,
    isAdmin: (email) => isAdminEmail(email, getAdminEmails()),
    config,
  };
}
