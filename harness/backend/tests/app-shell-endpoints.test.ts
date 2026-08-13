/**
 * `@12-apps/app-shell`'s backend surface, from the tarball, through a host's mount
 * (12-18).
 *
 * The package's own suite drives the descriptors directly. What only a consumer can
 * check is what this file checks: that the PUBLISHED `./hono` subpath resolves, that
 * mounting it under `/api` puts both paths where the shipped browser gate looks for
 * them, and that the two ends agree about the envelope. The version-bump case is the
 * production failure itself — a deploy moves the version, and every previously
 * consented caller has to start reading `stale: true` without anything else changing.
 *
 * Deliberately NO migrations test beside this one: the package owns no Prisma model
 * (see `../src/app-shell-host.ts`), so there is nothing to replay and no
 * `prisma:sync:check` to honour. That absence is asserted below rather than left as a
 * gap, because "the package that quietly stopped shipping its migrations" is a real
 * failure mode in this repo.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '@12-apps/app-shell';

import { createHarnessBackend, type HarnessBackend } from '../src/app';

let backend: HarnessBackend;

/** Ask as a given seeded actor — the host reads this header (or a cookie). */
function as(userId: string): { headers: Record<string, string> } {
  return { headers: { 'x-harness-actor': userId } };
}

async function status(userId: string): Promise<{ stale: boolean; version: string }> {
  const read = await backend.app.request(`/api${CONSENT_STATUS_PATH}`, as(userId));
  expect(read.status).toBe(200);
  const body = (await read.json()) as { data: { stale: boolean; version: string } };
  return body.data;
}

async function accept(userId: string): Promise<Response> {
  return backend.app.request(`/api${CONSENT_ACCEPT_PATH}`, { method: 'POST', ...as(userId) });
}

