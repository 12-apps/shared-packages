import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';

/**
 * The published feature-flags surface, driven over the same app the browser
 * drives (FUT-884): the whole grant lifecycle — index tallies, grant by
 * email, toggle, revoke — through the wiring adoption and the shared Hono
 * bridge, against the packed tarball. What this proves is the seam BETWEEN
 * the published halves: the paths the react client builds are the paths the
 * server half actually serves.
 */

const BASE = '/api/platform/feature-flags';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
});

afterAll(async () => {
  await backend.close();
});

function request(path: string, init?: RequestInit): Promise<Response> {
  return backend.app.request(`${BASE}${path}`, init);
}

function post(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('the feature-flags surface', () => {
  it('serves the catalog with grant tallies and no orphans', async () => {
    const response = await request('');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      flags: Array<{ key: string; grantCount: number; enabledCount: number }>;
      orphans: unknown[];
    };
    expect(body.flags.map((flag) => flag.key)).toEqual(['delivery-beta', 'novo-dashboard']);
    // Ana is seeded into the delivery beta.
    expect(body.flags[0]).toMatchObject({ grantCount: 1, enabledCount: 1 });
    expect(body.orphans).toEqual([]);
  });

  it('walks the whole grant lifecycle: grant by email, toggle off, revoke', async () => {
    const granted = await post('/novo-dashboard/grants', {
      email: 'bruno@harness.dev',
      note: 'piloto do dashboard',
    });
    expect(granted.status).toBe(201);
    const { grant } = (await granted.json()) as {
      grant: { userId: string; email: string; enabled: boolean; grantedBy: string };
    };
    expect(grant).toMatchObject({
      userId: 'u-bruno',
      email: 'bruno@harness.dev',
      enabled: true,
      grantedBy: 'root@harness.dev',
    });

    const toggled = await request(`/novo-dashboard/grants/${grant.userId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggled.status).toBe(200);
    expect(((await toggled.json()) as { grant: { enabled: boolean } }).grant.enabled).toBe(false);

    const listed = await request('/novo-dashboard/grants?page=1');
    const page = (await listed.json()) as { items: Array<{ userId: string }>; total: number };
    expect(page.total).toBe(1);

    const revoked = await request(`/novo-dashboard/grants/${grant.userId}`, { method: 'DELETE' });
    expect(revoked.status).toBe(204);
    expect(await revoked.text()).toBe('');

    const after = await request('/novo-dashboard/grants?page=1');
    expect(((await after.json()) as { total: number }).total).toBe(0);
  });

  it('answers the package denials with pt-BR bodies', async () => {
    const unknownFlag = await request('/nope/grants');
    expect(unknownFlag.status).toBe(404);
    expect(((await unknownFlag.json()) as { error: string }).error).toBe('unknown_flag');

    const unknownUser = await post('/delivery-beta/grants', { email: 'quem@harness.dev' });
    expect(unknownUser.status).toBe(404);
    expect(((await unknownUser.json()) as { message: string }).message).toBe(
      'Nenhum usuário com este e-mail.',
    );
  });

  it('lists one person across flags on the users view', async () => {
    const response = await request('/users/u-ana');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      grants: Array<{ flagKey: string; label: string | null; email: string | null }>;
    };
    expect(body.grants.map((row) => row.flagKey)).toContain('delivery-beta');
    expect(body.grants[0]?.label).toBe('Delivery (beta)');
    expect(body.grants[0]?.email).toBe('ana@harness.dev');
  });
});
