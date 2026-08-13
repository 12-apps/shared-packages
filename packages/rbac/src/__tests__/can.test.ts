import { describe, it, expect } from 'vitest';
import { canWith, permissionsFor, type CanContext } from '../core/can';
import { buildRoleIndex } from '../core/roles';
import type { RoleAssignment, RoleDef } from '../core/types';
import { demoCtx } from './fixtures';

const ctx = demoCtx();
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const assign = (role: string, scope: string): RoleAssignment => ({ role, scope });

describe('canWith — role x permission matrix (in scope)', () => {
  const cases: Array<[string, string, boolean]> = [
    // DIRECTOR (wildcard)
    ['DIRECTOR', 'titles:read:all', true],
    ['DIRECTOR', 'loans:waive', true],
    ['DIRECTOR', 'config:write', true],
    // BRANCH_LEAD
    ['BRANCH_LEAD', 'titles:write', true],
    ['BRANCH_LEAD', 'copies:move', true],
    ['BRANCH_LEAD', 'reports:circulation:read', true],
    ['BRANCH_LEAD', 'shift:read:all', true],
    ['BRANCH_LEAD', 'shift:end:any', true],
    ['BRANCH_LEAD', 'shift:manage:own', false],
    ['BRANCH_LEAD', 'loans:waive', false],
    ['BRANCH_LEAD', 'config:write', false],
    ['BRANCH_LEAD', 'team:manage', false],
    // CLERK
    ['CLERK', 'titles:read:all', true],
    ['CLERK', 'loans:create', true],
    ['CLERK', 'shift:manage:own', true],
    ['CLERK', 'shift:end:any', false],
    ['CLERK', 'desk:open', false],
    ['CLERK', 'copies:read', false],
    // CONSERVATOR
    ['CONSERVATOR', 'repairs:update', true],
    ['CONSERVATOR', 'shift:manage:own', true],
    ['CONSERVATOR', 'shift:read:all', false],
    ['CONSERVATOR', 'loans:create', false],
    // TREASURER
    ['TREASURER', 'loans:waive', true],
    ['TREASURER', 'budget:manage', true],
    ['TREASURER', 'titles:write', false],
    // SELECTOR
    ['SELECTOR', 'acquisitions:write', true],
    ['SELECTOR', 'acquisitions:approve', false],
    // NETWORK_OPS (wildcard)
    ['NETWORK_OPS', 'config:write', true],
    ['NETWORK_OPS', 'loans:waive', true],
  ];

  for (const [role, permission, expected] of cases) {
    it(`${role} ${expected ? 'has' : 'lacks'} ${permission}`, () => {
      const result = canWith(
        [assign(role, TENANT_A)],
        permission,
        TENANT_A,
        ctx,
      );
      expect(result).toBe(expected);
    });
  }
});

describe('canWith — scope enforcement', () => {
  it('denies when the assignment is for a different scope', () => {
    expect(
      canWith([assign('DIRECTOR', TENANT_A)], 'titles:read:all', TENANT_B, ctx),
    ).toBe(false);
  });

  it('a GLOBAL-scope assignment satisfies any requested scope', () => {
    const global = [assign('NETWORK_OPS', 'GLOBAL')];
    expect(canWith(global, 'config:write', TENANT_A, ctx)).toBe(true);
    expect(canWith(global, 'loans:waive', TENANT_B, ctx)).toBe(true);
  });
});

describe('canWith — scope parent-walk (chains)', () => {
  // org -> branch hierarchy. branch-1 and branch-2 belong to org-1.
  const parents: Record<string, string | null> = {
    'branch-1': 'org-1',
    'branch-2': 'org-1',
    'org-1': null,
  };
  const chainCtx: CanContext = {
    ...ctx,
    scopeParent: (s) => parents[s] ?? null,
  };

  it('an org-scoped grant reaches a child branch', () => {
    expect(
      canWith([assign('DIRECTOR', 'org-1')], 'config:write', 'branch-1', chainCtx),
    ).toBe(true);
  });

  it('a child-scoped grant does NOT reach the parent org', () => {
    expect(
      canWith([assign('DIRECTOR', 'branch-1')], 'config:write', 'org-1', chainCtx),
    ).toBe(false);
  });

  it('a child-scoped grant does NOT reach a sibling branch', () => {
    expect(
      canWith(
        [assign('DIRECTOR', 'branch-1')],
        'config:write',
        'branch-2',
        chainCtx,
      ),
    ).toBe(false);
  });

  it('cycle-guards a malformed parent chain without looping', () => {
    const cyclic: CanContext = {
      ...ctx,
      scopeParent: (s) => (s === 'a' ? 'b' : 'a'),
    };
    expect(
      canWith([assign('DIRECTOR', 'z')], 'config:write', 'a', cyclic),
    ).toBe(false);
  });
});

