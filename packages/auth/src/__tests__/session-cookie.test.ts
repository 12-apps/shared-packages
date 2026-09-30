import { describe, expect, it } from 'vitest';

import { sessionCookieNameFor } from '../session-cookie';

/**
 * The derivation mirrors one Auth.js makes, and it fails SILENTLY in both
 * directions — a cookie nothing looks for, or a lookup that reports a live
 * session as signed out. Both names are pinned here rather than left to the
 * caller that happens to notice.
 */
describe('sessionCookieNameFor', () => {
  it('prefixes on https, the way Auth.js does', () => {
    expect(sessionCookieNameFor('https://admin.example.com')).toBe(
      '__Secure-authjs.session-token',
    );
  });

  it('does not prefix on http, which is what a local origin needs', () => {
    expect(sessionCookieNameFor('http://localhost:3000')).toBe('authjs.session-token');
  });

  it('treats an unresolved base URL as insecure, matching the library default', () => {
    expect(sessionCookieNameFor(undefined)).toBe('authjs.session-token');
  });
});
