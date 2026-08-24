/**
 * The HOST half of `@12-apps/observability-frontend`, in process.
 *
 * The browser specs (`harness/frontend/tests/observability.spec.ts`) are where
 * the package is actually exercised. These cases cover the two things about the
 * host that a browser spec would only fail at CONFUSINGLY:
 *
 * - the served config's DEFAULT, which is what keeps reporting off for every
 *   other page in this app — a browser spec seeing no events cannot tell "off"
 *   from "broken";
 * - the ingest's REACH. Its path carries a `:projectId` segment, which looks
 *   like the wildcard `lifecycle-endpoints.test.ts` keeps a mount-order guard
 *   over. It is not one — the route is POST-only and three segments ending in a
 *   literal `envelope`, so it collides with nothing here whatever the
 *   registration order (measured). What is worth pinning is therefore the
 *   narrowness itself: widen the path, or drop the method, and this is the
 *   suite that says a surface next door started answering `{ id }` with a 200.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { capturedEvents, observability } from '../src/observability-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

/**
 * Serve a config, through the same control the browser specs use.
 *
 * Deliberately over the wire rather than by assigning to the imported
 * container: the control endpoint IS the seam a suite has, so driving it here
 * covers it as well, and a test that reached past it would be asserting against
 * a state no spec can actually reach.
 */
async function serve(config: Record<string, string>): Promise<void> {
  const response = await backend.app.request('/__harness/observability/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  expect(response.status).toBe(204);
}

/** One envelope, in Sentry's newline-delimited format. */
function envelope(...items: unknown[]): string {
  return [{ sent_at: '2026-08-24T12:00:00Z' }, ...items].map((i) => JSON.stringify(i)).join('\n');
}

describe('the served config', () => {
  it('answers an EMPTY dsn by default', async () => {
    // The package's whole contract: no DSN, no SDK, no network. Dev, CI and
    // every deployment that has not opted in sit here — which is also what
    // stops a suite filling an issue tracker with its own deliberate failures.
    const body = (await (
      await backend.app.request('/api/observability-config?app=harness')
    ).json()) as { data: { dsn: string; environment: string } };

    expect(body.data.dsn).toBe('');
    expect(body.data.environment).toBe('harness');
  });

  it('answers whatever the host is currently serving', async () => {
    await serve({ dsn: 'http://key@example.invalid/7', release: 'harness@2.0.0' });

    const body = (await (
      await backend.app.request('/api/observability-config?app=harness')
    ).json()) as { data: { dsn: string; release: string } };

    expect(body.data.dsn).toBe('http://key@example.invalid/7');
    expect(body.data.release).toBe('harness@2.0.0');
  });

  it('goes back to off on reset', async () => {
    // `startObservability` runs once for the whole bundle, so a page that
    // turned reporting on would leave it on for every page after it. The reset
    // control is what keeps one spec from changing another's world.
    await serve({ dsn: 'http://key@example.invalid/7' });
    expect((await backend.app.request('/__harness/reset', { method: 'POST' })).status).toBe(204);

    const body = (await (
      await backend.app.request('/api/observability-config?app=harness')
    ).json()) as { data: { dsn: string } };
    expect(body.data.dsn).toBe('');
  });
});

describe('the ingest', () => {
  it('records an envelope and picks the event out of it', async () => {
    const response = await backend.app.request('/api/1/envelope/', {
      method: 'POST',
      body: envelope({ type: 'event' }, { level: 'error', message: 'boom' }),
    });

    // 200 rather than a 4xx: the real ingest answers with an id, and anything
    // else makes the SDK retry — turning one deliberate error into several
    // arrivals and every count assertion into a race.
    expect(response.status).toBe(200);
    // The item HEADER is not an event; only the payload beside it is.
    expect(capturedEvents()).toEqual([{ level: 'error', message: 'boom' }]);
  });

  it('keeps a body it cannot parse rather than swallowing it', async () => {
    await backend.app.request('/api/1/envelope/', { method: 'POST', body: 'not json at all' });

    // A suite asserting "nothing was sent" must not be satisfied by a send that
    // merely failed to parse — so an unreadable body is recorded, not dropped.
    expect(observability.captured).toHaveLength(1);
  });

  it('answers both spellings, because the SDK sends the trailing slash', async () => {
    await backend.app.request('/api/1/envelope', {
      method: 'POST',
      body: envelope({ type: 'event' }, { message: 'no slash' }),
    });

    expect(capturedEvents()).toHaveLength(1);
  });
});

describe('what the ingest does NOT answer', () => {
  it('leaves a same-shaped path that is not an envelope alone', async () => {
    // Three segments under `/api`, POST — everything the ingest matches except
    // the last word. Widening the path to `/api/:projectId/:kind` is the edit
    // this refuses, and it would be a 200 either way, which is what would make
    // it silent.
    const response = await backend.app.request('/api/1/attachment', { method: 'POST' });

    expect(response.status).toBe(404);
    expect(observability.captured).toEqual([]);
  });

  it('leaves the tenant and account surfaces alone', async () => {
    // Not an ordering claim — these are four segments and a GET, so they could
    // not reach the ingest however it were mounted. What they pin is that the
    // ingest's presence changed nothing about the surfaces it sits beside.
    const tenant = await backend.app.request('/api/admin/harness/entitlements');
    const account = await backend.app.request('/api/account/notifications');

    expect(tenant.status).toBe(200);
    expect(account.status).not.toBe(404);
    expect(observability.captured).toEqual([]);
  });
});
