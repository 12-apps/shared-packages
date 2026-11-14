import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta's webhook proofs, as standalone functions: the connector's WhatsApp
 * adapter uses them, and so can any other WhatsApp webhook a host runs (a
 * platform notification number's receipts), without mounting the connector.
 */

/** The header Meta signs every webhook POST with. */
export const META_SIGNATURE_HEADER = "x-hub-signature-256";

const SIGNATURE = /^sha256=([0-9a-f]{64})$/i;

/**
 * Does `signatureHeader` prove `rawBody` was signed with `appSecret`?
 *
 * HMAC-SHA256 over the RAW body bytes exactly as received (a re-serialized
 * JSON body never matches; hand the bytes, not a decoded string, where the
 * framework gives them), compared in constant time. Fails CLOSED: an empty
 * secret, a missing header, a header in any other shape, or a digest of the
 * wrong length is `false` — never an exception, never `true`.
 */
export function verifyMetaSignature(rawBody: string | Uint8Array, signatureHeader: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !signatureHeader) return false;
  const match = SIGNATURE.exec(signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What the subscription handshake answers. */
export type MetaHandshake = { ok: true; challenge: string } | { ok: false };

/**
 * Meta's `GET` subscription handshake: `hub.mode=subscribe`, the
 * `hub.verify_token` configured on the app, and a `hub.challenge` to echo.
 * The token is compared in constant time; an empty configured token refuses
 * every handshake.
 */
export function verifyMetaSubscription(
  query: Readonly<Record<string, string | undefined>>,
  verifyToken: string,
): MetaHandshake {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (!verifyToken || mode !== "subscribe" || !token || !challenge) return { ok: false };
  // Digests of equal length, so the comparison leaks neither content nor length.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(token), digest(verifyToken)) ? { ok: true, challenge } : { ok: false };
}
