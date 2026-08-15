import { describe, expect, it } from 'vitest';

import { getCookieValue, getServerBaseUrl } from './url';

const requestWith = (cookie?: string): Request =>
  new Request('https://host.test/some/path', {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });

describe('getCookieValue', () => {
  it('reads a plain value', () => {
    expect(getCookieValue(requestWith('sid=abc'), 'sid')).toBe('abc');
  });

  it('picks the named cookie out of a multi-cookie header', () => {
    const request = requestWith('first=1; sid=abc; last=9');
    expect(getCookieValue(request, 'sid')).toBe('abc');
  });

  it('keeps everything after the FIRST separator', () => {
    // The regression this fixes. `split('=')[1]` returned only `a`, so any
    // value containing `=` came back truncated — subtly wrong, not missing.
    expect(getCookieValue(requestWith('tok=a=b=c'), 'tok')).toBe('a=b=c');
  });

  it('keeps base64 padding intact', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0==';
    expect(getCookieValue(requestWith(`tok=${token}`), 'tok')).toBe(token);
  });

  it('percent-decodes, so a conforming serializer round-trips', () => {
    // RFC 6265 forbids `;`, `,`, whitespace and control characters in a value,
    // so any correct writer encodes them. This used to return them encoded.
    expect(getCookieValue(requestWith('store=caf%C3%A9%20central'), 'store')).toBe('café central');
    expect(getCookieValue(requestWith('cart=id%3B42'), 'cart')).toBe('id;42');
  });

  it('returns the raw text for a malformed escape rather than throwing', () => {
    // A cookie header is attacker-supplied; a lone `%` throws in
    // decodeURIComponent, and a 500 per request is not an option for a value
    // the visitor cannot see to clear.
    expect(getCookieValue(requestWith('k=100%'), 'k')).toBe('100%');
  });

  it('returns empty string when the cookie is absent', () => {
    expect(getCookieValue(requestWith('other=1'), 'sid')).toBe('');
  });

  it('returns empty string when there is no Cookie header at all', () => {
    expect(getCookieValue(requestWith(), 'sid')).toBe('');
  });

  it('does not match a cookie whose name merely ENDS with the one asked for', () => {
    // `fp_sid=…` must not answer a request for `sid`.
    expect(getCookieValue(requestWith('fp_sid=nope'), 'sid')).toBe('');
  });

  it('ignores a nameless segment', () => {
    expect(getCookieValue(requestWith('=orphan; sid=abc'), 'sid')).toBe('abc');
  });

  it('takes the FIRST of a repeated name', () => {
    // What the browser sends for the most specific path.
    expect(getCookieValue(requestWith('sid=specific; sid=broad'), 'sid')).toBe('specific');
  });
});

describe('getServerBaseUrl', () => {
  it('returns the origin without the path', () => {
    expect(getServerBaseUrl(requestWith(), false)).toBe('https://host.test');
  });

  it('upgrades http to https when asked, off localhost', () => {
    const request = new Request('http://example.test/a/b');
    expect(getServerBaseUrl(request, true)).toBe('https://example.test');
  });

  it('leaves localhost on http even when asked to upgrade', () => {
    const request = new Request('http://localhost:3000/a/b');
    expect(getServerBaseUrl(request, true)).toBe('http://localhost:3000');
  });
});
