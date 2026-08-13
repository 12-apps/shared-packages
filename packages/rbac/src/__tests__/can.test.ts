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
    // OWNER (wildcard)
    ['OWNER', 'products:read:all', true],
    ['OWNER', 'orders:refund', true],
    ['OWNER', 'config:write', true],
    // MANAGER
    ['MANAGER', 'products:write', true],
    ['MANAGER', 'stock:move', true],
    ['MANAGER', 'reports:sales:read', true],
    ['MANAGER', 'shift:read:all', true],
    ['MANAGER', 'shift:end:any', true],
    ['MANAGER', 'shift:manage:own', false],
    ['MANAGER', 'orders:refund', false],
    ['MANAGER', 'config:write', false],
    ['MANAGER', 'team:manage', false],
    // WAITER
    ['WAITER', 'products:read:all', true],
    ['WAITER', 'orders:create', true],
    ['WAITER', 'shift:manage:own', true],
    ['WAITER', 'shift:end:any', false],
    ['WAITER', 'till:open', false],
    ['WAITER', 'stock:read', false],
    // CHEF
    ['CHEF', 'kitchen:update', true],
    ['CHEF', 'shift:manage:own', true],
    ['CHEF', 'shift:read:all', false],
    ['CHEF', 'orders:create', false],
    // FINANCIAL
    ['FINANCIAL', 'orders:refund', true],
    ['FINANCIAL', 'payouts:manage', true],
    ['FINANCIAL', 'products:write', false],
    // BUYER
    ['BUYER', 'purchasing:write', true],
    ['BUYER', 'purchasing:approve', false],
    // SUPERADMIN (wildcard)
    ['SUPERADMIN', 'config:write', true],
    ['SUPERADMIN', 'orders:refund', true],
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
      canWith([assign('OWNER', TENANT_A)], 'products:read:all', TENANT_B, ctx),
    ).toBe(false);
  });

  it('a GLOBAL-scope assignment satisfies any requested scope', () => {
    const global = [assign('SUPERADMIN', 'GLOBAL')];
    expect(canWith(global, 'config:write', TENANT_A, ctx)).toBe(true);
    expect(canWith(global, 'orders:refund', TENANT_B, ctx)).toBe(true);
  });
});

describe('canWith — scope parent-walk (chains)', () => {
  // org -> restaurant hierarchy. restaurant-1 and restaurant-2 belong to org-1.
  const parents: Record<string, string | null> = {
    'restaurant-1': 'org-1',
    'restaurant-2': 'org-1',
    'org-1': null,
  };
  const chainCtx: CanContext = {
    ...ctx,
    scopeParent: (s) => parents[s] ?? null,
  };

  it('an org-scoped grant reaches a child restaurant', () => {
    expect(
      canWith([assign('OWNER', 'org-1')], 'config:write', 'restaurant-1', chainCtx),
    ).toBe(true);
  });

  it('a child-scoped grant does NOT reach the parent org', () => {
    expect(
      canWith([assign('OWNER', 'restaurant-1')], 'config:write', 'org-1', chainCtx),
    ).toBe(false);
  });

  it('a child-scoped grant does NOT reach a sibling restaurant', () => {
    expect(
      canWith(
        [assign('OWNER', 'restaurant-1')],
        'config:write',
        'restaurant-2',
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
      canWith([assign('OWNER', 'z')], 'config:write', 'a', cyclic),
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
          permission: 'orders:refund',
          caveat: (c) =>
            typeof c.amount === 'number' && (c.amount as number) < 100,
        },
      ],
    },
  ];
  const caveatCtx = (context?: Record<string, unknown>): CanContext => ({
    roleIndex: buildRoleIndex(roles),
    globalScope: 'GLOBAL',
    allPermissions: ['orders:refund'],
    context,
  });

  it('grants when the caveat passes (amount under threshold)', () => {
    expect(
      canWith([assign('JUNIOR_FINANCE', TENANT_A)], 'orders:refund', TENANT_A, caveatCtx({ amount: 50 })),
    ).toBe(true);
  });

  it('denies when the caveat fails (amount over threshold)', () => {
    expect(
      canWith([assign('JUNIOR_FINANCE', TENANT_A)], 'orders:refund', TENANT_A, caveatCtx({ amount: 500 })),
    ).toBe(false);
  });

  it('denies when context is missing (never silent-allow)', () => {
    expect(
      canWith([assign('JUNIOR_FINANCE', TENANT_A)], 'orders:refund', TENANT_A, caveatCtx()),
    ).toBe(false);
  });
});

