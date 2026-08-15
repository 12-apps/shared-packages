/**
 * The consent surface, descriptor by descriptor (12-18).
 *
 * Ported from the origin host's `app/api/consent/{status,terms}` route tests. What changed
 * in the move is that the host's user store became two named seams, so these cases
 * assert the CONTRACT of those seams rather than a Prisma double — including the two
 * places a defaulted seam would fail OPEN, which is why neither has a default.
 */
import { describe, expect, it } from 'vitest';

import { CLUB_SERVER_MESSAGES } from '../../__tests__/host-copy';

import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../../core/consent-wire';
import { AppShellApiError } from '../config';
import { createApiAppShell } from '../create-api-app-shell';
import type {
  AppShellRequest,
  AppShellServerConfig,
  ConsentActor,
  ReportUnexpectedError,
  UnexpectedErrorContext,
} from '../config';

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
    messages: CLUB_SERVER_MESSAGES,
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

  /**
   * `Secure` is on unless the host says otherwise. The package cannot read a host's
   * `NODE_ENV`, so silence has to point somewhere, and off means the adopter who never
   * thought about it ships a plaintext consent token to production. This is the case
   * that would go red if the default were flipped back.
   */
  it('marks the handoff cookie Secure when the host said nothing', async () => {
    const { config } = host({
      actor: null,
      cookie: { name: 'signup_terms', sign: (version) => `${version}.sig` },
    });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response.cookies?.[0]?.secure).toBe(true);
  });

  /** …and the opt-out is one word, for a dev box on plain HTTP. */
  it('honours an explicit opt-out for a plain-HTTP host', async () => {
    const { config } = host({
      actor: null,
      cookie: { name: 'signup_terms', sign: (version) => `${version}.sig`, secure: false },
    });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response.cookies?.[0]?.secure).toBe(false);
  });

  it('sets no cookie at all when the host configured none', async () => {
    const { config } = host();
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response.cookies).toBeUndefined();
  });
});

/**
 * THE 500 HAS TO REACH SOMEBODY (12-18).
 *
 * The surface answers 500 over a failed write on purpose — a 204 there tells a user
 * they accepted while every guard keeps refusing them. But a deliberate 500 nobody
 * can see is only half of that decision: the caller is locked out and the operator
 * has nothing to look up. `onUnexpectedError` is the seam that carries it out, and
 * these cases pin the three properties a host depends on — that it fires at all,
 * that it is handed the ERROR rather than a message, and that it cannot change the
 * answer.
 *
 * It exists because of how the first adopter reached this: the host's routes went
 * from a wrapper that logged every unexpected throw through its error reporter to a
 * one-line delegation to this package, and the reporting went with the wrapper
 * silently. Nothing in either half failed.
 */
describe('reporting the unexpected', () => {
  /**
   * A host with a reporter, and the record of what it was told. The wiring lives
   * here rather than in each case so nothing mutates a binding a `it` body owns.
   */
  function reporting(
    options: Parameters<typeof host>[0] = {},
    report?: ReportUnexpectedError,
  ): {
    config: AppShellServerConfig;
    seen: Array<{ error: unknown; context: UnexpectedErrorContext }>;
  } {
    const { config } = host(options);
    const seen: Array<{ error: unknown; context: UnexpectedErrorContext }> = [];
    config.onUnexpectedError =
      report ?? ((error, context) => void seen.push({ error, context }));
    return { config, seen };
  }

  it('hands the host the error itself, and the descriptor that threw', async () => {
    const { config, seen } = reporting({ recordThrows: true });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());

    expect(response.status).toBe(500);
    expect(seen).toHaveLength(1);
    // The ERROR, not a string: a reporter needs a stack to group on, and
    // `String(error)` gives it neither that nor a cause.
    expect(seen[0]?.error).toBeInstanceOf(Error);
    expect((seen[0]?.error as Error).message).toBe('the write failed');
    expect(seen[0]?.context).toEqual({ method: 'POST', path: CONSENT_ACCEPT_PATH });
  });

  /**
   * The READ, too. A caller who cannot find out they are stale is in the same dead
   * end as one who cannot clear it, so the status route is not the quiet one.
   */
  it('reports a failed status read as well as a failed write', async () => {
    const { config, seen } = reporting();
    config.consent.isCurrent = () => {
      throw new Error('the user store is down');
    };
    const response = await routeFor(config, CONSENT_STATUS_PATH).handle(request());

    expect(response.status).toBe(500);
    expect(seen[0]?.context).toEqual({ method: 'GET', path: CONSENT_STATUS_PATH });
  });

  /** Nothing went wrong, so nothing is an incident. */
  it('stays silent when the surface answered normally', async () => {
    const { config, seen } = reporting({ acceptedVersion: '2026-01-01' });
    await routeFor(config, CONSENT_STATUS_PATH).handle(request());
    await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(seen).toEqual([]);
  });

  /**
   * Diagnostics may not decide what the caller receives. A reporter that throws —
   * a misconfigured DSN, a logger initialised too late — must not turn a 500 the
   * browser gate knows how to read into an unhandled rejection.
   */
  it('still answers 500 when the reporter itself throws', async () => {
    const { config } = reporting({ recordThrows: true }, () => {
      throw new Error('the reporter is broken too');
    });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: CLUB_SERVER_MESSAGES.recordFailed });
  });

  /**
   * A status this surface CHOSE is not an incident. Reporting one would file an
   * issue every time a host's own refusal travelled through the fold, which is the
   * noise that makes a reporter stop being read.
   */
  it('does not report a status the surface chose for itself', async () => {
    const { config, seen } = reporting();
    config.consent.resolveActor = () => {
      throw new AppShellApiError(403, 'nope');
    };
    const response = await routeFor(config, CONSENT_STATUS_PATH).handle(request());

    expect(response).toEqual({ status: 403, body: { error: 'nope' } });
    expect(seen).toEqual([]);
  });

  /** A host that wired nothing is unchanged — the seam is optional by design. */
  it('answers exactly the same 500 for a host that wired no reporter', async () => {
    const { config } = host({ recordThrows: true });
    const response = await routeFor(config, CONSENT_ACCEPT_PATH).handle(request());
    expect(response).toEqual({ status: 500, body: { error: CLUB_SERVER_MESSAGES.recordFailed } });
  });
});
