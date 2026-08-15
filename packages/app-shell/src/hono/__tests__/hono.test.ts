/**
 * The adapter, over a real Hono app (12-18).
 *
 * The descriptors are covered in `../../server/__tests__`; what is only checkable here
 * is the translation — the status, the envelope, and the `Set-Cookie` header. That last
 * one is the case worth having: `c.body(null, 204)` returns a FINISHED Response, so a
 * cookie written after it lands nowhere. The acceptance would answer 204 with the
 * handoff cookie silently missing, which is a sign-up flow that loses consent at the
 * OAuth hop and looks like a working endpoint from every angle except the one that
 * matters.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { CLUB_SERVER_MESSAGES } from '../../__tests__/host-copy';

import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../../core/consent-wire';
import { appShellRouter } from '../index';
import type { AppShellServerConfig, ConsentActor } from '../../server/config';

const VERSION = '2026-07-27';

/**
 * A host mounting the surface the way a real one does: the actor comes off a cookie,
 * which is the whole reason `resolveActor` is handed the adapter's raw context.
 */
function app(options: { accepted?: string; cookie?: boolean; recordThrows?: boolean } = {}): Hono {
  const state = { accepted: options.accepted ?? null };
  const config: AppShellServerConfig = {
    termsVersion: VERSION,
    messages: CLUB_SERVER_MESSAGES,
    consent: {
      resolveActor: (request) => {
        const raw = request.header('cookie') ?? '';
        return raw.includes('actor=u1') ? { userId: 'u1' } : null;
      },
      isCurrent: (_actor: ConsentActor, version: string) => state.accepted === version,
      record: (_actor: ConsentActor, version: string) => {
        if (options.recordThrows) throw new Error('the write failed');
        state.accepted = version;
      },
      ...(options.cookie
        ? {
            cookie: {
              name: 'signup_terms',
              sign: (version: string) => `${version}.sig`,
              ttlMs: 60_000,
            },
          }
        : {}),
    },
  };
  const mounted = new Hono();
  mounted.route('/api', appShellRouter(config).router);
  return mounted;
}

const SIGNED_IN = { headers: { cookie: 'actor=u1' } };

describe('appShellRouter', () => {
  it('answers the status read under the host mount, in the `{ data }` envelope', async () => {
    const response = await app({ accepted: '2026-01-01' }).request(
      `/api${CONSENT_STATUS_PATH}`,
      SIGNED_IN,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { stale: true, version: VERSION } });
  });

  it('answers not-stale for a request carrying no session', async () => {
    const response = await app().request(`/api${CONSENT_STATUS_PATH}`);
    expect(await response.json()).toEqual({ data: { stale: false, version: VERSION } });
  });

  it('records an acceptance and answers 204 with an empty body', async () => {
    const server = app({ accepted: '2026-01-01' });
    const accepted = await server.request(`/api${CONSENT_ACCEPT_PATH}`, {
      method: 'POST',
      ...SIGNED_IN,
    });
    expect(accepted.status).toBe(204);
    expect(await accepted.text()).toBe('');

    // The read now agrees — the two endpoints share one predicate, which is the
    // property that makes the prompt clearable at all.
    const status = await server.request(`/api${CONSENT_STATUS_PATH}`, SIGNED_IN);
    expect(await status.json()).toEqual({ data: { stale: false, version: VERSION } });
  });

  it('attaches the handoff cookie to the 204', async () => {
    const response = await app({ cookie: true }).request(`/api${CONSENT_ACCEPT_PATH}`, {
      method: 'POST',
    });
    expect(response.status).toBe(204);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain(`signup_terms=${VERSION}.sig`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Max-Age=60');
    expect(header).toContain('SameSite=Lax');
  });

  it('answers 500 with `{ error }` at the top level when the write failed', async () => {
    const response = await app({ recordThrows: true }).request(`/api${CONSENT_ACCEPT_PATH}`, {
      method: 'POST',
      ...SIGNED_IN,
    });
    expect(response.status).toBe(500);
    // Never wrapped in `data`: an interceptor that unwraps it blindly would turn an
    // error body into a value.
    expect(await response.json()).toEqual({ error: expect.stringContaining('aceite') });
  });

  it('serves only the two methods the surface declares', async () => {
    const server = app();
    expect((await server.request(`/api${CONSENT_STATUS_PATH}`, { method: 'POST' })).status).toBe(
      404,
    );
    expect((await server.request(`/api${CONSENT_ACCEPT_PATH}`)).status).toBe(404);
  });
});
