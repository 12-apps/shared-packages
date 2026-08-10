import type { AuthConfig } from "@auth/core";
import Google from "@auth/core/providers/google";
import Facebook from "@auth/core/providers/facebook";
import Apple from "@auth/core/providers/apple";
import type { Provider } from "@auth/core/providers";
import type { DefaultSession, Session } from "@auth/core/types";
import { z } from "zod";

import { isAdminEmail } from "./admin";

/**
 * The Auth.js config, as a pure builder.
 *
 * Extracted from `config.ts` so there is exactly ONE implementation of the
 * callbacks, shared by two callers that need different lifetimes:
 *
 * - {@link createApiAuth} builds a config per instance, from an explicit config
 *   object. Nothing is global, so two instances cannot interfere and a test
 *   needs no reset hook.
 * - `config.ts` keeps the legacy module-level `authConfig` + `setSignInGate` /
 *   `setSessionAdminResolver` pair, for hosts pinned to a version that predates
 *   the factory.
 *
 * The gate and the admin resolver arrive as **getters**, not values. The legacy
 * path installs them after this module has been evaluated (the auth route calls
 * the setters at import time), so reading them once at build time would capture
 * `null` and fail every sign-in closed.
 */

/**
 * Augment Auth.js's `Session` with the fields the callbacks below attach, so
 * `session.user.id` / `.provider` / `.isSuperadmin` are typed across a consumer.
 *
 * `isSuperadmin` (the global app owner, resolved from the admin allowlist) is
 * always populated by the session callback. Per-tenant OWNER/ADMIN rights are
 * NOT on the session — a user can administer one tenant and not another, so
 * those are resolved per request by the host.
 */
declare module "@auth/core/types" {
  interface Session {
    user: {
      id: string;
      provider?: string;
      isSuperadmin: boolean;
    } & DefaultSession["user"];
  }
}

/**
 * Extended session type that includes user ID and superadmin authorization.
 *
 * `isSuperadmin` is derived from the admin allowlist in the session callback so
 * the client (e.g. an account badge) can react to it. Server-side gates
 * re-derive it from the email rather than trusting this claim alone.
 */
export interface ExtendedSession extends Session {
  user: Session["user"] & {
    id: string;
    provider?: string;
    isSuperadmin: boolean;
  };
}

/**
 * Sign-in gate. Lets the host reject an OAuth sign-in — e.g. an account that
 * has not signed up or accepted the terms — BEFORE a session is created.
 * Returning `false` aborts the sign-in.
 */
export type SignInGate = (params: {
  email: string;
  name?: string | null;
  image?: string | null;
  provider?: string | null;
}) => boolean | Promise<boolean>;

/**
 * Resolves whether an email is a superadmin, used to stamp `isSuperadmin` into
 * the JWT at sign-in. The host injects the SAME resolver its server-side gate
 * uses, so the session claim cannot diverge from the gate — e.g. when superadmin
 * status comes from a database rather than the allowlist.
 *
 * Applied in the `jwt` callback (Node runtime, at sign-in) and NOT the `session`
 * callback, because the resolver may hit a database that cannot run everywhere
 * the session callback does.
 */
export type SessionAdminResolver = (
  email: string | null | undefined,
) => boolean | Promise<boolean>;

