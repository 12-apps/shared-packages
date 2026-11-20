import { createHash, createHmac } from "node:crypto";

/** SHA-256 hex digest — the at-rest form of an opaque refresh token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The at-rest form of a refresh token issued by one authorization server.
 *
 * With no namespace it is {@link hashToken}, byte for byte. A surface with an
 * `issuerPath` keys an HMAC-SHA-256 with its issuer path, so the rows of two
 * surfaces sharing one table never answer for each other: a token minted by
 * one is an unknown token at the other's token endpoint (`invalid_grant`), and
 * cannot be traded there for a token the person never consented to.
 *
 * The token itself is 32 random bytes, so a fast digest is the right at-rest
 * form (no password is involved); the key is a domain separator, not a secret.
 */
export function hashTokenIn(namespace: string | undefined, token: string): string {
  if (!namespace) return hashToken(token);
  return createHmac("sha256", namespace).update(token).digest("hex");
}
