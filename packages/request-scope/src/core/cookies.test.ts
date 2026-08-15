import { describe, expect, it } from 'vitest';

import { createCookieCodec } from './cookies';

describe('createCookieCodec (encoding, the default)', () => {
  it('reports that it encodes', () => {
    expect(createCookieCodec().encodes).toBe(true);
  });

  it('round-trips a value containing every delimiter that would truncate it', () => {
    // A raw `;` ends the cookie; a raw `,` and whitespace are forbidden by
    // RFC 6265. Each of these is a value a naive serializer silently loses.
    const codec = createCookieCodec();
    for (const value of ['id;42', 'a,b', 'with space', 'a=b=c', 'café central']) {
      const header = codec.serialize('k', value);
      expect(codec.parse(header.split('; ')[0])?.get('k')).toBe(value);
    }
  });

  it('survives a value ending in base64 padding', () => {
    // The failure this pins: `split('=')` keeps only the second element, so
    // every `=` after the first is dropped and the token no longer verifies.
    const codec = createCookieCodec();
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0==';
    expect(codec.parse(`tok=${encodeURIComponent(token)}`).get('tok')).toBe(token);
  });

  it('keeps the FIRST of a repeated name', () => {
    // A browser sends the most specific path first, and that is the visitor's
    // own cookie. Preferring the last would favour a broader-scoped one.
    expect(createCookieCodec().parse('cart=specific; cart=broad').get('cart')).toBe('specific');
  });

  it('returns the raw text for a malformed percent escape instead of throwing', () => {
    // Cookies are attacker-supplied. A lone `%` makes decodeURIComponent throw,
    // which would 500 every request carrying it — and the visitor cannot clear
    // a cookie they cannot see.
    expect(createCookieCodec().parse('k=100%').get('k')).toBe('100%');
  });

  it('distinguishes an empty value from an absent one', () => {
    const jar = createCookieCodec().parse('flag=; other=x');
    expect(jar.get('flag')).toBe('');
    expect(jar.has('flag')).toBe(true);
    expect(jar.get('missing')).toBeUndefined();
    expect(jar.has('missing')).toBe(false);
  });

  it('ignores segments with no name', () => {
    expect([...createCookieCodec().parse('=orphan; k=v').keys()]).toEqual(['k']);
  });

  it('parses an absent header as an empty jar', () => {
    const codec = createCookieCodec();
    expect(codec.parse(null).size).toBe(0);
    expect(codec.parse(undefined).size).toBe(0);
    expect(codec.parse('').size).toBe(0);
  });

  it('writes the attributes it was given, and omits the ones it was not', () => {
    const codec = createCookieCodec();
    const header = codec.serialize('sid', 'abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60,
    });
    expect(header).toBe('sid=abc; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax');
    expect(codec.serialize('sid', 'abc')).toBe('sid=abc');
  });

  it('keeps Max-Age=0 rather than treating it as unset', () => {
    // `0` means "expire now" — the falsy-check bug would drop the whole
    // attribute and leave a session cookie that never goes away.
    expect(createCookieCodec().serialize('k', 'v', { maxAge: 0 })).toContain('Max-Age=0');
  });

  it('serializes a deletion as an empty value with a past expiry', () => {
    const header = createCookieCodec().serializeDeletion('sid');
    expect(header).toContain('sid=');
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(header).toContain('Path=/');
  });

  it('passes Path and Domain through a deletion, since the browser matches on them', () => {
    const header = createCookieCodec().serializeDeletion('sid', {
      path: '/admin',
      domain: 'example.test',
    });
    expect(header).toContain('Path=/admin');
    expect(header).toContain('Domain=example.test');
  });
});

describe('createCookieCodec({ encode: false })', () => {
  it('reports that it does not encode', () => {
    expect(createCookieCodec({ encode: false }).encodes).toBe(false);
  });

  it('writes the value verbatim, for wire-compatibility with an older serializer', () => {
    expect(createCookieCodec({ encode: false }).serialize('tok', 'a=b')).toBe('tok=a=b');
  });

  it('still survives `=` on the way back, because the parser splits on the FIRST one', () => {
    expect(createCookieCodec({ encode: false }).parse('tok=a=b').get('tok')).toBe('a=b');
  });

  it('leaves a percent sequence alone rather than decoding it', () => {
    expect(createCookieCodec({ encode: false }).parse('k=caf%C3%A9').get('k')).toBe('caf%C3%A9');
  });
});

describe('codec interoperability during a rollout', () => {
  it('the decoding parser reads a raw writer’s output unchanged', () => {
    // The safe direction, and the reason `encode` can default to true: a value
    // with no `%` in it is a fixed point of decodeURIComponent.
    const encoding = createCookieCodec();
    const rawWriter = createCookieCodec({ encode: false });
    const header = rawWriter.serialize('tok', 'YWJjZGVm');
    expect(encoding.parse(header).get('tok')).toBe('YWJjZGVm');
  });
});