/** Environment variables the default provider set is built from. */
const envSchema = z.object({
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required for session encryption"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  // Comma-separated admin allowlist. Optional: an unset/empty value means no
  // email is treated as admin (deny by default).
  ADMIN_EMAILS: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

let envCache: EnvConfig | null = null;

/**
 * Are we in a build-time context where the env may legitimately be absent?
 * CI builds and static generation both hit this.
 */
function isBuildTime(): boolean {
  if (process.env.SKIP_ENV_VALIDATION === "true") return true;
  if (!process.env.AUTH_SECRET) return true;
  return false;
}

/** Validated environment, resolved lazily so a build never fails on it. */
export function getEnv(): EnvConfig {
  if (envCache) return envCache;

  if (isBuildTime()) {
    return {
      AUTH_SECRET: process.env.AUTH_SECRET ?? "",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      FACEBOOK_CLIENT_ID: process.env.FACEBOOK_CLIENT_ID,
      FACEBOOK_CLIENT_SECRET: process.env.FACEBOOK_CLIENT_SECRET,
      APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
      APPLE_CLIENT_SECRET: process.env.APPLE_CLIENT_SECRET,
      ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    };
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables: ${missing}`);
  }

  envCache = result.data;
  return envCache;
}

/**
 * The OAuth providers each credential pair in the environment configures.
 * A provider missing either half is simply not offered.
 */
function buildProviders(): Provider[] {
  const env = getEnv();
  const providers: Provider[] = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    // E2E ONLY: repoint the Google provider at a local mock OpenID provider so
    // the "Continue with Google" round trip (authorize → code → token →
    // id_token) runs deterministically offline, exercising the REAL provider and
    // sign-in gate without contacting Google. Gated on `OAUTH_MOCK_ISSUER`,
    // which is never set in dev or production — there the real Google discovery
    // document is used.
    const mockIssuer = process.env.OAUTH_MOCK_ISSUER;
    const mockOverride = mockIssuer
      ? {
          issuer: mockIssuer,
          wellKnown: `${mockIssuer}/.well-known/openid-configuration`,
        }
      : {};
    providers.push(
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        authorization: {
          params: {
            prompt: "consent",
            access_type: "offline",
            response_type: "code",
          },
        },
        ...mockOverride,
      }),
    );
  }

  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) {
    providers.push(
      Facebook({
        clientId: env.FACEBOOK_CLIENT_ID,
        clientSecret: env.FACEBOOK_CLIENT_SECRET,
      }),
    );
  }

  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    providers.push(
      Apple({
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET,
      }),
    );
  }

  return providers;
}

/**
 * Redact secret-like values before anything reaches stdout or a log file.
 *
 * Auth.js debug logging otherwise dumps the full provider config — INCLUDING
 * `clientSecret` — plus the OAuth result (access/id/refresh tokens) on every
 * sign-in. Masked by key name AND by known credential shapes, so that even with
 * debug explicitly enabled a secret cannot be written to a log.
 */
const SECRET_KEY_RE =
  /secret|password|client_secret|access_token|refresh_token|id_token/i;

function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return value
      .replace(/GOCSPX-[\w-]+/g, "GOCSPX-***redacted***")
      .replace(/github_pat_\w+/g, "github_pat_***redacted***")
      .replace(/ya29\.[\w.-]+/g, "ya29.***redacted***")
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "***redacted-jwt***");
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_RE.test(key) ? "***redacted***" : redactSecrets(val, seen);
  }
  return out;
}

/** What {@link buildAuthConfig} needs. Every field has an environment default. */
interface BuildAuthConfigOptions {
  /**
   * The sign-in gate, read at CALL time. A getter rather than a value because
   * the legacy path installs it after this module is evaluated.
   */
  getSignInGate: () => SignInGate | null;
  /** The superadmin resolver, read at call time for the same reason. */
  getSessionAdmin: () => SessionAdminResolver | null;
  /** OAuth providers. Defaults to whatever the environment configures. */
  providers?: Provider[];
  /** Comma-separated allowlist used when no admin resolver is installed. */
  getAdminEmails?: () => string | undefined;
  /** Where an unauthenticated visitor is sent. */
  signInPage?: string;
  /** Session lifetime in seconds. */
  maxAge?: number;
}

/**
 * The four Auth.js callbacks, split out so {@link buildAuthConfig} stays within
 * the repo's function-length gate — and because these are the only part of the
 * config with behaviour worth reading on its own.
 */
function buildCallbacks(options: BuildAuthConfigOptions): AuthConfig["callbacks"] {
  const {
    getSignInGate,
    getSessionAdmin,
    getAdminEmails = () => getEnv().ADMIN_EMAILS,
  } = options;

  return {
    async signIn({ user, account }) {
      // Fail closed: with no gate installed, reject. The host installs the gate
      // to enforce "must have signed up and accepted terms".
      const gate = getSignInGate();
      if (!gate) return false;
      const email = user?.email;
      if (!email) return false;
      return gate({
        email,
        name: user?.name ?? null,
        image: user?.image ?? null,
        provider: account?.provider ?? null,
      });
    },
    async jwt({ token, user, account }) {
      // Initial sign-in. Stamp SUPERADMIN status ONCE, here in the Node runtime,
      // using the injected resolver (so it matches the server gate) or the
      // allowlist as a fail-safe default. The session callback — which may run
      // somewhere without a database — then only reads the token.
      if (account && user) {
        const resolver = getSessionAdmin();
        const isSuperadmin = resolver
          ? await resolver(user.email)
          : isAdminEmail(user.email, getAdminEmails());
        return {
          ...token,
          id: user.id ?? token.sub ?? "",
          provider: account.provider,
          isSuperadmin,
        };
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string) ?? "";
        session.user.provider = token.provider as string | undefined;
        // Read the flag stamped at sign-in. No database call here.
        session.user.isSuperadmin = Boolean(token.isSuperadmin);
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return baseUrl;
    },
  };
}

/**
 * Build an Auth.js config.
 *
 * Session strategy is **JWT with no database adapter**, which is the single
 * most important fact about this package: it owns no tables, so there is no
 * Prisma partial to adopt and no `User`/`Account`/`Session` rows to migrate.
 * A host's own user record is its own, created by whatever its sign-in gate
 * does — this package only decides whether the sign-in is allowed and what
 * ends up in the token.
 */
export function buildAuthConfig(options: BuildAuthConfigOptions): AuthConfig {
  const {
    providers,
    signInPage = "/login",
    maxAge = 30 * 24 * 60 * 60,
  } = options;

  return {
    providers: providers ?? buildProviders(),
    pages: {
      signIn: signInPage,
      error: signInPage,
    },
    callbacks: buildCallbacks(options),
    session: {
      strategy: "jwt",
      maxAge,
    },
    // Trust the host header behind a reverse proxy, or in development.
    trustHost:
      process.env.AUTH_TRUST_HOST === "true" || process.env.NODE_ENV === "development",
    // Debug is OFF by default — even in development — because Auth.js debug
    // output dumps the provider config (clientSecret) and OAuth tokens. Opt in
    // with AUTH_DEBUG=true; the redacting logger masks secrets even then.
    debug: process.env.AUTH_DEBUG === "true",
    logger: {
      error(error: Error) {
        const cause = (error as { cause?: unknown }).cause;
        console.error("[auth][error]", redactSecrets(error?.message ?? String(error)));
        if (cause) {
          console.error(
            "[auth][cause]",
            redactSecrets(cause instanceof Error ? cause.message : cause),
          );
        }
      },
      warn(code: string) {
        console.warn("[auth][warn]", code);
      },
      debug(message: string, metadata?: unknown) {
        console.debug("[auth][debug]", message, redactSecrets(metadata));
      },
    },
  };
}