async function control(path: string, body: unknown): Promise<Response> {
  return backend.app.request(`/__harness/app-shell/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  backend = await createHarnessBackend();
  return async () => {
    await backend.close();
  };
});

describe('the published surface', () => {
  it('exposes both halves of the wire from the root entry', async () => {
    // The two constants ARE the contract between the halves — the gate builds these
    // URLs and the descriptors declare them, so a consumer must be able to read them.
    expect(CONSENT_STATUS_PATH).toBe('/consent/status');
    expect(CONSENT_ACCEPT_PATH).toBe('/consent/terms');
    const mod = await import('@12-apps/app-shell/server');
    expect(typeof mod.createApiAppShell).toBe('function');
    const hono = await import('@12-apps/app-shell/hono');
    expect(typeof hono.appShellRouter).toBe('function');
  });

  it('ships no prisma directory, because it owns no model', () => {
    const root = fileURLToPath(new URL('../node_modules/@12-apps/app-shell/', import.meta.url));
    /* eslint-disable-next-line test-flakiness/no-unmocked-fs -- the installed tree IS
       the subject, as in `published-subpaths.test.ts`. The path read is inside
       harness/backend/node_modules, i.e. inside the tarball this harness was installed
       from; a mock would turn the assertion into a restatement of itself. */
    expect(readdirSync(root)).not.toContain('prisma');
  });

  /**
   * The compiled entry. Everything else in the package is TypeScript source a
   * bundler compiles; this one is loaded by NODE, out of `node_modules`, where Node
   * refuses to strip types — so a `./vite` that shipped as `.ts` would fail only
   * after publishing, in a consumer's `vite.config.ts`. This import is that consumer.
   */
  it('exposes a Vite preset Node itself can load', async () => {
    const mod = await import('@12-apps/app-shell/vite');
    expect(mod.appShellOptimizeDeps()).toEqual({ extensions: ['.tsx'] });
  });
});

describe(`GET /api${CONSENT_STATUS_PATH}`, () => {
  it('reports a caller who accepted the current version as current', async () => {
    expect(await status('owner')).toEqual({ stale: false, version: '2026-07-27' });
  });

  it('reports a caller who never accepted anything as stale', async () => {
    expect(await status('novo')).toEqual({ stale: true, version: '2026-07-27' });
  });

  /**
   * A signed-out visitor is not overdue for anything, they are simply signed out.
   * Conflating the two is what made the original `401` unreadable.
   */
  it('reports an anonymous caller as not stale', async () => {
    const anonymous = await backend.app.request(`/api${CONSENT_STATUS_PATH}`);
    expect(await anonymous.json()).toEqual({ data: { stale: false, version: '2026-07-27' } });
  });
});

describe('a terms-version bump', () => {
  /**
   * THE production failure, reproduced end to end. Before the status endpoint
   * existed, this transition was invisible: the user stayed signed in, avatar and
   * cart intact, and the first thing they heard was a bare `401` at the payment step.
   */
  it('turns every previously consented caller stale, and accepting clears it', async () => {
    expect((await status('owner')).stale).toBe(false);

    await control('bump', { version: '2026-12-01' });

    const bumped = await status('owner');
    expect(bumped).toEqual({ stale: true, version: '2026-12-01' });

    const accepted = await accept('owner');
    expect(accepted.status).toBe(204);
    expect(await accepted.text()).toBe('');

    // The same predicate answers both, which is why the prompt is clearable at all.
    expect(await status('owner')).toEqual({ stale: false, version: '2026-12-01' });
  });

  it('tells the host to wake the other devices, after the write', async () => {
    await control('bump', { version: '2026-12-01' });
    await accept('owner');
    const woken = await backend.app.request('/__harness/app-shell/published');
    expect(await woken.json()).toEqual({ published: ['owner'] });
  });
});

describe(`POST /api${CONSENT_ACCEPT_PATH}`, () => {
  /**
   * The 500 is the load-bearing status. A 204 over a failed write would tell the user
   * they accepted while every guard keeps refusing them — the original dead end, one
   * level deeper, and this time with the browser's prompt cleared so nothing would
   * ever ask again.
   */
  it('answers 500 when the host could not record it, and leaves the caller stale', async () => {
    await control('bump', { version: '2026-12-01' });
    await control('fail-writes', { fails: true });

    const refused = await accept('owner');
    expect(refused.status).toBe(500);
    // `{ error }` at the top level, never wrapped in `data`.
    expect(await refused.json()).toEqual({ error: expect.any(String) });
    expect((await status('owner')).stale).toBe(true);

    // …and nobody was told about a change that did not happen.
    const published = await backend.app.request('/__harness/app-shell/published');
    expect(await published.json()).toEqual({ published: [] });
  });

  /**
   * The pre-account flow: consent given on a sign-up form has to survive the OAuth
   * round trip, where there is no account to stamp yet. So the cookie is planted even
   * for an anonymous caller — and `HttpOnly` is what keeps the sign-in gate's later
   * check trustworthy, since `document.cookie` cannot forge it.
   */
  it('plants the signed handoff cookie on the 204, for an anonymous caller too', async () => {
    const planted = await backend.app.request(`/api${CONSENT_ACCEPT_PATH}`, { method: 'POST' });
    expect(planted.status).toBe(204);
    const header = planted.headers.get('set-cookie') ?? '';
    expect(header).toContain('signup_terms=2026-07-27.');
    expect(header).toContain('harness-signature');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
  });
});

describe('the mount itself', () => {
  it('does not answer the tenant-scoped prefix the other surfaces use', async () => {
    // Consent is a fact about the CALLER; a tenant-prefixed copy would be a second
    // answer to the same question, keyed on something irrelevant to it.
    const prefixed = await backend.app.request(
      `/api/admin/harness${CONSENT_STATUS_PATH}`,
      as('owner'),
    );
    expect(prefixed.status).toBe(404);
  });

  it('serves only the two methods the surface declares', async () => {
    expect(
      (await backend.app.request(`/api${CONSENT_STATUS_PATH}`, { method: 'POST' })).status,
    ).toBe(404);
    expect((await backend.app.request(`/api${CONSENT_ACCEPT_PATH}`)).status).toBe(404);
  });

  /**
   * `/__harness/reset` is what every spec leans on between cases, and a surface that
   * forgot to join it would leave the previous case's bump in place — which reads as
   * the package ignoring its config.
   */
  it('goes back to the seeded fixture on reset', async () => {
    await control('bump', { version: '2026-12-01' });
    await accept('owner');
    await backend.app.request('/__harness/reset', { method: 'POST' });

    expect(await status('owner')).toEqual({ stale: false, version: '2026-07-27' });
    expect((await status('novo')).stale).toBe(true);
  });
});
