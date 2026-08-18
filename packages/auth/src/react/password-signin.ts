import type { EmailAuthFailure } from "../email-credentials/types";

/**
 * Signing in with an e-mail and a password from a SPA.
 *
 * ## Why this is not the same call as `signIn("google")`
 *
 * The social flow deliberately performs a top-level NAVIGATION: the browser has
 * to leave for the provider and come back. A password sign-in has nowhere to go
 * — the answer is available on the first response — and navigating anyway would
 * throw away the form the person just filled in and lose the error with it.
 *
 * So this posts to the credentials callback with `X-Auth-Return-Redirect`,
 * which is Auth.js's way of saying "answer me with the URL you WOULD have
 * redirected to, as JSON, and let me decide". The session cookie is still set by
 * that response — it is a real sign-in, not a probe — and what changes is only
 * that the page stays put and can read the outcome.
 *
 * ## The outcome is in the URL, not the status
 *
 * The response is `200 { url }` whether the credentials were right or wrong;
 * a refusal is encoded as `?error=CredentialsSignin&code=<reason>` on that URL.
 * A caller that checked `response.ok` would report every failed sign-in as a
 * success, which is exactly the bug this parsing exists to prevent.
 */

/** What a password sign-in attempt produced. */
export type PasswordSignInResult =
  | { ok: true; url: string }
  | { ok: false; reason: EmailAuthFailure | "unknown" };

/** The refusal codes the credentials provider is allowed to put on the URL. */
const KNOWN_REASONS: readonly string[] = [
  "method-disabled",
  "invalid-email",
  "weak-password",
  "email-taken",
  "invalid-credentials",
  "email-not-verified",
  "token-invalid",
  "rate-limited",
  "current-password-required",
  "current-password-invalid",
  "no-account",
];

/**
 * Read the outcome off the URL Auth.js answered with.
 *
 * Anything unrecognised collapses to `unknown` rather than being shown raw: the
 * codes are a closed vocabulary the UI has copy for, and a future one leaking
 * into a user's face as `OAuthCallbackError` helps nobody.
 */
export function parseSignInUrl(rawUrl: string): PasswordSignInResult {
  let url: URL;
  try {
    url = new URL(rawUrl, "http://localhost");
  } catch {
    return { ok: false, reason: "unknown" };
  }
  const error = url.searchParams.get("error");
  if (!error) return { ok: true, url: rawUrl };
  const code = url.searchParams.get("code");
  return {
    ok: false,
    reason: code && KNOWN_REASONS.includes(code) ? (code as EmailAuthFailure) : "unknown",
  };
}

interface PasswordSignInInput {
  basePath: string;
  providerId: string;
  csrfToken: string;
  email: string;
  password: string;
  callbackUrl: string;
}

/**
 * POST the credentials and return what Auth.js said.
 *
 * Kept apart from the React layer so the URL parsing above and the request
 * shape below can be tested without rendering anything.
 */
export async function postPasswordSignIn(
  input: PasswordSignInInput,
): Promise<PasswordSignInResult> {
  const response = await fetch(
    `${input.basePath}/callback/${encodeURIComponent(input.providerId)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Answer with JSON instead of a 302 — see the module docs.
        "X-Auth-Return-Redirect": "1",
      },
      body: new URLSearchParams({
        csrfToken: input.csrfToken,
        email: input.email,
        password: input.password,
        callbackUrl: input.callbackUrl,
        redirect: "false",
      }).toString(),
    },
  );

  if (!response.ok) return { ok: false, reason: "unknown" };
  const payload = (await response.json().catch(() => null)) as { url?: string } | null;
  if (!payload?.url) return { ok: false, reason: "unknown" };
  return parseSignInUrl(payload.url);
}
