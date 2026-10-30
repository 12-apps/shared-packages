import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GLOBAL_SCOPE } from '../context';
import {
  EFFECTIVE_GRANT_MAX_AGE_MS,
  readEffectiveGrants,
  rowsFromGrants,
  grantsFromRows,
} from '../effective-grants';
import { loadSubjectGrants } from '../engine';
import type { RbacResourceGrant, RbacSubjectGrants } from '../grants';
import { createEffectiveGrantsStore } from '../kept-grants';

import { createFakeEffectiveGrants } from './fake-effective-grants';
import { assignRole, enrolMember } from './fake-db';
import { createTestHost } from './server-fixtures';

/**
 * The effective-grants table's read (FUT-3985): one statement for a person
 * whose rows are current, and a recompute through the package's own resolver
 * — written back only while each row's version still holds — when a trigger
 * marked one stale.
 */

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const NOON_ISO = '2026-10-29T12:00:00.000Z';
const noon = (): Date => new Date(NOON_ISO);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(noon());
});

afterEach(() => {
  vi.useRealTimers();
});

async function seededHost() {
  const host = createTestHost();
  await host.api.seedTenantRoles(TENANT_A);
  await host.api.seedTenantRoles(TENANT_B);
  return host;
}

function readerFor(host: Awaited<ReturnType<typeof seededHost>>, table = createFakeEffectiveGrants()) {
  const resolves = { count: 0 };
  const read = () =>
    readEffectiveGrants(
      {
        table: async () => table.delegate,
        resolve: (subject, now) => {
          resolves.count += 1;
          return loadSubjectGrants({ db: async () => host.db }, subject, now);
        },
      },
      'lead-1',
      noon(),
    );
  return { table, resolves, read };
}

describe('a person whose rows are current', () => {
  it('is one read of the table, and no read of the RBAC tables', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const { table, resolves, read } = readerFor(host);
    table.mark('lead-1', TENANT_A);

    const first = await read();
    expect(resolves.count).toBe(1);
    host.calls.length = 0;
    table.calls.length = 0;

    const second = await read();
    expect(second).toEqual(first);
    expect(table.calls).toEqual(['findMany']);
    expect(host.calls).toEqual([]);
    expect(resolves.count).toBe(1);
  });

  it('holds nothing when there are no rows, for the same single read', async () => {
    const host = await seededHost();
    const { table, resolves, read } = readerFor(host);
    expect(await read()).toEqual({ assignments: [], resources: [], memberships: [] });
    expect(table.calls).toEqual(['findMany']);
    expect(resolves.count).toBe(0);
  });
});

describe('a stale row', () => {
  it('is recomputed with what the resolver answers now', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const { table, read } = readerFor(host);
    table.mark('lead-1', TENANT_A);
    expect((await read()).assignments.map((a) => a.role)).toEqual(['BRANCH_LEAD']);

    host.state.memberships[0]!.active = false;
    table.mark('lead-1', TENANT_A);
    const after = await read();
    expect(after.assignments).toEqual([]);
    expect(after.memberships).toEqual([{ clientId: TENANT_A, role: 'BRANCH_LEAD', active: false }]);
    expect([...table.rows.values()].every((row) => !row.stale)).toBe(true);
  });

  it('is not overwritten when a change lands while it is recomputed', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const table = createFakeEffectiveGrants();
    table.mark('lead-1', TENANT_A);
    const answer = await readEffectiveGrants(
      {
        table: async () => table.delegate,
        resolve: async (subject, now) => {
          const resolved = await loadSubjectGrants({ db: async () => host.db }, subject, now);
          // A trigger fires between the resolver's read and the write-back.
          table.mark('lead-1', TENANT_A);
          return resolved;
        },
      },
      'lead-1',
      noon(),
    );
    expect(answer.assignments.map((a) => a.role)).toEqual(['BRANCH_LEAD']);
    expect([...table.rows.values()][0]?.stale).toBe(true);
  });

  it('is kept EMPTY, never deleted, when the person no longer holds anything at its scope', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const { table, read } = readerFor(host);
    table.mark('lead-1', TENANT_A);
    await read();

    host.state.memberships.length = 0;
    host.state.membershipRoles.length = 0;
    table.mark('lead-1', TENANT_A);
    expect(await read()).toEqual({ assignments: [], resources: [], memberships: [] });
    expect([...table.rows.values()]).toMatchObject([{ scope: TENANT_A, stale: false, assignments: [], resources: [] }]);
    expect(table.calls).not.toContain('deleteMany');
  });

  it('is recomputed once it is older than the maximum age, with no mark at all', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const { table, resolves, read } = readerFor(host);
    table.mark('lead-1', TENANT_A);
    await read();
    await read();
    expect(resolves.count).toBe(1);

    table.age(EFFECTIVE_GRANT_MAX_AGE_MS + 1);
    await read();
    expect(resolves.count).toBe(2);
  });

  it('adds a STALE row for a scope the resolver answers that had none, current only after its next read', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    assignRole(host.state, 'lead-1', 'NETWORK_OPS', GLOBAL_SCOPE);
    const { table, resolves, read } = readerFor(host);
    table.mark('lead-1', TENANT_A);
    await read();
    const rows = () => [...table.rows.values()].map((row) => [row.scope, row.stale]).sort();
    expect(rows()).toEqual([
      [GLOBAL_SCOPE, true],
      [TENANT_A, false],
    ]);
    await read();
    expect(rows()).toEqual([
      [GLOBAL_SCOPE, false],
      [TENANT_A, false],
    ]);
    expect(resolves.count).toBe(2);
  });

  it('is recomputed when its JSON does not parse', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const { table, resolves, read } = readerFor(host);
    table.mark('lead-1', TENANT_A);
    await read();
    const row = [...table.rows.values()][0]!;
    row.assignments = [{ role: 7 }];
    expect((await read()).assignments.map((a) => a.role)).toEqual(['BRANCH_LEAD']);
    expect(resolves.count).toBe(2);
  });

  it('still answers when the write-back fails, and stays stale', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const table = createFakeEffectiveGrants();
    table.mark('lead-1', TENANT_A);
    table.failWrites(new Error('read-only replica'));
    const errors: string[] = [];
    const answer = await readEffectiveGrants(
      {
        table: async () => table.delegate,
        resolve: (subject, now) => loadSubjectGrants({ db: async () => host.db }, subject, now),
        onError: (message) => errors.push(message),
      },
      'lead-1',
      noon(),
    );
    expect(answer.assignments.map((a) => a.role)).toEqual(['BRANCH_LEAD']);
    expect([...table.rows.values()][0]?.stale).toBe(true);
    expect(errors.join('\n')).toContain('read-only replica');
  });
});