describe('canWith — ABAC caveats', () => {
  // A custom role granting refunds only for amounts under 100.
  const roles: RoleDef[] = [
    {
      name: 'JUNIOR_FINANCE',
      permissions: [
        {
          permission: 'loans:waive',
          caveat: (c) =>
            typeof c.amount === 'number' && (c.amount as number) < 100,
        },
      ],
    },
  ];
  const caveatCtx = (context?: Record<string, unknown>): CanContext => ({
    roleIndex: buildRoleIndex(roles),
    globalScope: 'GLOBAL',
    allPermissions: ['loans:waive'],
    context,
  });

  it('grants when the caveat passes (amount under threshold)', () => {
    expect(
      canWith([assign('JUNIOR_FINANCE', TENANT_A)], 'loans:waive', TENANT_A, caveatCtx({ amount: 50 })),
    ).toBe(true);
  });

  it('denies when the caveat fails (amount over threshold)', () => {
    expect(
      canWith([assign('JUNIOR_FINANCE', TENANT_A)], 'loans:waive', TENANT_A, caveatCtx({ amount: 500 })),
    ).toBe(false);
  });

  it('denies when context is missing (never silent-allow)', () => {
    expect(
      canWith([assign('JUNIOR_FINANCE', TENANT_A)], 'loans:waive', TENANT_A, caveatCtx()),
    ).toBe(false);
  });
});

describe('canWith — deny by default & unknown roles', () => {
  it('denies with empty assignments', () => {
    expect(canWith([], 'titles:read:all', TENANT_A, ctx)).toBe(false);
  });

  it('ignores unknown role names (deny, no throw)', () => {
    expect(() =>
      canWith([assign('NOPE', TENANT_A)], 'titles:read:all', TENANT_A, ctx),
    ).not.toThrow();
    expect(
      canWith([assign('NOPE', TENANT_A)], 'titles:read:all', TENANT_A, ctx),
    ).toBe(false);
  });

  it('a wildcard role grants any permission string', () => {
    expect(canWith([assign('DIRECTOR', TENANT_A)], 'made:up', TENANT_A, ctx)).toBe(
      true,
    );
    expect(
      canWith([assign('CLERK', TENANT_A)], 'made:up', TENANT_A, ctx),
    ).toBe(false);
  });
});

describe('canWith — multi-scope actor', () => {
  const assignments = [assign('DIRECTOR', TENANT_A), assign('CLERK', TENANT_B)];

  it('grants owner permissions only in tenant A', () => {
    expect(canWith(assignments, 'config:write', TENANT_A, ctx)).toBe(true);
    expect(canWith(assignments, 'config:write', TENANT_B, ctx)).toBe(false);
  });

  it('grants waiter permissions only in tenant B', () => {
    expect(canWith(assignments, 'loans:create', TENANT_B, ctx)).toBe(true);
    // loans:create is also in DIRECTOR wildcard for tenant A
    expect(canWith(assignments, 'loans:create', TENANT_A, ctx)).toBe(true);
    // desk:open is waiter-denied; tenant B has only waiter
    expect(canWith(assignments, 'desk:open', TENANT_B, ctx)).toBe(false);
  });
});