describe('canWith — deny by default & unknown roles', () => {
  it('denies with empty assignments', () => {
    expect(canWith([], 'products:read:all', TENANT_A, ctx)).toBe(false);
  });

  it('ignores unknown role names (deny, no throw)', () => {
    expect(() =>
      canWith([assign('NOPE', TENANT_A)], 'products:read:all', TENANT_A, ctx),
    ).not.toThrow();
    expect(
      canWith([assign('NOPE', TENANT_A)], 'products:read:all', TENANT_A, ctx),
    ).toBe(false);
  });

  it('a wildcard role grants any permission string', () => {
    expect(canWith([assign('OWNER', TENANT_A)], 'made:up', TENANT_A, ctx)).toBe(
      true,
    );
    expect(
      canWith([assign('WAITER', TENANT_A)], 'made:up', TENANT_A, ctx),
    ).toBe(false);
  });
});

describe('canWith — multi-scope actor', () => {
  const assignments = [assign('OWNER', TENANT_A), assign('WAITER', TENANT_B)];

  it('grants owner permissions only in tenant A', () => {
    expect(canWith(assignments, 'config:write', TENANT_A, ctx)).toBe(true);
    expect(canWith(assignments, 'config:write', TENANT_B, ctx)).toBe(false);
  });

  it('grants waiter permissions only in tenant B', () => {
    expect(canWith(assignments, 'orders:create', TENANT_B, ctx)).toBe(true);
    // orders:create is also in OWNER wildcard for tenant A
    expect(canWith(assignments, 'orders:create', TENANT_A, ctx)).toBe(true);
    // till:open is waiter-denied; tenant B has only waiter
    expect(canWith(assignments, 'till:open', TENANT_B, ctx)).toBe(false);
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
    const a = [custom(['products:read:all', 'stock:read'])];
    expect(canWith(a, 'products:read:all', TENANT_A, ctx)).toBe(true);
    expect(canWith(a, 'stock:read', TENANT_A, ctx)).toBe(true);
    // Nothing beyond the inline set — no accidental escalation.
    expect(canWith(a, 'stock:move', TENANT_A, ctx)).toBe(false);
    expect(canWith(a, 'config:write', TENANT_A, ctx)).toBe(false);
  });

  it('proves the fix: the SAME role name grants nothing without inline permissions', () => {
    // Backward-compat / deny-by-default: an unknown name + no permissions = zero.
    expect(
      canWith([assign('CUSTOM_TENANT_ROLE', TENANT_A)], 'products:read:all', TENANT_A, ctx),
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
          permission: 'orders:refund',
          caveat: (c) => typeof c.amount === 'number' && (c.amount as number) < 100,
        },
      ]),
    ];
    expect(canWith(a, 'orders:refund', TENANT_A, { ...ctx, context: { amount: 50 } })).toBe(true);
    expect(canWith(a, 'orders:refund', TENANT_A, { ...ctx, context: { amount: 500 } })).toBe(false);
  });

  it('still enforces scope for an inline custom role', () => {
    const a = [custom(['products:read:all'])];
    expect(canWith(a, 'products:read:all', TENANT_B, ctx)).toBe(false);
  });

  it('permissionsFor returns exactly the inline set', () => {
    const perms = permissionsFor([custom(['products:read:all', 'stock:read'])], TENANT_A, ctx);
    expect([...perms].sort()).toEqual(['products:read:all', 'stock:read']);
  });

  it('permissionsFor returns the full registry for a wildcard inline role', () => {
    const perms = permissionsFor([custom('*')], TENANT_A, ctx);
    expect(perms.size).toBe(ctx.allPermissions.length);
  });

  it('unions an inline custom role with a template role in the same scope', () => {
    const perms = permissionsFor(
      [assign('CHEF', TENANT_A), custom(['purchasing:write'])],
      TENANT_A,
      ctx,
    );
    expect(perms.has('kitchen:update')).toBe(true); // template CHEF
    expect(perms.has('purchasing:write')).toBe(true); // inline custom
  });
});

describe('permissionsFor', () => {
  it('returns the union for a concrete role', () => {
    const perms = permissionsFor([assign('CHEF', TENANT_A)], TENANT_A, ctx);
    expect([...perms].sort()).toEqual([
      // FUT-354: the staff-safe config read — Cozinha only exists in comanda
      // mode, and that is a config flag the cook must be able to resolve.
      'config:read:operational',
      'ingredients:read',
      'kitchen:read:station',
      'kitchen:update',
      'products:read:all',
      'shift:manage:own',
      'stock:read',
    ]);
  });

  it('returns the full registry list for a wildcard role', () => {
    const perms = permissionsFor([assign('OWNER', TENANT_A)], TENANT_A, ctx);
    expect(perms.size).toBe(ctx.allPermissions.length);
    expect(perms.has('orders:refund')).toBe(true);
  });

  it('returns empty for out-of-scope assignments', () => {
    const perms = permissionsFor([assign('OWNER', TENANT_A)], TENANT_B, ctx);
    expect(perms.size).toBe(0);
  });

  it('unions multiple roles in the same scope', () => {
    const perms = permissionsFor(
      [assign('BUYER', TENANT_A), assign('CHEF', TENANT_A)],
      TENANT_A,
      ctx,
    );
    expect(perms.has('purchasing:write')).toBe(true); // buyer
    expect(perms.has('kitchen:update')).toBe(true); // chef
  });
});
