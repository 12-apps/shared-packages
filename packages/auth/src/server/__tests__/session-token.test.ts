// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  encodeSessionToken,
  sessionCookieHeader,
  sessionCookieName,
  type SessionTokenConfig,
} from '../session-token';

/**
 * Minting a session cookie by hand.
 *
 * Every derivation here fails SILENTLY when it is wrong — no error anywhere,
 * just a cookie nothing looks for and a host that stays logged out. That is
 * what makes them worth pinning rather than re-deriving per host.
 */

const secure: SessionTokenConfig = {
  secret: 'a-test-secret-long-enough-to-derive',
  baseUrl: 'https://app.example.com',
  maxAgeSeconds: 60,
};
const insecure: SessionTokenConfig = { ...secure, baseUrl: 'http://localhost:3000' };

describe('sessionCookieName', () => {
  it('mirrors Auth.js: __Secure- on https, bare otherwise', () => {
    expect(sessionCookieName(secure)).toBe('__Secure-authjs.session-token');
    expect(sessionCookieName(insecure)).toBe('authjs.session-token');
  });

  it('treats an absent base URL as not secure', () => {
    expect(sessionCookieName({ ...secure, baseUrl: undefined })).toBe('authjs.session-token');
  });
});

describe('sessionCookieHeader', () => {
  it('writes the cookie under the SAME name the token is salted with', () => {
    // A mismatch produces a cookie the session handler cannot decrypt.
    const header = sessionCookieHeader(secure, 'tok');
    expect(header.startsWith(`${sessionCookieName(secure)}=tok`)).toBe(true);
  });

  it('is HttpOnly and SameSite=Lax, and Secure only on https', () => {
    // `Lax` is required, not incidental: the claim arrives as a top-level GET
    // navigation, and anything stricter hides the session on that redirect.
    const header = sessionCookieHeader(secure, 'tok');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=60');
    expect(header).toContain('Secure');
    expect(sessionCookieHeader(insecure, 'tok')).not.toContain('Secure');
  });
});

describe('encodeSessionToken', () => {
  it('refuses without a secret rather than minting an unreadable token', () => {
    expect(() =>
      encodeSessionToken({ ...secure, secret: '' }, {
        id: 'u1',
        email: 'a@b.c',
        name: null,
        image: null,
        provider: null,
        isSuperadmin: false,
      }),
    ).toThrow(/secret/i);
  });

  it('produces a token that decodes back to the Auth.js claim names', async () => {
    const { decode } = await import('@auth/core/jwt');
    const token = await encodeSessionToken(secure, {
      id: 'u1',
      email: 'a@b.c',
      name: 'Ana',
      image: null,
      provider: 'google',
      isSuperadmin: true,
    });
    const claims = await decode({
      token,
      secret: secure.secret,
      salt: sessionCookieName(secure),
    });
    // `sub`/`name`/`email`/`picture` are what the default session callback
    // reads; the other three are what a host's own callback adds on top.
    expect(claims).toMatchObject({
      sub: 'u1',
      id: 'u1',
      email: 'a@b.c',
      name: 'Ana',
      provider: 'google',
      isSuperadmin: true,
    });
  });

  it('cannot be decoded under a DIFFERENT cookie name', async () => {
    // The salt is the cookie name — this is the silent failure, made loud.
    const { decode } = await import('@auth/core/jwt');
    const token = await encodeSessionToken(secure, {
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
      provider: null,
      isSuperadmin: false,
    });
    await expect(
      decode({ token, secret: secure.secret, salt: sessionCookieName(insecure) }),
    ).rejects.toThrow();
  });
});