describe('canWith / permissionsFor — inline custom-role permissions (FUT-146)', () => {
  // A DB-defined custom role: its NAME is not in the template index, so without
  // inline permissions it would grant nothing. `permissions` makes it actually grant.
  const custom = (
    permissions: RoleAssignment['permissions'],
    scope = TENANT_A,
  ): RoleAssignment => ({ role: 'CUSTOM_TENANT_ROLE', scope, permissions });

  it('grants exactly the inline permissions (name absent from the template index)', () => {
    const a = [custom(['titles:read:all', 'copies:read'])];
    expect(canWith(a, 'titles:read:all', TENANT_A, ctx)).toBe(true);
    expect(canWith(a, 'copies:read', TENANT_A, ctx)).toBe(true);
    // Nothing beyond the inline set — no accidental escalation.
    expect(canWith(a, 'copies:move', TENANT_A, ctx)).toBe(false);
    expect(canWith(a, 'config:write', TENANT_A, ctx)).toBe(false);
  });

  it('proves the fix: the SAME role name grants nothing without inline permissions', () => {
    // Backward-compat / deny-by-default: an unknown name + no permissions = zero.
    expect(
      canWith([assign('CUSTOM_TENANT_ROLE', TENANT_A)], 'titles:read:all', TENANT_A, ctx),
    ).toBe(false);
  });

  it("honours a wildcard ('*') inline permission set", () => {
    const a = [custom('*')];
    expect(canWith(a, 'config:write', TENANT_A, ctx)).toBe(true);
    expect(canWith(a, 'made:up', TENANT_A, ctx)).toBe(true);
  });

  it('applies caveats on an inline permission entry', () => {
    const a = [
      custom([
        {
          permission: 'loans:waive',
          caveat: (c) => typeof c.amount === 'number' && (c.amount as number) < 100,
        },
      ]),
    ];
    expect(canWith(a, 'loans:waive', TENANT_A, { ...ctx, context: { amount: 50 } })).toBe(true);
    expect(canWith(a, 'loans:waive', TENANT_A, { ...ctx, context: { amount: 500 } })).toBe(false);
  });

  it('still enforces scope for an inline custom role', () => {
    const a = [custom(['titles:read:all'])];
    expect(canWith(a, 'titles:read:all', TENANT_B, ctx)).toBe(false);
  });

  it('permissionsFor returns exactly the inline set', () => {
    const perms = permissionsFor([custom(['titles:read:all', 'copies:read'])], TENANT_A, ctx);
    expect([...perms].sort()).toEqual(['copies:read', 'titles:read:all']);
  });

  it('permissionsFor returns the full registry for a wildcard inline role', () => {
    const perms = permissionsFor([custom('*')], TENANT_A, ctx);
    expect(perms.size).toBe(ctx.allPermissions.length);
  });

  it('unions an inline custom role with a template role in the same scope', () => {
    const perms = permissionsFor(
      [assign('CONSERVATOR', TENANT_A), custom(['acquisitions:write'])],
      TENANT_A,
      ctx,
    );
    expect(perms.has('repairs:update')).toBe(true); // template CONSERVATOR
    expect(perms.has('acquisitions:write')).toBe(true); // inline custom
  });
});

describe('permissionsFor', () => {
  it('returns the union for a concrete role', () => {
    const perms = permissionsFor([assign('CONSERVATOR', TENANT_A)], TENANT_A, ctx);
    expect([...perms].sort()).toEqual([
      // FUT-354's shape: the staff-safe config read — an operational flag a
      // bench worker must be able to resolve without holding `config:read`.
      'authors:read',
      'config:read:operational',
      'copies:read',
      'repairs:read:bench',
      'repairs:update',
      'shift:manage:own',
      'titles:read:all',
    ]);
  });

  it('returns the full registry list for a wildcard role', () => {
    const perms = permissionsFor([assign('DIRECTOR', TENANT_A)], TENANT_A, ctx);
    expect(perms.size).toBe(ctx.allPermissions.length);
    expect(perms.has('loans:waive')).toBe(true);
  });

  it('returns empty for out-of-scope assignments', () => {
    const perms = permissionsFor([assign('DIRECTOR', TENANT_A)], TENANT_B, ctx);
    expect(perms.size).toBe(0);
  });

  it('unions multiple roles in the same scope', () => {
    const perms = permissionsFor(
      [assign('SELECTOR', TENANT_A), assign('CONSERVATOR', TENANT_A)],
      TENANT_A,
      ctx,
    );
    expect(perms.has('acquisitions:write')).toBe(true); // buyer
    expect(perms.has('repairs:update')).toBe(true); // chef
  });
});
