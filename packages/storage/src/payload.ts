import { isAcceptedContentType } from './content-types';
import type { StorageProblem } from './problems';

/**
 * Proving that some bytes really are an image of the type they claim, and
 * decoding the base64 form of them.
 *
 * A browser POSTs its bytes as a request stream; an agent cannot make an
 * arbitrary HTTP request at all — it calls tools, with JSON arguments — so its
 * bytes travel base64 inside the write that uses them. That second form needs
 * three checks the stream gets from its transport for free:
 *
 *   - the SIZE cap has to hold against the ENCODED length, before decoding, or a
 *     30 MB string is allocated twice over just to be rejected;
 *   - the encoding may be malformed, and `Buffer.from(…, 'base64')` silently
 *     discards what it does not recognise — so a typo'd payload would otherwise
 *     be stored as a truncated, unopenable image;
 *   - the declared `contentType` is the only thing naming the format, and it
 *     decides both the stored extension AND the type the object is served back
 *     with.
 *
 * That last check is what keeps an upload surface from being a way to park
 * arbitrary content at a world-readable URL on the store's own domain: bytes
 * that are not one of the accepted formats are refused whatever they claim to
 * be. It runs on BOTH entrances — the decode does it as part of decoding, and
 * the streaming path does it on the bytes it read — because neither may be the
 * one that forgets.
 */

/** `data:image/png;base64,` — an agent is as likely to send this as bare base64. */
const DATA_URL_PREFIX = /^data:[\w.+-]+\/[\w.+-]+(;[\w.+-]+=[\w.+-]+)*;base64,/i;

/** Standard base64 alphabet with at most the two padding characters. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * The MIME type the BYTES themselves declare, by magic number — `undefined` for
 * anything that is not one of the accepted formats.
 */
export function sniffImageContentType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // "GIF8", covering both 87a and 89a.
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // "RIFF" …4-byte length… "WEBP".
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * Do `bytes` really carry an image of `contentType`? `null` when they agree.
 *
 * In one place because both entrances need it, and one of them has nothing else
 * corroborating the claim: there is no file dialog upstream of a tool call.
 */
export function verifyImageBytes(
  bytes: Uint8Array,
  contentType: string,
): StorageProblem | null {
  if (bytes.byteLength === 0) return 'empty_file';
  if (!isAcceptedContentType(contentType)) return 'unsupported_content_type';
  return sniffImageContentType(bytes) === contentType ? null : 'content_mismatch';
}

export type DecodedPayload =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; problem: StorageProblem };

/**
 * Bytes a padded base64 string decodes to, EXACTLY — every 4 characters carry 3
 * bytes, less the 1 or 2 the padding stands in for.
 *
 * The approximation without that correction over-counts by up to two bytes,
 * which is invisible everywhere except at the cap, where it refuses a file of
 * exactly the documented maximum.
 */
function decodedLength(encoded: string): number {
  let padding = 0;
  if (encoded.endsWith('=')) padding = encoded.endsWith('==') ? 2 : 1;
  return (encoded.length / 4) * 3 - padding;
}

/**
 * Strip the data-URL wrapper and any whitespace, then restore padding a caller
 * dropped (unpadded base64 is common and unambiguous).
 *
 * A length one more than a multiple of 4 pads to three `=`, which the alphabet
 * check then rejects — correctly, since no base64 string has that length.
 */
function normalize(input: string): string {
  const encoded = input.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '');
  const remainder = encoded.length % 4;
  return remainder === 0 ? encoded : encoded.padEnd(encoded.length + (4 - remainder), '=');
}

/**
 * Decode `input` and prove it really is an image of `contentType`.
 *
 * `maxBytes` is judged on the ENCODED length first, so an oversize payload is
 * never decoded at all.
 */
export function decodeImagePayload(
  input: string,
  contentType: string,
  maxBytes: number,
): DecodedPayload {
  const encoded = normalize(input);
  if (encoded.length === 0) return { ok: false, problem: 'empty_file' };
  if (!BASE64.test(encoded)) return { ok: false, problem: 'invalid_base64' };
  if (decodedLength(encoded) > maxBytes) return { ok: false, problem: 'file_too_large' };

  // Copied out of Node's Buffer pool so the stored bytes are a standalone
  // Uint8Array rather than a view into a shared allocation.
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (bytes.byteLength === 0) return { ok: false, problem: 'empty_file' };
  const mismatch = verifyImageBytes(bytes, contentType);
  return mismatch ? { ok: false, problem: mismatch } : { ok: true, bytes };
}
