/* eslint-disable test-flakiness/no-database-operations -- the database is the
   subject: the ownership rules over the PUBLISHED tarball on a real Postgres
   (PGlite), with SQL fixtures for the states no packaged route can reach (a
   second owner, a disabled owner, a trigger that rewrites the column). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PT_BR_RBAC_MESSAGES } from '@12-apps/rbac/server';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { RBAC_TENANT_ID } from '../src/rbac-host';

/**
 * The owner rules of `@12-apps/rbac` (FUT-2435), end to end over the tarball,
 * on the two writes that can take an owner role away — the revoke and the
 * removal (the PATCH role set went in FUT-2440): the lock is a real UPDATE of a real
 * `roles` row, the reads are real SQL through the harness's seam, and the
 * outcomes are the routes' own. What PGlite cannot show is two connections at
 * once; the package's unit suite interleaves the writes against its fake.
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

/** The seeded owner template's id: `${tenantId}-role-${name.toLowerCase()}`. */
const DIRECTOR_ROW = `${RBAC_TENANT_ID}-role-director`;

function asUser(userId: string) {
  const base = `/api/admin/${RBAC_TENANT_ID}`;
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

async function permissionsOf(userId: string): Promise<string[]> {
  const response = await asUser(userId).get('/permissions');
  return (await json<{ data: { permissions: string[] } }>(response)).data.permissions;
}

/** A second DIRECTOR, column and link both, as a transfer or a seed leaves one. */
async function addSecondOwner(): Promise<void> {
  await backend.pg.query(
    `INSERT INTO memberships (id, user_id, client_id, role, active, created_at, updated_at)
     VALUES ('m-owner-2', 'owner-2', $1, 'DIRECTOR', TRUE, NOW(), NOW())`,
    [RBAC_TENANT_ID],
  );
  await backend.pg.query(
    `INSERT INTO membership_roles (id, membership_id, role_id)
     VALUES ('mr-m-owner-2', 'm-owner-2', $1)`,
    [DIRECTOR_ROW],
  );
}

async function disable(userId: string): Promise<void> {
  await backend.pg.query(
    'UPDATE memberships SET active = FALSE WHERE user_id = $1 AND client_id = $2',
    [userId, RBAC_TENANT_ID],
  );
}

async function holdsDirector(userId: string): Promise<boolean> {
  const { rows } = await backend.pg.query(
    `SELECT 1 FROM membership_roles mr JOIN memberships m ON m.id = mr.membership_id
     WHERE m.user_id = $1 AND m.client_id = $2 AND mr.role_id = $3`,
    [userId, RBAC_TENANT_ID, DIRECTOR_ROW],
  );
  return rows.length > 0;
}

describe('revoking an owner role, over real SQL', () => {
  it('h1: refuses an admin who is not an owner, and the owner keeps everything', async () => {
    const response = await asUser('admin-1').send('DELETE', '/team/owner-1/roles/DIRECTOR');
    expect(response.status).toBe(403);
    expect((await json<{ error: string }>(response)).error).toBe(
      PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner,
    );
    expect(await permissionsOf('owner-1')).toContain('roles:manage');
  });

  it('h2: never takes it from the only owner', async () => {
    const response = await asUser('owner-1').send('DELETE', '/team/owner-1/roles/DIRECTOR');
    expect(response.status).toBe(409);
    expect(await holdsDirector('owner-1')).toBe(true);
  });

  it("h3: lets an owner take a co-owner's, and the permissions go with it", async () => {
    await addSecondOwner();
    const response = await asUser('owner-1').send('DELETE', '/team/owner-2/roles/DIRECTOR');
    expect(response.status).toBe(200);
    expect(await holdsDirector('owner-2')).toBe(false);
    expect(await permissionsOf('owner-2')).not.toContain('roles:manage');
  });

  it('h8: an owner whose link was revoked cannot act as one, whatever the column says', async () => {
    await addSecondOwner();
    expect((await asUser('owner-1').send('DELETE', '/team/owner-2/roles/DIRECTOR')).status).toBe(
      200,
    );
    // The harness writes the column verbatim: it still says DIRECTOR. A
    // HEAD_LIBRARIAN link gives owner-2 `team:manage`, so the route's
    // permission admits them and only the owner rule, reading the caller
    // inside the write, refuses (FUT-3661: the tier no longer gates the route).
    await backend.pg.query(
      `INSERT INTO membership_roles (id, membership_id, role_id)
       VALUES ('mr-m-owner-2-head', 'm-owner-2', $1)`,
      [`${RBAC_TENANT_ID}-role-head_librarian`],
    );
    const removal = await asUser('owner-2').send('DELETE', '/team/owner-1');
    expect(removal.status).toBe(403);
    expect((await json<{ error: string }>(removal)).error).toBe(
      PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner,
    );
    expect(await holdsDirector('owner-1')).toBe(true);
  });
});

describe('revoking and removing an owner, over real SQL', () => {
  it('h4: a disabled owner never counts as the one who remains', async () => {
    await addSecondOwner();
    await disable('owner-2');
    const selfRevoke = await asUser('owner-1').send('DELETE', '/team/owner-1/roles/DIRECTOR');
    expect(selfRevoke.status).toBe(409);
    const platformRemoval = await asUser('superadmin').send('DELETE', '/team/owner-1');
    expect(platformRemoval.status).toBe(409);
    const removeDisabled = await asUser('owner-1').send('DELETE', '/team/owner-2');
    expect(removeDisabled.status).toBe(200);
  });

  it('h5: refuses an admin removing an owner, in the removal sentence', async () => {
    const response = await asUser('admin-1').send('DELETE', '/team/owner-1');
    expect(response.status).toBe(403);
    expect((await json<{ error: string }>(response)).error).toBe(
      PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner,
    );
    expect(await holdsDirector('owner-1')).toBe(true);
  });
});

describe('the ownership lock, over real SQL', () => {
  it('h6: rewrites nothing on the owner row but its updated_at', async () => {
    await addSecondOwner();
    // A fixed past stamp, so "it moved" does not depend on the clock's grain.
    await backend.pg.query(
      `UPDATE roles SET updated_at = TIMESTAMP '2020-01-01 00:00:00' WHERE id = $1`,
      [DIRECTOR_ROW],
    );
    const read = async () =>
      (
        await backend.pg.query<{
          name: string;
          kind: string;
          permissions: string;
          locked: boolean;
          archived_at: Date | null;
          updated_at: Date;
        }>(
          'SELECT name, kind, permissions, locked, archived_at, updated_at FROM roles WHERE id = $1',
          [DIRECTOR_ROW],
        )
      ).rows[0];
    const before = await read();
    expect((await asUser('owner-1').send('DELETE', '/team/owner-2/roles/DIRECTOR')).status).toBe(
      200,
    );
    const after = await read();
    expect(after).toMatchObject({
      name: before?.name,
      kind: before?.kind,
      permissions: before?.permissions,
      locked: before?.locked,
      archived_at: before?.archived_at,
    });
    expect(after?.updated_at.getTime()).toBeGreaterThan(before?.updated_at.getTime() ?? Infinity);
  });
});

describe('a grant adds, and a revoke takes only what it names (FUT-2440)', () => {
  it('h9: a grant answers the role granted, and its revoke leaves the role held before', async () => {
    const owner = asUser('owner-1');
    const granted = await owner.send('POST', '/team/chef-1/roles', { role: 'BRANCH_LEAD' });
    expect(granted.status).toBe(200);
    expect(await json(granted)).toEqual({ data: { status: 'granted', role: 'BRANCH_LEAD' } });
    expect((await owner.send('DELETE', '/team/chef-1/roles/BRANCH_LEAD')).status).toBe(200);
    const { rows } = await backend.pg.query<{ name: string }>(
      `SELECT r.name FROM membership_roles mr
         JOIN memberships m ON m.id = mr.membership_id
         JOIN roles r ON r.id = mr.role_id
       WHERE m.user_id = 'chef-1' AND m.client_id = $1`,
      [RBAC_TENANT_ID],
    );
    expect(rows.map((row) => row.name)).toEqual(['CONSERVATOR']);
  });
});
