import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { CREDENTIALS_PROVIDER_ID } from "../credentials-provider-id";
import { postPasswordSignIn, type PasswordSignInResult } from "./password-signin";

/**
 * The browser half of `@12-apps/auth`, as one factory taking one config object.
 *
 * A SPA renders outside the framework Auth.js ships helpers for, so it drives
 * the HTTP endpoints directly. That is not much code, but it is code every app
 * was writing again — and two details in it are the kind that are only found in
 * production:
 *
 * - **Sign-in is a CSRF-protected POST, not a link.** Auth.js v5 answers a GET
 *   to `signin/:provider` with an `UnknownAction` → `302 ?error=Configuration`,
 *   which surfaces in the UI as "the provider did not respond". The token has to
 *   be fetched and a hidden form submitted, so the browser performs a top-level
 *   navigation that follows the 302 to the provider's authorize URL.
 * - **The callback URL has to be same-origin.** Browsers resolve `//host` — and
 *   its `/\\host` backslash variant — as a protocol-relative EXTERNAL URL, so a
 *   naive `startsWith("/")` check is an open redirect.
 *
 * Pairs with `createApiAuth`: same package, same base path, one config object
 * each.
 */

/** The authenticated user as the session endpoint exposes it. */
export interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  [key: string]: unknown;
}

/** The session payload. */
export interface Session {
  user?: SessionUser;
  expires?: string;
  [key: string]: unknown;
}

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface SessionContextValue {
  session: Session | null;
  status: SessionStatus;
  /** Re-fetch the session from the backend. */
  refresh: () => Promise<void>;
  /**
   * Full-page redirect into a sign-in flow for `provider`. Resolves once the
   * handoff form is submitted; **rejects if the CSRF token cannot be fetched**,
   * so a caller that set a loading state before calling can clear it and
   * surface an error rather than leaving the button stuck.
   */
  signIn: (provider?: string, callbackUrl?: string) => Promise<void>;
  /**
   * Sign in with an e-mail and a password, WITHOUT leaving the page.
   *
   * Resolves with the outcome rather than throwing on a refusal: a wrong
   * password is an ordinary answer the form has to render beside the fields,
   * not an exception. On success the session has already been refreshed, so a
   * caller only has to navigate.
   *
   * Available only when the backend was built with
   * `createApiAuth({ emailPassword })`; without it the endpoint does not exist
   * and every attempt resolves `{ ok: false, reason: "unknown" }`.
   */
  signInWithPassword: (input: {
    email: string;
    password: string;
    callbackUrl?: string;
  }) => Promise<PasswordSignInResult>;
  /** End the session, then refresh local state. */
  signOut: () => Promise<void>;
}

export interface WebAuthConfig {
  /**
   * Where the auth endpoints are mounted. Must match the `basePath` given to
   * `createApiAuth`. Defaults to `/api/auth`.
   */
  basePath?: string;
  /**
   * The credentials provider's id. Must match the one given to
   * `createApiAuth({ emailPassword: { id } })`, since it IS the callback URL.
   */
  credentialsProviderId?: string;
  /**
   * The `fetch` these calls go through. Defaults to the global one.
   *
   * The same escape hatch `createEmailAuth` has, and for the same reason: the
   * session is read on mount, so anything rendering this provider outside a
   * browser with a live backend — a test, a story, a design review — otherwise
   * has no way to answer it but to reach for the global.
   *
   * That default is resolved **per call**, not once when the surface is built.
   * A host builds its auth surface at module scope, so "once when built" means
   * at IMPORT time — ahead of any `beforeEach` stub, any polyfill, and anything
   * else that replaces `globalThis.fetch` afterwards. Reading it once froze the
   * client onto the real `fetch`, and every suite that stubs the global then
   * hung on a session request nothing was left to answer.
   */
  fetchImpl?: typeof fetch;
}

export interface WebAuth {
  /** Provides the session to a component tree. */
  SessionProvider: (props: { children: ReactNode }) => JSX.Element;
  /** Read the session; throws outside the provider. */
  useSession: () => SessionContextValue;
}

