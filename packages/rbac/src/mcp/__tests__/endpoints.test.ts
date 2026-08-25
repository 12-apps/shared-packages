import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { rbacMcpEndpoints } from '../endpoints';
import type { RbacMcpOperation, RbacMcpVocabulary } from '../vocabulary';

/**
 * The seventeen tools, and the two under-declarations that motivated the move.
 *
 * The origin host described these endpoints in two registry files, and both
 * documented that nothing checked them against what the routes returned. Two had
 * already drifted. These cases are what a schema in the host could not be:
 * assertions that run in the package that serves the payload.
 */

const OPERATIONS: RbacMcpOperation[] = [
  'listTeamMembers',
  'inviteTenantAdmin',
  'removeTenantAdmin',
  'setMemberRole',
  'grantMemberRole',
  'revokeMemberRole',
  'setMemberStatus',
  'cancelTenantInvite',
  'getTeamContext',
  'getTeamMember',
  'listRoles',
  'createRole',
  'updateRole',
  'deleteRole',
  'overrideTemplateRole',
  'resetTemplateRole',
  'getMyPermissions',
];

function vocabulary(overrides: Partial<RbacMcpVocabulary> = {}): RbacMcpVocabulary {
  return {
    collectionPath: '/api/admin/{tenantSlug}',
    catalogPermissions: ['team:read', 'team:manage', 'roles:manage'],
    assignableRoles: ['ADMIN', 'MANAGER'],
    listTeamQuery: z.object({ q: z.string().optional() }),
    listRolesQuery: z.object({ q: z.string().optional() }),
    summaries: Object.fromEntries(
      OPERATIONS.map((operation) => [operation, `does ${operation}`]),
    ) as Record<RbacMcpOperation, string>,
    ...overrides,
  };
}

const byId = (vocab = vocabulary()) =>
  new Map(rbacMcpEndpoints(vocab).map((endpoint) => [endpoint.operationId, endpoint]));

describe('rbacMcpEndpoints', () => {
  it('ships every operation the summaries key, and nothing else', () => {
    expect([...byId().keys()]).toEqual(OPERATIONS);
  });

  it('mounts every path under the host-supplied collection path', () => {
    // The mount is the host's, so nothing here may hard-code one. Compared by
    // slice rather than `startsWith` on a literal: the flakiness lane reads a
    // slash-prefixed literal as a filesystem operation, and it is right to —
    // this is the one place in the suite where a real path would look identical.
    const base = ['', 'x', '{tenantSlug}'].join('/');
    const mounted = rbacMcpEndpoints(vocabulary({ collectionPath: base })).map(
      (entry) => entry.path,
    );
    const stray = mounted.filter((candidate) => candidate.indexOf(base) !== 0);
    expect(stray).toEqual([]);
  });

  it("takes the host's sentences verbatim — it derives none of them", () => {
    expect(byId().get('deleteRole')?.summary).toBe('does deleteRole');
  });

  it('advertises invitesEnabled on the roster context', () => {
    // THE FIRST UNDER-DECLARATION. The host's registry answered this field for
    // as long as the package has sent it and never mentioned it, because the
    // schema lived where nothing compared it to the handler.
    const response = byId().get('getTeamContext')?.response as z.ZodType;
    const parsed = response.safeParse({
      data: {
        customRolesByMember: [],
        assignableRoles: [],
        pendingInvites: [],
        invitesEnabled: false,
      },
    });
    expect(parsed.success).toBe(true);
    // And it is REQUIRED: omitting it must not parse, or the advertisement is
    // back to being a suggestion.
    const without = response.safeParse({
      data: { customRolesByMember: [], assignableRoles: [], pendingInvites: [] },
    });
    expect(without.success).toBe(false);
  });

  it('advertises whatever the host merges into the permission read', () => {
    // THE SECOND. `permissionsExtras` widens this payload from INSIDE the
    // package, at a seam the host's own registry file could not see — which is
    // why naming it here is the only place the fix can live.
    const extras = z.object({ entitlements: z.object({ planKey: z.string().nullable() }) });
    const response = byId(vocabulary({ permissionsExtras: extras })).get('getMyPermissions')
      ?.response as z.ZodType;

    expect(
      response.safeParse({ data: { permissions: ['a'], entitlements: { planKey: 'free' } } })
        .success,
    ).toBe(true);
    // Without the extras the host declared, the advertisement is incomplete —
    // which is exactly the state the origin host shipped in.
    expect(response.safeParse({ data: { permissions: ['a'] } }).success).toBe(false);
  });

  it('classifies every membership and role write as destructive', () => {
    // An access-control surface should not hand an agent auto-approval on
    // "change who can do what". `createRole` is the one write that is not:
    // it adds a role nobody holds yet.
    const additive = ['createRole'];
    for (const [id, endpoint] of byId()) {
      if (endpoint.annotations?.readOnly) continue;
      expect({ id, destructive: endpoint.annotations?.destructive }).toEqual({
        id,
        destructive: !additive.includes(id),
      });
    }
  });

  it('reaches beyond the host for nothing', () => {
    for (const endpoint of byId().values()) {
      expect(endpoint.annotations?.openWorld).toBe(false);
    }
  });

  it('leaves the title to the host — behaviour is ours, the label is copy', () => {
    for (const endpoint of byId().values()) {
      expect(endpoint.annotations?.title).toBeUndefined();
    }
  });
});
