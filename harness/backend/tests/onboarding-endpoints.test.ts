/* eslint-disable test-flakiness/no-database-operations -- the database is the
   subject: this is the origin host's onboarding route suite plus its tenant-isolation
   integration suite, ported to run against the PUBLISHED tarball over a real
   Postgres, driving the same app the browser drives. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  ONBOARDING_MOUNT_PATH,
  ONBOARDING_TENANT,
  ONBOARDING_TENANT_B,
} from '../src/onboarding-host';

/**
 * The @12-apps/onboarding progress surface end-to-end (12-23): the port of
 * the origin host's `onboarding/[featureKey]/__tests__/route.test.ts` and
 * `onboarding-tenant-isolation.integration.test.ts`, now exercised through the
 * published package's own Hono router over its own migration — with the host
 * reduced to the two seams the ADOPTING contract names (the actor, the db).
 *
 * What each case is really asserting is that the package answers for itself: the
 * `{ data }` envelope, the three operations, the statuses, the `(user, tenant,
 * feature)` key. Before this ticket every one of those lived in a host route, and
 * a second app got them only by retyping them.
 */

interface Snapshot {
  featureKey: string;
  status: string;
  step: string | null;
  data: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
}

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

/** Drive the surface as a given user, on a given tenant (the host's seams). */
function asUser(userId: string, tenant: string = ONBOARDING_TENANT) {
  const base = `/api/admin/${tenant}/onboarding`;
  const headers = { 'x-onboarding-user': userId, 'content-type': 'application/json' };
  return {
    get: (featureKey: string) => backend.app.request(`${base}/${featureKey}`, { headers }),
    patch: (featureKey: string, body: unknown) =>
      backend.app.request(`${base}/${featureKey}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      }),
  };
}

async function data<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

describe('GET progress', () => {
  it('answers null — not 404 — before any progress exists', async () => {
    const response = await asUser('owner-1').get('ai_integration');
    expect(response.status).toBe(200);
    // `null` is what the provider's `initialState` takes; a 404 here would make
    // every first visit an error the SPA has to special-case.
    expect(await data<Snapshot | null>(response)).toBeNull();
  });

  it("returns the caller's own snapshot once it exists", async () => {
    await asUser('owner-1').patch('ai_integration', {
      op: 'save',
      status: 'in_progress',
      step: 'choose-host',
      data: { selectedHost: 'claude' },
    });

    const snapshot = await data<Snapshot>(await asUser('owner-1').get('ai_integration'));
    expect(snapshot.status).toBe('in_progress');
    expect(snapshot.step).toBe('choose-host');
    expect(snapshot.data).toEqual({ selectedHost: 'claude' });
    // The package stamps the timestamps, not the host: a first in_progress save
    // starts the clock, and nothing has completed it yet.
    expect(snapshot.startedAt).not.toBeNull();
    expect(snapshot.completedAt).toBeNull();
  });

  it('401s an unauthenticated caller before any handler runs', async () => {
    const response = await asUser('anonymous').get('ai_integration');
    expect(response.status).toBe(401);
  });

  it('404s a feature this host never declared', async () => {
    // Not a 200-with-empty-snapshot: an undeclared key would otherwise mint its
    // own row and read as progress nobody can see.
    const response = await asUser('owner-1').get('feature_de_typo');
    expect(response.status).toBe(404);
  });
});

describe('PATCH — the three operations', () => {
  it('saves status, step and data together', async () => {
    const response = await asUser('owner-1').patch('payments', {
      op: 'save',
      status: 'in_progress',
      step: 'connect-provider',
      data: { provider: 'pagbank' },
    });
    expect(response.status).toBe(200);
    const snapshot = await data<Snapshot>(response);
    expect(snapshot).toMatchObject({
      featureKey: 'payments',
      status: 'in_progress',
      step: 'connect-provider',
      data: { provider: 'pagbank' },
    });
  });

  it('merges data across saves and keeps a step it was not asked to change', async () => {
    const user = asUser('owner-1');
    await user.patch('ai_integration', {
      op: 'save',
      status: 'in_progress',
      step: 'choose-host',
      data: { selectedHost: 'claude' },
    });
    await user.patch('ai_integration', { op: 'save', status: 'in_progress', data: { seen: true } });

    const snapshot = await data<Snapshot>(await user.get('ai_integration'));
    expect(snapshot.data).toEqual({ selectedHost: 'claude', seen: true });
    expect(snapshot.step).toBe('choose-host');
  });

  it('stamps completedAt when the flow completes', async () => {
    const snapshot = await data<Snapshot>(
      await asUser('owner-1').patch('ai_integration', { op: 'save', status: 'completed' }),
    );
    expect(snapshot.status).toBe('completed');
    expect(snapshot.completedAt).not.toBeNull();
  });

  it('dismisses without being told the status', async () => {
    const snapshot = await data<Snapshot>(
      await asUser('owner-1').patch('ai_integration', { op: 'dismiss' }),
    );
    expect(snapshot.status).toBe('dismissed');
  });

  it('resets to a clean first-run, and the row is really gone', async () => {
    const user = asUser('owner-1');
    await user.patch('ai_integration', { op: 'save', status: 'in_progress', step: 'x' });

    const wiped = await data<Snapshot>(await user.patch('ai_integration', { op: 'reset' }));
    expect(wiped).toMatchObject({ status: 'not_started', step: null, data: {} });
    // Not merely "reads as not_started": a reset that left the row would resume
    // the moment anything wrote to it again.
    expect(await data<Snapshot | null>(await user.get('ai_integration'))).toBeNull();
  });

  it('400s an unknown operation and an invalid status', async () => {
    const user = asUser('owner-1');
    expect((await user.patch('ai_integration', { op: 'explode' })).status).toBe(400);
    expect((await user.patch('ai_integration', { op: 'save', status: 'nope' })).status).toBe(400);
    // A `step` of the wrong TYPE reaches the DB CHECK as a 500 unless the package
    // rejects it first.
    expect((await user.patch('ai_integration', { op: 'save', step: 7 })).status).toBe(400);
  });

  it('400s a body that is not an operation at all', async () => {
    const response = await backend.app.request(
      `/api/admin/${ONBOARDING_TENANT}/onboarding/ai_integration`,
      {
        method: 'PATCH',
        headers: { 'x-onboarding-user': 'owner-1', 'content-type': 'application/json' },
        body: 'not json',
      },
    );
    expect(response.status).toBe(400);
  });

  it('401s an unauthenticated write', async () => {
    const response = await asUser('anonymous').patch('ai_integration', { op: 'dismiss' });
    expect(response.status).toBe(401);
  });
});

describe('isolation — the row key is (user, tenant, feature)', () => {
  it("does not leak one tenant's progress to the same user in another", async () => {
    await asUser('owner-1', ONBOARDING_TENANT).patch('ai_integration', {
      op: 'save',
      status: 'completed',
    });

    const neighbour = await asUser('owner-1', ONBOARDING_TENANT_B).get('ai_integration');
    expect(await data<Snapshot | null>(neighbour)).toBeNull();
  });

  it('keeps two users on one tenant independent', async () => {
    await asUser('owner-1').patch('ai_integration', { op: 'save', status: 'completed' });
    await asUser('chef-1').patch('ai_integration', { op: 'save', status: 'in_progress' });

    expect((await data<Snapshot>(await asUser('owner-1').get('ai_integration'))).status).toBe(
      'completed',
    );
    expect((await data<Snapshot>(await asUser('chef-1').get('ai_integration'))).status).toBe(
      'in_progress',
    );
  });

  it('keeps two features on one (user, tenant) independent', async () => {
    await asUser('owner-1').patch('ai_integration', { op: 'save', status: 'completed' });
    expect(await data<Snapshot | null>(await asUser('owner-1').get('payments'))).toBeNull();
  });

  it('scopes a reset to its own tenant', async () => {
    await asUser('owner-1', ONBOARDING_TENANT).patch('ai_integration', {
      op: 'save',
      status: 'completed',
    });
    await asUser('owner-1', ONBOARDING_TENANT_B).patch('ai_integration', {
      op: 'save',
      status: 'in_progress',
    });

    await asUser('owner-1', ONBOARDING_TENANT_B).patch('ai_integration', { op: 'reset' });

    // The neighbour's wipe must not have reached this tenant's row.
    expect(
      (await data<Snapshot>(await asUser('owner-1', ONBOARDING_TENANT).get('ai_integration')))
        .status,
    ).toBe('completed');
  });

  it('resolves nobody for a tenant slug the host does not serve', async () => {
    const response = await asUser('owner-1', 'tenant-que-nao-existe').get('ai_integration');
    expect(response.status).toBe(401);
  });
});

describe('adopted through @12-apps/wiring, not through the per-package adapter', () => {
  it('accounts for every capability, with none unanswered', () => {
    const statuses = new Map(
      backend.hosts.onboarding.report.packages[0]?.capabilities.map((e) => [e.kind, e.status]),
    );

    expect(statuses.get('http')).toBe('bound');
    // Mandatory, with the reason in one line: "a progress write that fails
    // files under `onboarding`, not nowhere." `onboardingRouter` takes no
    // logger argument, so the BINDER is the only thing that can supply one.
    expect(statuses.get('observability')).toBe('bound');
    // Collected still means COUNTED: the partial and its migrations appear in
    // the report, so a host can be asked what it did with them.
    expect(statuses.get('db')).toBe('collected');
    // `unbound` is the status, and this line asserted `'unanswered'` — a string
    // no capability is ever given, so the check every one of these cases is
    // named for could not fail. The same shape of defect the contract exists to
    // catch, in the suite that checks the contract.
    expect([...statuses.values()]).not.toContain('unbound');
  });

  it('names a descriptor this host forgot to claim', () => {
    const { routes } = backend.hosts.onboarding;
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} ${ONBOARDING_MOUNT_PATH}${mounted.route.path}`);

    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.route.path).toBe(routes[0]?.route.path);
  });

  it('renders a report naming the mount', () => {
    expect(renderWiringReport(backend.hosts.onboarding.report)).toContain(ONBOARDING_MOUNT_PATH);
  });
});