describe('derived grants', () => {
  it('are kept with the person and judged by their window', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    const table = createFakeEffectiveGrants();
    table.mark('lead-1', TENANT_A);
    const derived: RbacResourceGrant = {
      resourceType: 'loans',
      resourceId: 'loan-9',
      clientId: TENANT_A,
      validFrom: NOON_ISO,
      validTo: null,
    };
    const options = {
      table: async () => table.delegate,
      resolve: (subject: string, now: Date) => loadSubjectGrants({ db: async () => host.db }, subject, now),
      derive: async () => [derived],
    };
    expect((await readEffectiveGrants(options, 'lead-1', noon())).resources).toEqual([derived]);
    expect((await readEffectiveGrants({ ...options, derive: async () => [] }, 'lead-1', noon())).resources).toEqual([
      derived,
    ]);
  });
});

describe('rows and grants', () => {
  it('round-trip, inline permissions and resource windows included', () => {
    const grants: RbacSubjectGrants = {
      assignments: [
        { role: 'BRANCH_LEAD', scope: TENANT_A, permissions: ['titles:write'] },
        { role: 'NETWORK_OPS', scope: GLOBAL_SCOPE, permissions: '*' },
        { role: 'AUDITOR', scope: 'org:north' },
      ],
      resources: [
        { resourceType: 'loans', resourceId: 'l-1', clientId: TENANT_B, validFrom: NOON_ISO, validTo: null },
      ],
      memberships: [{ clientId: TENANT_A, role: 'BRANCH_LEAD', active: true }],
    };
    const back = grantsFromRows([...rowsFromGrants(grants).values()]);
    expect(back.assignments).toEqual(expect.arrayContaining([...grants.assignments]));
    expect(back.assignments).toHaveLength(3);
    expect(back.resources).toEqual(grants.resources);
    expect(back.memberships).toEqual(grants.memberships);
  });
});

describe('the store a host hands the engine', () => {
  it('reads no RBAC table, and not the effective-grants table either, after the first question', async () => {
    const table = createFakeEffectiveGrants();
    const holder: { db: ReturnType<typeof createTestHost>['db'] | null } = { db: null };
    const store = createEffectiveGrantsStore({
      db: async () => {
        if (!holder.db) throw new Error('no db yet');
        return holder.db;
      },
      table: async () => table.delegate,
      listen: async () => undefined,
    });
    const host = createTestHost({ grants: store });
    holder.db = host.db;
    await host.api.seedTenantRoles(TENANT_A);
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    table.mark('lead-1', TENANT_A);
    const actor = { userId: 'lead-1', isSuper: false };

    await host.api.guards.requirePermission(actor, 'titles:write', { scope: TENANT_A });
    host.calls.length = 0;
    table.calls.length = 0;
    await host.api.guards.requirePermission(actor, 'titles:write', { scope: TENANT_A });
    await host.api.guards.getActorPermissions(actor, TENANT_A);
    expect(host.calls).toEqual([]);
    expect(table.calls).toEqual([]);
    expect(await store.membershipRole('lead-1', TENANT_A)).toBe('BRANCH_LEAD');
  });
});