/**
 * Restrict a callback URL to same-origin targets (open-redirect defence).
 *
 * A relative path must have a single leading `/`: browsers resolve `//host` and
 * `/\\host` as protocol-relative EXTERNAL URLs, so both are rejected rather than
 * treated as paths.
 */
export function sameOriginCallbackUrl(
  raw: string | undefined,
  location: { href: string; origin: string },
): string {
  const fallback = location.href;
  if (!raw) return fallback;
  const isRelativePath =
    raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\");
  return isRelativePath ||
    raw.startsWith(`${location.origin}/`) ||
    raw === location.origin
    ? raw
    : fallback;
}

async function fetchSession(basePath: string, fetchImpl: typeof fetch): Promise<Session | null> {
  const response = await fetchImpl(`${basePath}/session`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as Session | null;
  // The endpoint answers 200 `{}` when there is no session, so the presence of
  // `user` — not the status code — is what distinguishes the two.
  return payload && payload.user ? payload : null;
}

async function fetchCsrfToken(basePath: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`${basePath}/csrf`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch CSRF token: ${response.status}`);
  }
  const payload = (await response.json()) as { csrfToken?: string };
  if (!payload.csrfToken) throw new Error("CSRF token missing from response");
  return payload.csrfToken;
}

/**
 * Submit the hidden sign-in form, which is what makes the browser follow the
 * 302 to the provider as a top-level navigation.
 */
function submitSignInForm(action: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/**
 * Start a social sign-in: fetch the token, then submit the hidden form.
 *
 * Module scope rather than inside the provider — it closes over nothing from
 * React, and lifting it is what keeps the provider readable as "state, effect,
 * value" instead of three request bodies.
 */
async function startSocialSignIn(
  basePath: string,
  fetchImpl: typeof fetch,
  provider?: string,
  callbackUrl?: string,
): Promise<void> {
  const target = sameOriginCallbackUrl(callbackUrl, window.location);
  const action = provider
    ? `${basePath}/signin/${encodeURIComponent(provider)}`
    : `${basePath}/signin`;
  // Fetch first: if this rejects, the caller still owns its loading state and
  // can surface the failure. Building the form first would leave a stray node
  // in the document on the error path.
  const csrfToken = await fetchCsrfToken(basePath, fetchImpl);
  submitSignInForm(action, { csrfToken, callbackUrl: target });
}

/** Post credentials and report the outcome. Never throws for a refusal. */
async function startPasswordSignIn(
  basePath: string,
  fetchImpl: typeof fetch,
  providerId: string,
  input: { email: string; password: string; callbackUrl?: string },
): Promise<PasswordSignInResult> {
  const target = sameOriginCallbackUrl(input.callbackUrl, window.location);
  let csrfToken: string;
  try {
    csrfToken = await fetchCsrfToken(basePath, fetchImpl);
  } catch {
    // Same failure the social flow surfaces by rejecting; here it becomes a
    // result, because the form is still on screen to show it.
    return { ok: false, reason: "unknown" };
  }
  return postPasswordSignIn({
    basePath,
    fetchImpl,
    providerId,
    csrfToken,
    email: input.email,
    password: input.password,
    callbackUrl: target,
  });
}

/**
 * End the session at the backend. The caller refreshes local state after.
 *
 * ## Why this asks for JSON, and why that is not a nicety
 *
 * Auth.js answers sign-out with a **302 to its `callbackUrl`**, which defaults
 * to the origin of the URL IT SAW — and `fetch` follows redirects by default.
 * That is fine only while the URL the handler sees is the one the browser used.
 *
 * A platform selling CUSTOM DOMAINS cannot arrange that. An OAuth client
 * registers a fixed list of redirect URIs, so the round trip has to happen on
 * the platform origin, so the host re-origins every `/api/auth/**` request onto
 * `AUTH_URL` before handing it over (see `server/session-token.ts` for the other
 * half of that story). Sign-out on `menu.tenant.example` therefore redirected to
 * the PLATFORM's homepage, the browser chased it cross-origin, and a homepage
 * that carries no `Access-Control-Allow-Origin` turned the whole call into an
 * opaque `TypeError: Failed to fetch`.
 *
 * The failure read as a network blip and was the opposite of one. The server HAD
 * cleared the cookie — the redirect is the LAST thing it does — so the person
 * was signed out at the backend while this promise rejected: the SPA stayed on
 * `authenticated`, whatever the caller meant to do after signing out never ran,
 * and every session-scoped poll still mounted went on asking until it drew a
 * 401.
 *
 * `X-Auth-Return-Redirect` is Auth.js's own answer, the same one
 * `postPasswordSignIn` takes: it returns `200 { url }` carrying the SAME
 * `Set-Cookie` headers, so the session is still cleared and there is no
 * `Location` to chase. The URL is discarded — where to go after signing out is
 * the caller's decision, and the caller is the only one who can make it
 * same-origin.
 *
 * `redirect: "manual"` is NOT the same fix: it yields an opaque response whose
 * `status` is 0 and `ok` is false, which the check below cannot tell apart from
 * a sign-out that genuinely failed.
 */
async function postSignOut(basePath: string, fetchImpl: typeof fetch): Promise<void> {
  const csrfToken = await fetchCsrfToken(basePath, fetchImpl);
  const response = await fetchImpl(`${basePath}/signout`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Answer with JSON instead of a 302 — see the block above.
      "X-Auth-Return-Redirect": "1",
    },
    // `json: "true"` used to ride along here. It is a next-auth v4 form field;
    // `@auth/core` never reads it, so it did nothing but suggest the redirect
    // was already handled.
    body: new URLSearchParams({ csrfToken }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Sign-out request failed: ${response.status}`);
  }
}

/** Build the browser auth surface. One call, one config object. */
export function createWebAuth(config: WebAuthConfig = {}): WebAuth {
  const basePath = config.basePath ?? "/api/auth";
  const credentialsProviderId = config.credentialsProviderId ?? CREDENTIALS_PROVIDER_ID;
  // Per CALL, never captured here — see `fetchImpl` on WebAuthConfig for why.
  const fetchImpl: typeof fetch = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));

  const SessionContext = createContext<SessionContextValue | null>(null);

  function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
    const [session, setSession] = useState<Session | null>(null);
    const [status, setStatus] = useState<SessionStatus>("loading");

    const refresh = useCallback(async () => {
      try {
        const next = await fetchSession(basePath, fetchImpl);
        setSession(next);
        setStatus(next ? "authenticated" : "unauthenticated");
      } catch {
        setSession(null);
        setStatus("unauthenticated");
      }
    }, []);

    useEffect(() => {
      void refresh();
    }, [refresh]);

    const signIn = useCallback(
      (provider?: string, callbackUrl?: string) =>
        startSocialSignIn(basePath, fetchImpl, provider, callbackUrl),
      [],
    );

    const signInWithPassword = useCallback(
      async (input: {
        email: string;
        password: string;
        callbackUrl?: string;
      }): Promise<PasswordSignInResult> => {
        const result = await startPasswordSignIn(
          basePath,
          fetchImpl,
          credentialsProviderId,
          input,
        );
        // The cookie is already set by that response; this is what makes the
        // tree re-render as authenticated without a reload.
        if (result.ok) await refresh();
        return result;
      },
      [refresh],
    );

    const signOut = useCallback(async () => {
      await postSignOut(basePath, fetchImpl);
      await refresh();
    }, [refresh]);

    const value = useMemo(
      () => ({ session, status, refresh, signIn, signInWithPassword, signOut }),
      [session, status, refresh, signIn, signInWithPassword, signOut],
    );

    return (
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    );
  }

  function useSession(): SessionContextValue {
    const value = useContext(SessionContext);
    if (!value) {
      throw new Error("useSession must be used within a SessionProvider");
    }
    return value;
  }

  return { SessionProvider, useSession };
}
