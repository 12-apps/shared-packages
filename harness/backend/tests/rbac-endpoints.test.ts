/* eslint-disable test-flakiness/no-database-operations -- the database is the
   subject: these are future-pay's RBAC integration suites, ported to run
   against the PUBLISHED tarball over a real Postgres (PGlite), driving the
   same app the browser drives. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { RBAC_TENANT_B_ID, RBAC_TENANT_ID } from '../src/rbac-host';

/**
 * The @12-apps/rbac surface end-to-end (12-13): the port of future-pay's
 * `rbac.integration.test.ts`, `custom-role.integration.test.ts`,
 * `rbac-roles-per-tenant` and the roles/team route tests — now exercised
 * through the published package's own Hono router over its own migrations,
 * with the host reduced to the seams the ADOPTING contract names (actor
 * header, directory, PGlite-backed db).
 */

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
function asUser(userId: string, tenantId: string = RBAC_TENANT_ID) {
  const base = `/api/admin/${tenantId}`;
  const headers = { 'x-rbac-user': userId, 'content-type': 'application/json' };
  return {
    get: (path: string) => backend.app.request(`${base}${path}`, { headers }),
    send: (method: string, path: string, body?: unknown) =>
      backend.app.request(`${base}${path}`, {
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
    expect(waiter.data.permissions).toContain('loans:read:assigned');
    expect(waiter.data.permissions).not.toContain('config:write');
  });

  it('401s an unauthenticated caller before any handler runs', async () => {
    const response = await asUser('anonymous').get('/permissions');
    expect(response.status).toBe(401);
  });
});

describe('the composed catalog, over the tarball', () => {
  /**
   * The package ships no application catalog: this host assembles one from
   * three owners (`rbac-catalog.ts`) and hands it over as a single `catalog`
   * field. These cases prove the assembly reaches the RUNNING surface — the
   * package's unit suites can only prove it reaches an object.
   */
  it('serves ids from every contributing source through one endpoint', async () => {
    const admin = await json<{ data: { permissions: string[] } }>(
      await asUser('admin-1').get('/permissions'),
    );
    // @12-apps/rbac's own, @harness/lifecycle's, and this host's domain.
    expect(admin.data.permissions).toContain('roles:manage');
    expect(admin.data.permissions).toContain('titles:approve');
    expect(admin.data.permissions).toContain('config:write');
  });

  it('enforces a duty pair whose two halves come from different sources', async () => {
    // `titles:approve` is declared by @harness/lifecycle with
    // `separateFrom: ['titles:write']`, an id it does not own. The pair only
    // exists because composition resolved that counterpart against the whole
    // assembled catalog — and this 400 is that resolution, enforced by the
    // package's own governance over a real database.
    const response = await asUser('owner-1').send('POST', '/roles', {
      name: 'Autor e Aprovador',
      permissions: ['titles:write', 'titles:approve'],
    });
    expect(response.status).toBe(400);
    const body = await json<{ error: string }>(response);
    expect(body.error.length).toBeGreaterThan(0);

    // Either half alone composes fine — the PAIR is what is refused.
    const single = await asUser('owner-1').send('POST', '/roles', {
      name: 'Somente Aprovador',
      permissions: ['titles:approve'],
    });
    expect(single.status).toBe(200);
  });
});

