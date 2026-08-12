/* eslint-disable test-flakiness/no-database-operations -- the database is the
   subject: these are future-pay's RBAC integration suites, ported to run
   against the PUBLISHED tarball over a real Postgres (PGlite), driving the
   same app the browser drives. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { RBAC_TENANT_ID } from '../src/rbac-host';

/**
 * The @12-apps/rbac surface end-to-end (12-13): the port of future-pay's
 * `rbac.integration.test.ts`, `custom-role.integration.test.ts`,
 * `rbac-roles-per-tenant` and the roles/team route tests — now exercised
 * through the published package's own Hono router over its own migrations,
 * with the host reduced to the seams the ADOPTING contract names (actor
 * header, directory, PGlite-backed db).
 */

const BASE = `/api/admin/${RBAC_TENANT_ID}`;

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

/** Drive the app as a given seeded user (the host's actor seam). */
function asUser(userId: string) {
  const headers = { 'x-rbac-user': userId, 'content-type': 'application/json' };
  return {
    get: (path: string) => backend.app.request(`${BASE}${path}`, { headers }),
    send: (method: string, path: string, body?: unknown) =>
      backend.app.request(`${BASE}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('permissions — the caller own resolved set', () => {
  it('resolves each seeded role to its catalog set', async () => {
    const owner = await json<{ data: { permissions: string[] } }>(
      await asUser('owner-1').get('/permissions'),
    );
    expect(owner.data.permissions).toContain('roles:manage');
    expect(owner.data.permissions).toContain('config:write');

    const waiter = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(waiter.data.permissions).toContain('orders:read:assigned');
    expect(waiter.data.permissions).not.toContain('config:write');
  });

  it('401s an unauthenticated caller before any handler runs', async () => {
    const response = await asUser('anonymous').get('/permissions');
    expect(response.status).toBe(401);
  });
});

describe('roles — CRUD + governance against the published surface', () => {
  it('lists the seeded catalog, and q narrows it (Barista stays, Estoquista goes)', async () => {
    const all = await json<{ data: { name: string }[] }>(await asUser('owner-1').get('/roles'));
    const names = all.data.map((row) => row.name);
    expect(names).toContain('Barista');
    expect(names).toContain('Estoquista');
    expect(names).toContain('WAITER');

    const narrowed = await json<{ data: { name: string }[] }>(
      await asUser('owner-1').get('/roles?q=Barista'),
    );
    expect(narrowed.data.map((row) => row.name)).toEqual(['Barista']);
  });

  it('a custom role grants EXACTLY its set at runtime, and deletion revokes it', async () => {
    const owner = asUser('owner-1');
    const created = await json<{ data: { id: string } }>(
      await owner.send('POST', '/roles', {
        name: 'Visitante de Estoque',
        permissions: ['stock:read'],
      }),
    );
    const grant = await owner.send('POST', '/team/waiter-1/roles', {
      role: 'Visitante de Estoque',
    });
    expect(grant.status).toBe(200);

    const withGrant = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(withGrant.data.permissions).toContain('stock:read');

    const deleted = await owner.send('DELETE', `/roles/${created.data.id}`);
    expect(deleted.status).toBe(200);

    // Deny-by-default: the deleted role stops granting, never a dangling grant.
    const afterDelete = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(afterDelete.data.permissions).not.toContain('stock:read');
  });

  it('governance blocks escalation and owner markers with a user-safe 400', async () => {
    // ADMIN composing power they do not hold: payouts:manage is an
    // owner-marker permission.
    const response = await asUser('admin-1').send('POST', '/roles', {
      name: 'Golpe',
      permissions: ['payouts:manage'],
    });
    expect(response.status).toBe(400);
    const body = await json<{ error: string }>(response);
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('template override narrows what WAITER grants, reset restores the seed', async () => {
    const owner = asUser('owner-1');
    const overridden = await owner.send('PUT', '/roles/templates/WAITER', {
      permissions: ['orders:read:assigned'],
    });
    expect(overridden.status).toBe(200);

    const narrowed = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(narrowed.data.permissions).toEqual(['orders:read:assigned']);

    const reset = await owner.send('DELETE', '/roles/templates/WAITER');
    expect(reset.status).toBe(200);
    const restored = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(restored.data.permissions.length).toBeGreaterThan(1);
  });

  it('OWNER template is never editable, even by the owner', async () => {
    const response = await asUser('owner-1').send('PUT', '/roles/templates/OWNER', {
      permissions: ['products:read:all'],
    });
    expect(response.status).toBe(400);
  });

  it('duplicate and reserved names are 409', async () => {
    const owner = asUser('owner-1');
    const reserved = await owner.send('POST', '/roles', {
      name: 'WAITER',
      permissions: ['stock:read'],
    });
    expect(reserved.status).toBe(409);
    const duplicate = await owner.send('POST', '/roles', {
      name: 'Barista',
      permissions: ['stock:read'],
    });
    expect(duplicate.status).toBe(409);
  });
});

describe('team — the roster over the directory seam', () => {
  it('lists the seeded staff with identity joined from the directory', async () => {
    const page = await json<{ data: { userId: string; email: string; role: string }[] }>(
      await asUser('owner-1').get('/team'),
    );
    const target = page.data.find((row) => row.userId === 'role-target');
    expect(target).toMatchObject({ email: 'target@harness.dev', role: 'CHEF' });
  });

  it('q narrows the roster through the directory (Camila stays, Bruno goes)', async () => {
    const page = await json<{ data: { userId: string }[] }>(
      await asUser('owner-1').get('/team?q=Camila'),
    );
    expect(page.data.map((row) => row.userId)).toEqual(['chef-1']);
  });

  it('a CHEF cannot reach the roster (admin tier)', async () => {
    const response = await asUser('chef-1').get('/team');
    expect(response.status).toBe(403);
  });

  it('reassigns a base role and the member permissions follow', async () => {
    const owner = asUser('owner-1');
    const updated = await owner.send('PATCH', '/team/role-target', { role: 'MANAGER' });
    expect(updated.status).toBe(200);

    const permissions = await json<{ data: { permissions: string[] } }>(
      await asUser('role-target').get('/permissions'),
    );
    expect(permissions.data.permissions).toContain('products:write');

    // Restore, as the future-pay spec did, so ordering never matters.
    await owner.send('PATCH', '/team/role-target', { role: 'CHEF' });
  });

  it('never demotes the last OWNER (409) and never disables one (403)', async () => {
    const owner = asUser('owner-1');
    const demoted = await owner.send('PATCH', '/team/owner-1', { role: 'ADMIN' });
    expect(demoted.status).toBe(409);
    const disabled = await owner.send('PATCH', '/team/owner-1/status', { active: false });
    expect(disabled.status).toBe(403);
  });

  it('disable revokes access until re-enable', async () => {
    const owner = asUser('owner-1');
    await owner.send('PATCH', '/team/chef-1/status', { active: false });
    const off = await json<{ data: { permissions: string[] } }>(
      await asUser('chef-1').get('/permissions'),
    );
    expect(off.data.permissions).toEqual([]);

    await owner.send('PATCH', '/team/chef-1/status', { active: true });
    const on = await json<{ data: { permissions: string[] } }>(
      await asUser('chef-1').get('/permissions'),
    );
    expect(on.data.permissions.length).toBeGreaterThan(0);
  });

  it('context lists assignable roles (owner excluded) and invitesEnabled=false', async () => {
    const context = await json<{
      data: { assignableRoles: string[]; invitesEnabled: boolean };
    }>(await asUser('owner-1').get('/team/context'));
    expect(context.data.assignableRoles).toContain('Barista');
    expect(context.data.assignableRoles).toContain('WAITER');
    expect(context.data.assignableRoles).not.toContain('OWNER');
    expect(context.data.invitesEnabled).toBe(false);
  });

  it('removes a member and their grants; a stranger id is 404', async () => {
    const owner = asUser('owner-1');
    await owner.send('POST', '/team/waiter-1/roles', { role: 'Barista' });
    const removed = await owner.send('DELETE', '/team/waiter-1');
    expect(removed.status).toBe(200);
    const roster = await json<{ data: { userId: string }[] }>(await owner.get('/team'));
    expect(roster.data.some((row) => row.userId === 'waiter-1')).toBe(false);

    const stranger = await owner.get('/team/nobody');
    expect(stranger.status).toBe(404);
  });
});
