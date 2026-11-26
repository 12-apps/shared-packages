import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Keeta's `X-App-Signature`, both directions (read 2026-11-26 at
 * https://api-docs.mykeeta.com/apis/opendelivery/signature-calculation and its
 * three sub-pages, and the `newEvent` and webhook guide pages).
 *
 * OUTBOUND — every request the software sends Keeta, the token grant
 * included, carries it (Keeta's change to Open Delivery: a token alone is not
 * enough, so an intercepted token cannot be replayed):
 *
 * - the string is the URL without its query, then `&key=value` for each
 *   query parameter sorted by key (a null value is `key=`), then `&` and the
 *   body when there is one: an empty body, a blank one or `{}` is left out,
 *   and so is its `&`;
 * - the body is compact JSON canonicalized by RFC 8785 (JCS), and the SAME
 *   string is sent;
 * - HMAC-SHA256 of the string (UTF-8), keyed by the application's
 *   `client_secret`, encoded Base64.
 *
 * INBOUND — a webhook Keeta sends (`POST /v1/newEvent`, and the
 * authorization webhook) is signed "HMAC-SHA256 of the body, with the
 * client_secret as key, in Base64".
 *
 * ESTIMATED:
 * - query values are signed DECODED (the reference implementations take them
 *   from a map, before any URL encoding); only the self-serve authorization
 *   calls send a query, and only `redirectUri` can hold a character encoding
 *   changes;
 * - the inbound signature covers the raw body bytes as received, with no URL
 *   prefix (the pages say "the body");
 * - the authorization webhook's header uses the same Base64 HMAC (its schema
 *   says only "SHA256 hash of the request body, using the client secret as the
 *   key").
 */

/**
 * RFC 8785 (JCS) for the JSON this adapter sends: object keys sorted by
 * UTF-16 code units, no whitespace, strings and numbers as ECMAScript's
 * `JSON.stringify` writes them (which is what JCS specifies). `undefined`
 * members are dropped, as `JSON.stringify` drops them.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The string Keeta signs for one request. */
export function keetaSignatureString(url: string, body: string | undefined): string {
  const parsed = new URL(url);
  const parts = [`${parsed.origin}${parsed.pathname}`];
  const keys = [...new Set(parsed.searchParams.keys())].sort();
  for (const key of keys) parts.push(`${key}=${parsed.searchParams.get(key) ?? ""}`);
  const trimmed = body?.trim() ?? "";
  if (trimmed !== "" && trimmed !== "{}") parts.push(body ?? "");
  return parts.join("&");
}

/** The `X-App-Signature` of one outbound request. */
export function keetaRequestSignature(url: string, body: string | undefined, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(keetaSignatureString(url, body), "utf8").digest("base64");
}

/**
 * Verify a webhook Keeta sent: Base64 HMAC-SHA256 of the raw body, keyed by
 * the application's client secret, which a connection stores as its webhook
 * secret. The key exists from the moment the store connects, so an unset
 * secret REFUSES: an unsigned CANCELLED for a known order id would otherwise
 * cancel it. Compared in constant time.
 */
export function verifyKeetaSignature(rawBody: string, signature: string | null, webhookSecret: string | null): boolean {
  if (!webhookSecret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("base64"), "utf8");
  const given = Buffer.from(signature.trim(), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
