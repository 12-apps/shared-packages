/**
 * The two encodings the link needs, written out so neither host's runtime is
 * assumed: React Native has no `Buffer`, and `atob` is not on every Hermes the
 * terminal may run.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const INDEX = new Map([...ALPHABET].map((char, index) => [char, index]));

/** `text` without its padding, when its length and padding are well formed; else null. */
function unpadded(text: string): string | null {
  const body = text.replace(/=+$/, "");
  const padding = text.length - body.length;
  if (body.length === 0 || body.length % 4 === 1 || padding > 2) return null;
  return padding > 0 && text.length % 4 !== 0 ? null : body;
}

/**
 * Base64 (RFC 4648 §4) or base64url (§5) as bytes; `null` for anything else.
 * A host commonly mints the link secret as base64url (`randomBytes(32)
 * .toString("base64url")`): about three secrets in four carry a `-` or a `_`,
 * so a decoder of §4 alone would refuse most links. Strict, so one secret has
 * one spelling:
 * - not empty;
 * - one alphabet: `+`/`/` and `-`/`_` never mix;
 * - padded or not, but when `=` is present the length is a multiple of 4 and
 *   there are at most two of them, only at the end;
 * - the unused low bits of the last character are zero (`QQ==`, never `QR==`).
 */
export function decodeBase64(text: string): Uint8Array | null {
  const urlSafe = /[-_]/.test(text);
  if (urlSafe && /[+/]/.test(text)) return null;
  const body = unpadded(urlSafe ? text.replace(/-/g, "+").replace(/_/g, "/") : text);
  if (body === null) return null;
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of body) {
    const index = INDEX.get(char);
    if (index === undefined) return null;
    value = ((value << 6) | index) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >>> bits) & 0xff;
    }
  }
  // The leftover bits (2 or 4) carry no byte: they must be zero.
  if ((value & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

/** UTF-8 bytes of `text` (`TextEncoder` is in Node and in Hermes). */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
