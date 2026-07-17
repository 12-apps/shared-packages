import Google from "next-auth/providers/google";
import Facebook from "next-auth/providers/facebook";
import Apple from "next-auth/providers/apple";
import type { NextAuthConfig, Session, DefaultSession } from "next-auth";
import { z } from "zod";
import { isAdminEmail } from "./admin";

/**
 * NextAuth configuration, split out from the `NextAuth()` instance (index.ts) so
 * it can be imported without pulling the full server runtime — useful for tests
 * and edge contexts.
 */

/**
 * Augment NextAuth's `Session` with the fields our callbacks attach, so
 * `session.user.id` / `.provider` / `.isSuperadmin` are typed across the app.
 * `isSuperadmin` (the global app owner, resolved from the `ADMIN_EMAILS`
 * allowlist) is always populated by the session callback below. Per-tenant
 * OWNER/ADMIN rights are NOT on the session — a user can administer one tenant
 * and not another, so those are resolved per request from `Membership`.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      provider?: string;
      isSuperadmin: boolean;
    } & DefaultSession["user"];
  }
}

/**
 * Schema for validating auth environment variables
 * AUTH_SECRET is required, OAuth providers are optional (at least one should be configured)
 */
const envSchema = z.object({
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required for session encryption"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  // Comma-separated admin allowlist (FUT-9). Optional: an unset/empty value
  // simply means no email is treated as admin (deny-by-default).
  ADMIN_EMAILS: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

// Lazy-evaluated environment config (only validated when accessed)
let _envCache: EnvConfig | null = null;

/**
 * Check if we're in a build-time context where env vars may not be available
 * This includes CI builds, static generation, etc.
 */
function isBuildTime(): boolean {
  // Explicit skip flag
  if (process.env.SKIP_ENV_VALIDATION === "true") return true;
  // Next.js build phase indicator
  if (process.env.NEXT_PHASE === "phase-production-build") return true;
  // AUTH_SECRET not available (likely build time)
  if (!process.env.AUTH_SECRET) return true;
  return false;
}

/**
 * Get validated environment variables (lazy evaluation)
 * Only validates when first accessed, avoiding build-time failures
 */
function getEnv(): EnvConfig {
  if (_envCache) return _envCache;

  // Skip validation during build time when env vars may not be available
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

  _envCache = result.data;
  return _envCache;
}

/**
 * Extended session type that includes user ID and superadmin authorization.
 *
 * `isSuperadmin` is derived from the `ADMIN_EMAILS` allowlist in the session
 * callback so the client (e.g. the account badge) can react to it. Server-side
 * gates re-derive it from the email (see `isAdminEmail`) rather than trusting
 * this claim alone. Per-tenant admin rights are modelled as `Membership` rows,
 * resolved per request — never as a single session flag.
 */
export interface ExtendedSession extends Session {
  user: Session["user"] & {
    id: string;
    provider?: string;
    isSuperadmin: boolean;
  };
}

/**
 * Build OAuth providers based on available environment variables
 * Only includes providers that have both client ID and secret configured
 */
function buildProviders() {
  const env = getEnv();
  const providers = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    // E2E ONLY: repoint the Google provider at a local mock OpenID provider so
    // the "Continue with Google" round-trip (authorize → code → token → id_token)
    // runs deterministically offline, exercising the REAL provider + sign-in gate
    // without contacting Google. Gated on `OAUTH_MOCK_ISSUER`, which is never set
    // in dev or production — there the real Google discovery document is used.
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
      })
    );
  }

  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) {
    providers.push(
      Facebook({
        clientId: env.FACEBOOK_CLIENT_ID,
        clientSecret: env.FACEBOOK_CLIENT_SECRET,
      })
    );
  }

  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    providers.push(
      Apple({
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET,
      })
    );
  }

  return providers;
}

/**
 * Sign-in gate (injected by the app). Lets the app reject an OAuth sign-in —
 * e.g. an account that hasn't signed up / accepted the terms — BEFORE a session
 * is created. Returning `false` aborts the sign-in.
 */
export type SignInGate = (params: {
  email: string;
  name?: string | null;
  image?: string | null;
  provider?: string | null;
}) => boolean | Promise<boolean>;

let signInGate: SignInGate | null = null;

/** Install the sign-in gate (call once at startup, e.g. from the auth route). */
export function setSignInGate(gate: SignInGate | null): void {
  signInGate = gate;
}

/**
 * Resolves whether an email is a superadmin, used to stamp `isSuperadmin` into
 * the JWT at sign-in. Injected by the app (with the SAME resolver the
 * server-side gate uses) so the session's `isSuperadmin` claim can't diverge
 * from the gate — e.g. when superadmin status comes from a database rather than
 * the env allowlist.
 *
 * It is applied in the `jwt` callback (Node runtime, at sign-in) and NOT the
 * `session` callback, because the resolver may hit a database (PGlite/Prisma)
 * that cannot run in the edge middleware where the session callback also executes.
 */
export type SessionAdminResolver = (
  email: string | null | undefined,
) => boolean | Promise<boolean>;

let sessionAdminResolver: SessionAdminResolver | null = null;

/** Install the session admin resolver (call once at startup, e.g. the auth route). */
export function setSessionAdminResolver(
  resolver: SessionAdminResolver | null,
): void {
  sessionAdminResolver = resolver;
}

/**
 * Redact secret-like values before anything reaches stdout/log files.
 *
 * Auth.js debug logging otherwise dumps the full provider config — INCLUDING
 * `clientSecret` — plus the OAuth result (access/id/refresh tokens) on every
 * sign-in. We mask both by key name and by known credential shapes so that even
 * with debug explicitly enabled, a secret can never be written to a log.
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

/**
 * Auth configuration for NextAuth.js v5
 * Supports Google, Facebook, and Apple OAuth providers (configured dynamically)
 */
export const authConfig: NextAuthConfig = {
  providers: buildProviders(),
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Fail closed: with no gate installed, reject. The app installs the gate
      // from the auth route to enforce "must have signed up + accepted terms".
      if (!signInGate) return false;
      const email = user?.email;
      if (!email) return false;
      return signInGate({
        email,
        name: user?.name ?? null,
        image: user?.image ?? null,
        provider: account?.provider ?? null,
      });
    },
    async jwt({ token, user, account }) {
      // Initial sign in - safely handle potentially undefined user.id
      if (account && user) {
        // Stamp SUPERADMIN status ONCE, here in the Node runtime, using the
        // injected resolver (so it matches the server gate) or the env allowlist
        // as a fail-safe default. The session callback — which also runs in the
        // edge middleware — then only reads token.isSuperadmin, never the db.
        const isSuperadmin = sessionAdminResolver
          ? await sessionAdminResolver(user.email)
          : isAdminEmail(user.email, getEnv().ADMIN_EMAILS);
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
      // Add user ID, provider, and superadmin status to session
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string) ?? "";
        session.user.provider = token.provider as string | undefined;
        // Read the superadmin flag stamped into the token at sign-in (kept in
        // sync with the server gate). Edge-safe: no db/resolver call here.
        session.user.isSuperadmin = Boolean(token.isSuperadmin);
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Redirect to home after sign in
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return baseUrl;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  // Trust host when AUTH_TRUST_HOST is set (needed for reverse proxy) or in development
  trustHost: process.env.AUTH_TRUST_HOST === "true" || process.env.NODE_ENV === "development",
  // Debug is OFF by default — even in development — because Auth.js debug output
  // dumps the provider config (clientSecret) and OAuth tokens. Opt in explicitly
  // with AUTH_DEBUG=true; the redacting logger below masks secrets even then.
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
