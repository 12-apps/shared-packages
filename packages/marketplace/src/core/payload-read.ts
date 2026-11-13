import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The defensive readers every adapter's normalizer is built from.
 *
 * A marketplace payload is UNTRUSTED: a documented shape and the shape that
 * actually arrives drift, and a `TypeError` reading a missing field would
 * reject a paid order at the door. Every reader here produces a value or
 * null, never a throw. They are wire-format-neutral (no marketplace's key
 * names), which is why they live beside the engine rather than in an adapter.
 */

/** Read a nested value without asserting the shape of anything on the way. */
export function pick(source: unknown, ...path: string[]): unknown {
  let cursor: unknown = source;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** A non-blank string (trimmed), a finite number as text, or null. */
export function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * The first of several candidate paths that yields a string.
 *
 * A marketplace states the same fact under different keys depending on which
 * API version delivered it, so nearly every read is a fallback chain. Expressed
 * as data rather than as `??` so a chain grows by one entry, not one branch.
 */
export function firstString(source: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const found = asString(pick(source, ...path));
    if (found !== null) return found;
  }
  return null;
}

/**
 * Money stated in DECIMAL units (`12.9`) → integer cents.
 *
 * Rounded rather than truncated: `Math.trunc(12.9 * 100)` is 1289 on IEEE-754,
 * so truncation loses a cent on ordinary prices, always in the store's
 * disfavour.
 */
export function toCents(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

/** {@link firstString} for money. */
export function firstCents(source: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const found = toCents(pick(source, ...path));
    if (found !== null) return found;
  }
  return null;
}

/** An ISO timestamp → a Date, or null when absent or unparseable. */
export function toDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** {@link firstString} for timestamps. */
export function firstDate(source: unknown, paths: string[][]): Date | null {
  for (const path of paths) {
    const found = toDate(pick(source, ...path));
    if (found !== null) return found;
  }
  return null;
}

/**
 * Verify a lowercase-hex HMAC-SHA256 of the raw body (an optional `sha256=`
 * prefix tolerated), keyed by `secret`.
 *
 * Unsigned deliveries are refused whenever a secret is CONFIGURED; a store
 * that has not set one yet is accepted, and that state is visible on the
 * connection screen rather than silent. Compared in constant time over bytes:
 * an early-exit `===` on a hex digest leaks the prefix a forger already got
 * right, one request at a time.
 */
export function verifyHmacSha256Hex(rawBody: string, signature: string | null, secret: string | null): boolean {
  if (!secret) return true;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = Buffer.from(signature.trim().toLowerCase().replace(/^sha256=/u, ""), "utf8");
  const mine = Buffer.from(expected, "utf8");
  return given.length === mine.length && timingSafeEqual(given, mine);
}