describe('roles — CRUD + governance against the published surface', () => {
  it('lists the seeded catalog, and q narrows it (Voluntário stays, Catalogador goes)', async () => {
    const all = await json<{ data: { name: string }[] }>(await asUser('owner-1').get('/roles'));
    const names = all.data.map((row) => row.name);
    expect(names).toContain('Voluntário');
    expect(names).toContain('Catalogador');
    expect(names).toContain('CLERK');

    const narrowed = await json<{ data: { name: string }[] }>(
      await asUser('owner-1').get('/roles?q=Voluntário'),
    );
    expect(narrowed.data.map((row) => row.name)).toEqual(['Voluntário']);
  });

  it('a custom role grants EXACTLY its set at runtime, and deletion revokes it', async () => {
    const owner = asUser('owner-1');
    const created = await json<{ data: { id: string } }>(
      await owner.send('POST', '/roles', {
        name: 'Visitante do Acervo',
        permissions: ['copies:read'],
      }),
    );
    const grant = await owner.send('POST', '/team/waiter-1/roles', {
      role: 'Visitante do Acervo',
    });
    expect(grant.status).toBe(200);

    const withGrant = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(withGrant.data.permissions).toContain('copies:read');

    const deleted = await owner.send('DELETE', `/roles/${created.data.id}`);
    expect(deleted.status).toBe(200);

    // Deny-by-default: the deleted role stops granting, never a dangling grant.
    const afterDelete = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(afterDelete.data.permissions).not.toContain('copies:read');
  });

  it('governance blocks escalation and owner markers with a user-safe 400', async () => {
    // HEAD_LIBRARIAN composing power they do not hold: budget:manage is an
    // owner-marker permission.
    const response = await asUser('admin-1').send('POST', '/roles', {
      name: 'Golpe',
      permissions: ['budget:manage'],
    });
    expect(response.status).toBe(400);
    const body = await json<{ error: string }>(response);
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('template override narrows what CLERK grants, reset restores the seed', async () => {
    const owner = asUser('owner-1');
    const overridden = await owner.send('PUT', '/roles/templates/CLERK', {
      permissions: ['loans:read:assigned'],
    });
    expect(overridden.status).toBe(200);

    const narrowed = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(narrowed.data.permissions).toEqual(['loans:read:assigned']);

    const reset = await owner.send('DELETE', '/roles/templates/CLERK');
    expect(reset.status).toBe(200);
    const restored = await json<{ data: { permissions: string[] } }>(
      await asUser('waiter-1').get('/permissions'),
    );
    expect(restored.data.permissions.length).toBeGreaterThan(1);
  });

  it('reset is governed: a HEAD_LIBRARIAN cannot restore what the owner withheld', async () => {
    // Reset WRITES the seeded set, so it is governed exactly like the PUT.
    // Narrowing HEAD_LIBRARIAN is the owner's only way to withhold a permission from an
    // administrator; while reset ran no governance, the administrator undid it.
    const owner = asUser('owner-1');
    const withheld = await owner.send('PUT', '/roles/templates/HEAD_LIBRARIAN', {
      // `roles:manage` stays, so the HEAD_LIBRARIAN still reaches the reset route.
      permissions: ['roles:manage', 'team:read', 'config:read'],
    });
    expect(withheld.status).toBe(200);

    const selfReset = await asUser('admin-1').send('DELETE', '/roles/templates/HEAD_LIBRARIAN');
    expect(selfReset.status).toBe(400);
    const stillWithheld = await json<{ data: { permissions: string[] } }>(
      await asUser('admin-1').get('/permissions'),
    );
    expect(stillWithheld.data.permissions).not.toContain('budget:manage');

    // The owner holds '*', so THEIR reset works exactly as before.
    const reset = await owner.send('DELETE', '/roles/templates/HEAD_LIBRARIAN');
    expect(reset.status).toBe(200);
    const restored = await json<{ data: { permissions: string[] } }>(
      await asUser('admin-1').get('/permissions'),
    );
    expect(restored.data.permissions).toContain('budget:manage');
  });

  it('DIRECTOR template is never editable, even by the owner', async () => {
    const response = await asUser('owner-1').send('PUT', '/roles/templates/DIRECTOR', {
      permissions: ['titles:read:all'],
    });
    expect(response.status).toBe(400);
  });

  it('duplicate and reserved names are 409', async () => {
    const owner = asUser('owner-1');
    const reserved = await owner.send('POST', '/roles', {
      name: 'CLERK',
      permissions: ['copies:read'],
    });
    expect(reserved.status).toBe(409);
    const duplicate = await owner.send('POST', '/roles', {
      name: 'Voluntário',
      permissions: ['copies:read'],
    });
    expect(duplicate.status).toBe(409);
  });
});

describe('tenant isolation — the neighbour tenant reaches nothing', () => {
  it('a fully-entitled DIRECTOR of tenant B cannot read or write tenant A rows', async () => {
    const ownerA = asUser('owner-1');
    const ownerB = asUser('owner-b', RBAC_TENANT_B_ID);

    // B sees only its own catalog (no Voluntário/Catalogador — those are A's)…
    const catalog = await json<{ data: { name: string }[] }>(await ownerB.get('/roles'));
    expect(catalog.data.map((row) => row.name)).not.toContain('Voluntário');
    // …and only its own roster.
    const roster = await json<{ data: { userId: string }[] }>(await ownerB.get('/team'));
    expect(roster.data.map((row) => row.userId)).toEqual(['owner-b']);

    // A role id from tenant A is a 404 for B — on edit AND on delete.
    const voluntario = await json<{ data: { id: string; name: string }[] }>(
      await ownerA.get('/roles?q=Voluntário'),
    );
    const foreignId = voluntario.data[0]?.id as string;
    const edited = await ownerB.send('PATCH', `/roles/${foreignId}`, {
      name: 'Roubo',
      permissions: ['copies:read'],
    });
    expect(edited.status).toBe(404);
    const deleted = await ownerB.send('DELETE', `/roles/${foreignId}`);
    expect(deleted.status).toBe(404);

    // A member of tenant A is a 404 for B, never a cross-tenant write.
    const grant = await ownerB.send('POST', '/team/chef-1/roles', { role: 'Voluntário' });
    expect(grant.status).toBe(400); // UNKNOWN_ROLE: B has no Voluntário at all
    const removed = await ownerB.send('DELETE', '/team/chef-1');
    expect(removed.status).toBe(404);
    // And nothing moved on A's side.
    const still = await json<{ data: { userId: string }[] }>(await ownerA.get('/team'));
    expect(still.data.some((row) => row.userId === 'chef-1')).toBe(true);
  });

  it('an unknown tenant slug never reaches a handler (401)', async () => {
    const response = await backend.app.request('/api/admin/intruso/roles', {
      headers: { 'x-rbac-user': 'owner-1' },
    });
    expect(response.status).toBe(401);
  });
});

describe('team — the roster over the directory seam', () => {
  it('lists the seeded staff with identity joined from the directory', async () => {
    const page = await json<{ data: { userId: string; email: string; role: string }[] }>(
      await asUser('owner-1').get('/team'),
    );
    const target = page.data.find((row) => row.userId === 'role-target');
    expect(target).toMatchObject({ email: 'target@harness.dev', role: 'CONSERVATOR' });
  });

  it('q narrows the roster through the directory (Camila stays, Bruno goes)', async () => {
    const page = await json<{ data: { userId: string }[] }>(
      await asUser('owner-1').get('/team?q=Camila'),
    );
    expect(page.data.map((row) => row.userId)).toEqual(['chef-1']);
  });

  it('a CONSERVATOR cannot reach the roster (admin tier)', async () => {
    const response = await asUser('chef-1').get('/team');
    expect(response.status).toBe(403);
  });

  it('reassigns a base role and the member permissions follow', async () => {
    const owner = asUser('owner-1');
    const updated = await owner.send('PATCH', '/team/role-target', { role: 'BRANCH_LEAD' });
    expect(updated.status).toBe(200);

    const permissions = await json<{ data: { permissions: string[] } }>(
      await asUser('role-target').get('/permissions'),
    );
    expect(permissions.data.permissions).toContain('titles:write');

    // Restore, as the future-pay spec did, so ordering never matters.
    await owner.send('PATCH', '/team/role-target', { role: 'CONSERVATOR' });
  });

  it('never demotes the last DIRECTOR (409) and never disables one (403)', async () => {
    const owner = asUser('owner-1');
    const demoted = await owner.send('PATCH', '/team/owner-1', { role: 'HEAD_LIBRARIAN' });
    expect(demoted.status).toBe(409);
    const disabled = await owner.send('PATCH', '/team/owner-1/status', { active: false });
    expect(disabled.status).toBe(403);
  });

  it('disable revokes access until re-enable', async () => {
    const owner = asUser('owner-1');
    await owner.send('PATCH', '/team/chef-1/status', { active: false });
    // Not an empty set — no surface at all: a disabled member holds no STAFF
    // TIER either (BLOCKER-1), so the shell read is a 403, same as their
    // permissions already resolving to nothing.
    const off = await asUser('chef-1').get('/permissions');
    expect(off.status).toBe(403);

    await owner.send('PATCH', '/team/chef-1/status', { active: true });
    const on = await json<{ data: { permissions: string[] } }>(
      await asUser('chef-1').get('/permissions'),
    );
    expect(on.data.permissions.length).toBeGreaterThan(0);
  });

  it('a soft-disabled HEAD_LIBRARIAN loses the roster tier (BLOCKER-1 regression)', async () => {
    const owner = asUser('owner-1');
    await owner.send('PATCH', '/team/admin-1/status', { active: false });
    const roster = await asUser('admin-1').get('/team');
    expect(roster.status).toBe(403);
    const removed = await asUser('admin-1').send('DELETE', '/team/chef-1');
    expect(removed.status).toBe(403);

    await owner.send('PATCH', '/team/admin-1/status', { active: true });
    const restored = await asUser('admin-1').get('/team');
    expect(restored.status).toBe(200);
  });

  it('context lists assignable roles (owner excluded) and invitesEnabled=false', async () => {
    const context = await json<{
      data: { assignableRoles: string[]; invitesEnabled: boolean };
    }>(await asUser('owner-1').get('/team/context'));
    expect(context.data.assignableRoles).toContain('Voluntário');
    expect(context.data.assignableRoles).toContain('CLERK');
    expect(context.data.assignableRoles).not.toContain('DIRECTOR');
    expect(context.data.invitesEnabled).toBe(false);
  });

  it('removes a member and their grants; a stranger id is 404', async () => {
    const owner = asUser('owner-1');
    await owner.send('POST', '/team/waiter-1/roles', { role: 'Voluntário' });
    const removed = await owner.send('DELETE', '/team/waiter-1');
    expect(removed.status).toBe(200);
    const roster = await json<{ data: { userId: string }[] }>(await owner.get('/team'));
    expect(roster.data.some((row) => row.userId === 'waiter-1')).toBe(false);

    const stranger = await owner.get('/team/nobody');
    expect(stranger.status).toBe(404);
  });
});
