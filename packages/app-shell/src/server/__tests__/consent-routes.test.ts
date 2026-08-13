/**
 * The consent surface, descriptor by descriptor (12-18).
 *
 * Ported from future-pay's `app/api/consent/{status,terms}` route tests. What changed
 * in the move is that the host's user store became two named seams, so these cases
 * assert the CONTRACT of those seams rather than a Prisma double — including the two
 * places a defaulted seam would fail OPEN, which is why neither has a default.
 */
import { describe, expect, it } from 'vitest';

import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../../core/consent-wire';
import { createApiAppShell } from '../create-api-app-shell';
import type { AppShellRequest, AppShellServerConfig, ConsentActor } from '../config';

const VERSION = '2026-07-27';

/** A request with nothing in it — this surface reads no params and no query. */
function request(overrides: Partial<AppShellRequest> = {}): AppShellRequest {
  return { params: {}, query: {}, header: () => undefined, ...overrides };
}

interface Recorded {
  accepted: string[];
  published: string[];
}

/**
 * A host, as small as one can be: one user, one accepted version, and a record of
 * what the surface asked it to do.
 */
function host(
  options: {
    actor?: ConsentActor | null;
    acceptedVersion?: string | null;
    recordThrows?: boolean;
    cookie?: AppShellServerConfig['consent']['cookie'];
    onAccepted?: boolean;
  } = {},
): { config: AppShellServerConfig; recorded: Recorded } {
  const actor = options.actor === undefined ? { userId: 'u1' } : options.actor;
  const state = { accepted: options.acceptedVersion ?? null };
  const recorded: Recorded = { accepted: [], published: [] };
  const config: AppShellServerConfig = {
    termsVersion: VERSION,
    consent: {
      resolveActor: () => actor,
      isCurrent: (_actor, version) => state.accepted === version,
      record: (_actor, version) => {
        if (options.recordThrows) throw new Error('the write failed');
        state.accepted = version;
        recorded.accepted.push(version);
      },
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.onAccepted
        ? { onAccepted: (a: ConsentActor) => recorded.published.push(a.userId) }
        : {}),
    },
  };
  return { config, recorded };
}

function routeFor(config: AppShellServerConfig, path: string) {
  const route = createApiAppShell(config).routes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`no route for ${path}`);
  return route;
}

describe('the surface itself', () => {
  it('declares exactly the two paths both halves agree on', () => {
    const { routes } = createApiAppShell(host().config);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      `GET ${CONSENT_STATUS_PATH}`,
      `POST ${CONSENT_ACCEPT_PATH}`,
    ]);
  });
});

describe(`GET ${CONSENT_STATUS_PATH}`, () => {
  it('reports a caller who accepted the current version as current', async () => {
    const { config } = host({ acceptedVersion: VERSION });
    const response = await routeFor(config, CONSENT_STATUS_PATH).handle(request());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { stale: false, version: VERSION } });
  });

  /**
   * The whole point of the endpoint. Before it existed the acceptance could be fixed
   * and nothing on screen ever asked, so a bump turned every consented user into a
   * pending one silently.
   */
  it('reports a caller left behind by a bump as stale', async () => {
    const { config } = host({ acceptedVersion: '2026-01-01' });
    const response = await routeFor(config, CONSENT_STATUS_PATH).handle(request());
    expect(response.body).toEqual({ data: { stale: true, version: VERSION } });
  });

  /**
   * Anonymous is `stale: false` — a signed-out visitor is not overdue for anything,
   * they are simply signed out, and conflating the two is what made the original 401
   * unreadable.
   */
  it('answers not-stale for an anonymous caller, without asking the host', async () => {
    const asked: string[] = [];
    const { config } = host({ actor: null });
    config.consent.isCurrent = () => {
      asked.push('isCurrent');
      return false;
    };
    const response = await routeFor(config, CONSENT_STATUS_PATH).handle(request());
    expect(response.body).toEqual({ data: { stale: false, version: VERSION } });
    expect(asked).toEqual([]);
  });
});

describe(`POST ${CONSENT_ACCEPT_PATH}`, () => {
  it('records the acceptance and answers 204 with no body', async () => {
    const { config, recorded } = host({ acceptedVersion: '2026-01-01' });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response.status).toBe(204);
    // `undefined`, not `null`: a client parses `null` as a value.
    expect(response.body).toBeUndefined();
    expect(recorded.accepted).toEqual([VERSION]);
  });

  it('is idempotent — re-accepting records again and still answers 204', async () => {
    const { config, recorded } = host({ acceptedVersion: VERSION });
    await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(recorded.accepted).toEqual([VERSION, VERSION]);
  });

  /**
   * A stamping failure must reach the caller as a 500. Answering 204 over it would
   * report "accepted" while leaving them stale and refused by every guard, with no
   * signal to retry — the exact dead end this surface replaces, one level deeper. The
   * browser gate trusts the status, so this is the assertion the two halves share.
   */
  it('answers 500 when the host could not record it, never 204', async () => {
    const { config, recorded } = host({ recordThrows: true });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: expect.stringContaining('aceite') });
    expect(recorded.accepted).toEqual([]);
  });

  /** …and it must not publish either: nothing changed, so nobody should be woken. */
  it('does not tell the other devices about a write that failed', async () => {
    const { config, recorded } = host({ recordThrows: true, onAccepted: true });
    await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(recorded.published).toEqual([]);
  });

  /**
   * AFTER the write, never before: a woken tab re-ASKS, so publishing first would race
   * the write and re-block the tab it just freed.
   */
  it('tells the other devices once the write landed', async () => {
    const seen: string[] = [];
    const { config } = host({ acceptedVersion: '2026-01-01' });
    config.consent.record = () => {
      seen.push('record');
    };
    config.consent.onAccepted = () => {
      seen.push('onAccepted');
    };
    await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(seen).toEqual(['record', 'onAccepted']);
  });

  /**
   * The pre-account flow: consent is given on a sign-up form and has to survive the
   * OAuth round trip, where there is no account to stamp yet. So the cookie is planted
   * even for an anonymous caller, and nothing is recorded.
   */
  it('plants the signed handoff cookie, for an anonymous caller too', async () => {
    const signed: Array<[string, number]> = [];
    const { config, recorded } = host({
      actor: null,
      cookie: {
        name: 'signup_terms',
        sign: (version, expiresAt) => {
          signed.push([version, expiresAt]);
          return `${version}.sig`;
        },
        ttlMs: 60_000,
        secure: true,
      },
    });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());

    expect(response.status).toBe(204);
    expect(recorded.accepted).toEqual([]);
    expect(response.cookies).toEqual([
      {
        name: 'signup_terms',
        value: `${VERSION}.sig`,
        maxAge: 60,
        path: '/',
        // httpOnly so it cannot be forged through `document.cookie`, which is what
        // keeps the sign-in gate's consent check trustworthy.
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
      },
    ]);
    expect(signed[0]?.[0]).toBe(VERSION);
  });

  it('sets no cookie at all when the host configured none', async () => {
    const { config } = host();
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response.cookies).toBeUndefined();
  });
});
