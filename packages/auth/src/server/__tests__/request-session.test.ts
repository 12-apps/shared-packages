// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBearerForwarder,
  createRequestSession,
  readBearerToken,
  setBearerVerifier,
  type RequestSessionConfig,
  type VerifiedBearerIdentity,
} from '../request-session';

/**
 * The request-session seam.
 *
 * The properties below are the ones a host gets wrong when it writes this
 * itself, and each fails quietly: a bearer that falls back to a cookie
 * authenticates a DIFFERENT principal than the request named, and an
 * `isSuperadmin` built by hand disagrees with the one the sign-in path derives.
 */

const IDENTITY: VerifiedBearerIdentity = {
  email: 'agent@example.com',
  subject: 'sub-1',
  scopes: ['mcp:read'],
};

const cookieSession = { user: { id: 'u1', email: 'human@example.com' } };

function configOver(over: Partial<RequestSessionConfig> = {}): RequestSessionConfig {
  return {
    auth: vi.fn(async () => cookieSession),
    isSuperadmin: vi.fn(async () => false),
    resolveOrigin: async () => 'https://app.example.com',
    ...over,
  };
}

const withBearer = (token: string) =>
  new Request('https://app.example.com/', { headers: { authorization: `Bearer ${token}` } });

afterEach(() => setBearerVerifier(null));

describe('readBearerToken', () => {
  it('reads the token, case-insensitively, and trims it', () => {
    expect(readBearerToken('Bearer abc')).toBe('abc');
    expect(readBearerToken('bearer  abc  ')).toBe('abc');
  });

  it('answers null for anything that is not a bearer', () => {
    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken('')).toBeNull();
    expect(readBearerToken('Basic abc')).toBeNull();
    expect(readBearerToken('Bearer')).toBeNull();
  });
});

describe('createRequestSession', () => {
  it('falls back to the cookie when no verifier is installed', async () => {
    // Bearer auth is OFF until installed, so a token presented before then is
    // ignored rather than trusted.
    const config = configOver();
    const session = await createRequestSession(config)(withBearer('t'));
    expect(session).toBe(cookieSession);
  });

  it('synthesizes a session from a verified bearer', async () => {
    setBearerVerifier(async () => IDENTITY);
    const config = configOver();
    const session = await createRequestSession(config)(withBearer('t'));
    expect(session?.user.email).toBe('agent@example.com');
    expect(session?.scopes).toEqual(['mcp:read']);
    // The cookie path was never consulted.
    expect(config.auth).not.toHaveBeenCalled();
  });

  it('REFUSES rather than falling back when a bearer fails to verify', async () => {
    // The caller asked for token auth and it failed. Answering with whoever
    // holds a cookie in that browser authenticates a different principal than
    // the request named.
    setBearerVerifier(async () => null);
    const config = configOver();
    await expect(createRequestSession(config)(withBearer('bad'))).resolves.toBeNull();
    expect(config.auth).not.toHaveBeenCalled();
  });

  it('derives isSuperadmin from the host resolver, not from the token', async () => {
    // The claim cannot diverge from the one the cookie path derives.
    setBearerVerifier(async () => IDENTITY);
    const isSuperadmin = vi.fn(async () => true);
    const session = await createRequestSession(configOver({ isSuperadmin }))(withBearer('t'));
    expect(isSuperadmin).toHaveBeenCalledWith('agent@example.com');
    expect(session?.user.isSuperadmin).toBe(true);
  });

  it('hands the verifier the resolved origin, for iss/aud', async () => {
    const verifier = vi.fn(async () => IDENTITY);
    setBearerVerifier(verifier);
    await createRequestSession(configOver())(withBearer('t'));
    expect(verifier).toHaveBeenCalledWith('t', 'https://app.example.com');
  });

  it('treats a throwing ambient header as "no bearer", not an error', async () => {
    // Outside a request scope there is simply no incoming bearer.
    setBearerVerifier(async () => IDENTITY);
    const config = configOver({
      ambientAuthorization: async () => {
        throw new Error('not in a request scope');
      },
    });
    await expect(createRequestSession(config)()).resolves.toBe(cookieSession);
  });

  it('still calls auth() with a stand-in request when it has none', async () => {
    // Keeps `auth()` the one thing that decides what a session is, rather than
    // a second "there is no session" rule here that could drift from it.
    const seen: unknown[] = [];
    const auth = vi.fn(async (request: Request) => {
      seen.push(request);
      return null;
    });
    await createRequestSession(configOver({ auth }))();
    expect(auth).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBeInstanceOf(Request);
  });

  it('carries empty scopes when the verifier omits them', async () => {
    setBearerVerifier(async () => ({ email: 'a@b.c' }));
    const session = await createRequestSession(configOver())(withBearer('t'));
    expect(session?.scopes).toEqual([]);
  });
});

describe('createBearerForwarder', () => {
  it('returns the token VERBATIM so a proxy can replay it', async () => {
    // Replaying the caller's own token keeps the agent's call authorized
    // exactly like the user's, rather than re-minted with authority nobody
    // granted.
    setBearerVerifier(async () => IDENTITY);
    await expect(createBearerForwarder(configOver())(withBearer('tok-1'))).resolves.toBe('tok-1');
  });

  it('answers null when there is no verifier, no token, or it does not verify', async () => {
    const forward = createBearerForwarder(configOver());
    await expect(forward(withBearer('t'))).resolves.toBeNull();
    setBearerVerifier(async () => null);
    await expect(forward(withBearer('t'))).resolves.toBeNull();
    await expect(forward(new Request('https://app.example.com/'))).resolves.toBeNull();
  });
});
