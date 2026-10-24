import { describe, expect, it } from 'vitest';

import { RbacApiError } from '../context';
import {
  activeResourceIds,
  nextGrantBoundary,
  type RbacGrantsPort,
  type RbacSubjectGrants,
} from '../grants';

import { enrolMember } from './fake-db';
import { createTestHost } from './server-fixtures';

/**
 * A host that keeps a subject's grants (FUT-3906): the engine asks its
 * `grants` port, loads ONCE through it, and decides from what it holds.
 */

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const actor = (userId: string) => ({ userId, isSuper: false });

/** A port over a map — a host's store, with the invalidation the host owns. */
function mapPort(): RbacGrantsPort & { held: Map<string, RbacSubjectGrants>; loads: number } {
  const held = new Map<string, RbacSubjectGrants>();
  const port = {
    held,
    loads: 0,
    async get(subject: string, load: () => Promise<RbacSubjectGrants>) {
      const kept = held.get(subject);
      if (kept) return kept;
      port.loads += 1;
      const loaded = await load();
      held.set(subject, loaded);
      return loaded;
    },
  };
  return port;
}

async function hostWith(port: RbacGrantsPort) {
  const host = createTestHost({ grants: port });
  await host.api.seedTenantRoles(TENANT_A);
  await host.api.seedTenantRoles(TENANT_B);
  return host;
}

const reads = (host: Awaited<ReturnType<typeof hostWith>>, op: string): number =>
  host.calls.filter((call) => call.op === op).length;

describe('a host-kept set of grants', () => {
  it('loads once for every question a request asks about the same subject', async () => {
    const port = mapPort();
    const host = await hostWith(port);
    enrolMember(host.state, TENANT_A, 'lead-1', 'BRANCH_LEAD');
    host.calls.length = 0;

    await host.api.guards.requirePermission(actor('lead-1'), 'titles:write', { scope: TENANT_A });
    await host.api.guards.getActorPermissions(actor('lead-1'), TENANT_A);
    await host.api.guards.listVisibility(actor('lead-1'), ['loans:read:all', 'loans:read:assigned'], 'loans', {
      scope: TENANT_A,
    });

    expect(port.loads).toBe(1);
    expect(reads(host, 'membership.findMany')).toBe(1);
    expect(reads(host, 'resourceAssignment.findMany')).toBe(1);
  });

  it('decides from what the port holds, and from the database again once the host lets it go', async () => {
    const port = mapPort();
    const host = await hostWith(port);
    enrolMember(host.state, TENANT_A, 'clerk-1', 'CLERK');
    await expect(
      host.api.guards.requirePermission(actor('clerk-1'), 'config:write', { scope: TENANT_A }),
    ).rejects.toBeInstanceOf(RbacApiError);

    // Promoted in the database: the kept grants still say CLERK until the
    // host invalidates — which is exactly the host's job.
    enrolMember(host.state, TENANT_A, 'clerk-1', 'DIRECTOR');
    await expect(
      host.api.guards.requirePermission(actor('clerk-1'), 'config:write', { scope: TENANT_A }),
    ).rejects.toBeInstanceOf(RbacApiError);

    port.held.delete('clerk-1');
    await expect(
      host.api.guards.requirePermission(actor('clerk-1'), 'config:write', { scope: TENANT_A }),
    ).resolves.toBeUndefined();
  });

  it('answers reach from the kept resource assignments, per tenant and per window', async () => {
    const port = mapPort();
    const host = await hostWith(port);
    enrolMember(host.state, TENANT_A, 'waiter-1', 'CLERK');
    // Fixed instants on either side of any run: the engine compares the
    // windows with the wall clock.
    for (const [id, clientId, from, to] of [
      ['live-a', TENANT_A, '2020-01-01T00:00:00Z', null],
      ['live-b', TENANT_B, '2020-01-01T00:00:00Z', null],
      ['ended-a', TENANT_A, '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z'],
      ['later-a', TENANT_A, '2999-01-01T00:00:00Z', null],
    ] as const) {
      host.state.resourceAssignments.push({
        id: `ra-${id}`,
        userId: 'waiter-1',
        clientId,
        resourceType: 'loans',
        resourceId: id,
        validFrom: new Date(from),
        validTo: to === null ? null : new Date(to),
      });
    }

    const inA = await host.api.guards.visibleResources(actor('waiter-1'), 'loans:read:assigned', 'loans', {
      scope: TENANT_A,
    });
    expect(inA).toEqual({ kind: 'ids', ids: ['live-a'] });
    // The ended window is not even loaded; the one opening later is, and waits.
    expect(port.held.get('waiter-1')?.resources.map((grant) => grant.resourceId).sort()).toEqual([
      'later-a',
      'live-a',
      'live-b',
    ]);
  });
});

describe('activeResourceIds and nextGrantBoundary', () => {
  const grants: RbacSubjectGrants = {
    assignments: [],
    resources: [
      { resourceType: 'loans', resourceId: 'open', clientId: 'a', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { resourceType: 'loans', resourceId: 'closing', clientId: 'a', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-03-01T00:00:00.000Z' },
      { resourceType: 'loans', resourceId: 'opening', clientId: 'a', validFrom: '2026-02-01T00:00:00.000Z', validTo: null },
      { resourceType: 'titles', resourceId: 'other-type', clientId: 'a', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { resourceType: 'loans', resourceId: 'other-tenant', clientId: 'b', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
    ],
  };

  it('filters by type, tenant and the instant asked', () => {
    expect(activeResourceIds(grants, 'loans', { clientId: 'a' }, new Date('2026-01-15T00:00:00Z'))).toEqual(['open', 'closing']);
    expect(activeResourceIds(grants, 'loans', { clientId: 'a' }, new Date('2026-02-15T00:00:00Z'))).toEqual(['open', 'closing', 'opening']);
    expect(activeResourceIds(grants, 'loans', {}, new Date('2026-04-01T00:00:00Z'))).toEqual(['open', 'opening', 'other-tenant']);
  });

  it('names the next instant the grants change on their own', () => {
    expect(nextGrantBoundary(grants, new Date('2026-01-15T00:00:00Z'))).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(nextGrantBoundary(grants, new Date('2026-02-15T00:00:00Z'))).toEqual(new Date('2026-03-01T00:00:00Z'));
    expect(nextGrantBoundary(grants, new Date('2026-04-01T00:00:00Z'))).toBeNull();
  });
});
