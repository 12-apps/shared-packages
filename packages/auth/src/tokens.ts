import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Single-use, expiring, hashed-at-rest credentials — the thing an e-mail
 * verification link and a password-reset link both are.
 *
 * ## The one rule
 *
 * **The raw token goes in the e-mail and nowhere else. The database gets its
 * SHA-256.** A reset token is a bearer credential for an account: whoever holds
 * it can take the account over. Stored raw, a leaked database dump — or a
 * support engineer with a read replica, or a log line that captured a row — is
 * an account-takeover kit for every user with a pending reset. Stored hashed,
 * the dump is inert, because {@link hashToken} is one-way and the raw value
 * exists only in the recipient's inbox.
 *
 * SHA-256 rather than scrypt here, deliberately: a reset token is 32 bytes of
 * CSPRNG output, so there is no guessable-input problem for a slow KDF to
 * defend against, and lookup happens on every click of every link.
 *
 * ## Why single-use and short-lived are separate ideas
 *
 * {@link isTokenExpired} bounds how long a leaked link stays dangerous.
 * Consumption bounds how many times it works. Both matter: a mail archive that
 * is read a month later is the first, a shared inbox where two people click the
 * same link is the second. A host enforces consumption by stamping the row it
 * looked the hash up in; this module gives it the shape to stamp.
 */

/** Entropy per token, in bytes. 32 bytes = 256 bits, unguessable by any margin. */
const TOKEN_BYTES = 32;

/** How long a freshly issued token stays valid, unless the caller says otherwise. */
export const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

/** A newly minted token, in its two halves. */
export interface IssuedToken {
  /**
   * The raw value. Put it in the link, then forget it — this is the ONLY moment
   * it exists outside the recipient's mailbox.
   */
  token: string;
  /** The SHA-256 of {@link token}. This is what gets persisted and looked up. */
  tokenHash: string;
  /** When it stops being valid. */
  expiresAt: Date;
}

export interface IssueTokenOptions {
  /** Lifetime in milliseconds. Defaults to {@link DEFAULT_TOKEN_TTL_MS}. */
  ttlMs?: number;
  /** "Now", for tests and for a host with its own clock. Defaults to `Date.now()`. */
  now?: Date;
}

/**
 * The lookup key for a raw token: its SHA-256, lower-case hex.
 *
 * Also the ONLY way a host should search for a token row — never by the raw
 * value, which is not there.
 *
 * ## Why SHA-256 and not a slow KDF, in full
 *
 * CodeQL flags this as `js/insufficient-password-hash`, reaching it through
 * `resetPassword({ token, password })` — one object carrying both, which makes
 * the token look like a password to the analysis. It is not one, and the
 * distinction is the whole reason this function exists:
 *
 * - **What is hashed here is never chosen by a person.** {@link issueToken}
 *   mints 32 bytes of CSPRNG output. There is no guessable input for a slow KDF
 *   to defend against — the search space is 2^256 whatever the cost factor.
 * - **The stored hashes are only ever of OUR tokens.** A caller can POST any
 *   string to the verify or reset endpoint, but a guess simply misses the
 *   lookup; nothing about the response narrows the space, so there is no
 *   offline-guessing surface for a work factor to slow down.
 * - **It runs on every click of every link.** Making it memory-hard would put
 *   ~100ms and ~16MB on a path whose security does not improve by a bit.
 *
 * Passwords in this package are hashed by `password.ts`, with scrypt, and that
 * is where the work factor belongs.
 */
// codeql[js/insufficient-password-hash]
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mint a token. See {@link IssuedToken} for which half goes where. */
export function issueToken(options: IssueTokenOptions = {}): IssuedToken {
  const { ttlMs = DEFAULT_TOKEN_TTL_MS, now = new Date() } = options;
  // base64url: safe in a URL with no percent-encoding, so the link that reaches
  // the user is the link we minted even after a mail client rewrites it.
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

/**
 * Compare two token hashes without leaking, in timing, how far they matched.
 *
 * Both are already public-length hex, so this is belt-and-braces — but a host
 * that fetches a row and compares hashes itself gets the safe primitive here
 * rather than reaching for `===`.
 */
export function tokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Has this token passed its expiry? A missing expiry reads as expired. */
export function isTokenExpired(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return true;
  return expiry.getTime() <= now.getTime();
}

/**
 * Build the link a recipient clicks.
 *
 * The token travels as a query parameter because that is what a mail client can
 * render as one clickable string; the host's page reads it and POSTs it back,
 * so it never has to survive a form round-trip.
 *
 * `baseUrl` is resolved against nothing — it must already be absolute, since a
 * relative link in an e-mail resolves against the mail client and reaches
 * nobody.
 */
export function buildTokenLink(baseUrl: string, path: string, token: string): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
