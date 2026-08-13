import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_UPLOAD_BYTES, maxBase64Length, megabytes } from '../limits';
import { decodeImagePayload, sniffImageContentType, verifyImageBytes } from '../payload';

/**
 * The bytes-really-are-an-image check, and the base64 form of an upload.
 *
 * Without the magic-number check either entrance is a way to park arbitrary content
 * at a world-readable URL on the store's own domain, served as whatever the caller
 * claimed. It is the one assertion here that is a security property rather than a
 * convenience.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const MAX = DEFAULT_MAX_UPLOAD_BYTES;

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('sniffImageContentType', () => {
  it('names each accepted format from its signature', () => {
    expect(sniffImageContentType(PNG)).toBe('image/png');
    expect(sniffImageContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageContentType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe(
      'image/gif',
    );
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImageContentType(webp)).toBe('image/webp');
  });

  it('does not recognise a payload that is merely text', () => {
    expect(sniffImageContentType(new TextEncoder().encode('<svg/>'))).toBeUndefined();
  });

  it('does not mistake a truncated signature for the real thing', () => {
    expect(sniffImageContentType(new Uint8Array([0x89, 0x50]))).toBeUndefined();
    // "RIFF" without "WEBP" at offset 8 is a WAV, among other things.
    expect(sniffImageContentType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]))).toBeUndefined();
  });
});

describe('verifyImageBytes', () => {
  it('agrees when the bytes match the claim', () => {
    expect(verifyImageBytes(PNG, 'image/png')).toBeNull();
  });

  it('refuses bytes that are not the declared format', () => {
    expect(verifyImageBytes(PNG, 'image/jpeg')).toBe('content_mismatch');
  });

  it('refuses a content type outside the allowlist before looking at bytes', () => {
    expect(verifyImageBytes(PNG, 'image/svg+xml')).toBe('unsupported_content_type');
  });

  it('refuses zero bytes as an empty file, not as a mismatch', () => {
    expect(verifyImageBytes(new Uint8Array(0), 'image/png')).toBe('empty_file');
  });
});

describe('decodeImagePayload', () => {
  it('decodes a well-formed payload back to the exact bytes', () => {
    const decoded = decodeImagePayload(base64(PNG), 'image/png', MAX);
    expect(decoded).toEqual({ ok: true, bytes: PNG });
  });

  it('accepts a data: URL prefix, which is how an agent is as likely to send bytes', () => {
    const decoded = decodeImagePayload(`data:image/png;base64,${base64(PNG)}`, 'image/png', MAX);
    expect(decoded.ok).toBe(true);
  });

  it('accepts an unpadded payload, which is common and unambiguous', () => {
    const decoded = decodeImagePayload(base64(PNG).replace(/=+$/, ''), 'image/png', MAX);
    expect(decoded.ok).toBe(true);
  });

  it('refuses a payload that is not valid base64', () => {
    // `Buffer.from(…, 'base64')` silently discards what it cannot read, so without
    // this a typo'd payload is stored as a truncated, unopenable image.
    expect(decodeImagePayload('not base64!!', 'image/png', MAX)).toEqual({
      ok: false,
      problem: 'invalid_base64',
    });
  });

  it('refuses an oversize payload on its ENCODED length, before decoding', () => {
    const encoded = 'A'.repeat(Math.ceil((MAX + 1024) / 3) * 4);
    expect(decodeImagePayload(encoded, 'image/png', MAX)).toEqual({
      ok: false,
      problem: 'file_too_large',
    });
  });

  it('accepts a payload of exactly the documented maximum', () => {
    // The padding correction is what makes this pass: the naive length estimate
    // over-counts by up to two bytes, which is invisible everywhere except here.
    const bytes = new Uint8Array(MAX);
    bytes.set(PNG);
    expect(decodeImagePayload(base64(bytes), 'image/png', MAX).ok).toBe(true);
  });

  it('refuses bytes whose magic number contradicts the declared type', () => {
    expect(decodeImagePayload(base64(PNG), 'image/webp', MAX)).toEqual({
      ok: false,
      problem: 'content_mismatch',
    });
  });

  it('refuses an empty payload', () => {
    expect(decodeImagePayload('', 'image/png', MAX)).toEqual({
      ok: false,
      problem: 'empty_file',
    });
  });
});

describe('maxBase64Length', () => {
  it('advertises a schema ceiling that cannot refuse a legal payload', () => {
    // A tool schema uses this as its `max`. If it were tighter than the encoded
    // form of a legal file, validation would refuse an upload the endpoint accepts.
    const bytes = new Uint8Array(MAX);
    bytes.set(PNG);
    expect(base64(bytes).length).toBeLessThanOrEqual(maxBase64Length(MAX));
  });
});

describe('megabytes', () => {
  it('reads as pt-BR, because a store owner reads it', () => {
    expect(megabytes(MAX)).toBe('8 MB');
    expect(megabytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});
