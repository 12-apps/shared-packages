/**
 * PKCE (RFC 7636) S256 challenge helpers for the OAuth authorization server
 * (12-23, ported verbatim from future-pay's `lib/mcp/oauth/pkce.ts`).
 *
 * OAuth 2.1 mandates the `S256` code-challenge method and forbids `plain`, so
 * this module computes `BASE64URL(SHA-256(code_verifier))` and compares it to
 * the stored `code_challenge` in constant time. The authorization endpoint
 * binds a `code_challenge` into the stateless authorization code; the token
 * endpoint calls {@link verifyChallenge} with the presented `code_verifier` to
 * prove the redeeming client is the one that started the flow.
 *
 * `plain` is refused (throws {@link UnsupportedChallengeMethodError}) rather
 * than silently accepted: `plain` offers no protection against an intercepted
 * authorization code, which is the exact threat PKCE exists to close.
 */

/** The only PKCE method this server accepts (OAuth 2.1 requires S256). */
export const SUPPORTED_CHALLENGE_METHOD = "S256";

/**
 * PKCE code-challenge methods, including the rejected legacy `plain`.
 *
 * @public exported because it is a parameter type of the exported
 * {@link verifyChallenge}.
 */
export type CodeChallengeMethod = "S256" | "plain";

/** Thrown when a caller supplies a challenge method other than `S256`. */
export class UnsupportedChallengeMethodError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(
      `unsupported code_challenge_method '${method}' — only ${SUPPORTED_CHALLENGE_METHOD} is allowed`,
    );
    this.name = "UnsupportedChallengeMethodError";
    this.method = method;
  }
}

/** Encode raw bytes as unpadded base64url (RFC 7636 challenge encoding). */
function base64UrlEncode(bytes: Uint8Array): string {
  // Buffer.toString("base64url") emits the URL-safe alphabet with no padding.
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Compute the RFC 7636 S256 challenge for a `code_verifier`:
 * `BASE64URL(SHA-256(ASCII(verifier)))`.
 */
export async function computeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Constant-time string comparison over the base64url challenge bytes.
 *
 * Returns `false` immediately on a length mismatch (lengths are not secret);
 * for equal-length inputs every byte is compared so the timing does not reveal
 * how many leading characters matched.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify a presented `code_verifier` against a stored `code_challenge`.
 *
 * Recomputes the S256 challenge from `verifier` and constant-time-compares it
 * to `storedChallenge`. Returns `true` on a match, `false` on a mismatch (or an
 * empty stored challenge). Any method other than `S256` throws
 * {@link UnsupportedChallengeMethodError} — `plain` is never accepted.
 */
export async function verifyChallenge(
  verifier: string,
  storedChallenge: string,
  method: CodeChallengeMethod | string = SUPPORTED_CHALLENGE_METHOD,
): Promise<boolean> {
  if (method !== SUPPORTED_CHALLENGE_METHOD) {
    throw new UnsupportedChallengeMethodError(method);
  }
  if (!storedChallenge) return false;

  const computed = await computeChallenge(verifier);
  return constantTimeEquals(computed, storedChallenge);
}
