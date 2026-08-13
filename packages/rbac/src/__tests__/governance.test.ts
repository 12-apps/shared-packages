import { describe, it, expect } from 'vitest';
import { validateGrant, type GovernanceCatalog } from '../governance';
import { definePermissions } from '../core/registry';
import type { RoleDef } from '../core/types';
import { DEMO_CATALOG } from './demo-catalog';

const leaf = { isLeaf: true };
const org = { isLeaf: false };

// A compact catalog for focused unit tests.
const perms = definePermissions({
  'a:write': 'class',
  'a:approve': 'class',
  'x:read:own': 'instance',
  'y:write': 'class',
  'danger': 'class',
} as const);

const roles: RoleDef[] = [
  { name: 'DIRECTOR', permissions: '*' },
  { name: 'A_WRITER', permissions: ['a:write'] },
  { name: 'A_BOTH', permissions: ['a:write', 'a:approve'] },
  { name: 'INSTANCE', permissions: ['x:read:own'] },
  { name: 'LEAFY', permissions: ['y:write'] },
  { name: 'DANGER', permissions: ['danger'] },
];

const catalog: GovernanceCatalog = {
  permissions: perms,
  roles,
  ownerRoles: ['DIRECTOR'],
  ownerPermissions: ['danger'],
  leafOnlyRoles: ['LEAFY'],
  sodPairs: [['a:write', 'a:approve']],
};

describe('validateGrant — happy path', () => {
  it('allows granting a role whose perms the granter holds, at a leaf scope', () => {
    expect(
      validateGrant({
        granterPermissions: ['a:write'],
        roleBeingGranted: 'A_WRITER',
        targetScope: leaf,
        catalog,
      }),
    ).toEqual({ ok: true });
  });

  it('a wildcard granter may grant any (non-owner) role', () => {
    expect(
      validateGrant({
        granterPermissions: ['*'],
        roleBeingGranted: 'A_WRITER',
        targetScope: leaf,
        catalog,
      }).ok,
    ).toBe(true);
  });
});

describe('validateGrant — escalation guard', () => {
  it('rejects granting a permission the granter lacks', () => {
    const r = validateGrant({
      granterPermissions: ['y:write'],
      roleBeingGranted: 'A_WRITER',
      targetScope: leaf,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^ESCALATION/);
  });
});

describe('validateGrant — owner-protection', () => {
  it('rejects granting an owner role', () => {
    const r = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: 'DIRECTOR',
      targetScope: leaf,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });

  it('rejects an inline wildcard custom role', () => {
    const r = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: { name: 'CUSTOM', permissions: '*' },
      targetScope: leaf,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });

  it('rejects an INLINE custom role carrying an owner-marker permission', () => {
    // The owner-marker guard vets custom/inline roles (a named catalog template
    // that legitimately holds a marker is exempt — see the Future Pay catalog block).
    const r = validateGrant({
      granterPermissions: ['danger'],
      roleBeingGranted: { name: 'DANGER', permissions: ['danger'] },
      targetScope: leaf,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });
});

describe('validateGrant — scope ceiling', () => {
  it('rejects a leaf-only role at an org scope', () => {
    const r = validateGrant({
      granterPermissions: ['y:write'],
      roleBeingGranted: 'LEAFY',
      targetScope: org,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^SCOPE_CEILING/);
  });

  it('allows the same leaf-only role at a leaf scope', () => {
    expect(
      validateGrant({
        granterPermissions: ['y:write'],
        roleBeingGranted: 'LEAFY',
        targetScope: leaf,
        catalog,
      }).ok,
    ).toBe(true);
  });

  it('rejects a role with an instance permission at an org scope', () => {
    const r = validateGrant({
      granterPermissions: ['x:read:own'],
      roleBeingGranted: 'INSTANCE',
      targetScope: org,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^SCOPE_CEILING/);
  });
});

describe('validateGrant — separation of duties', () => {
  it('rejects an INLINE custom role holding both halves of a SoD pair', () => {
    // SoD is a composition guard for custom/inline roles; named templates are exempt.
    const r = validateGrant({
      granterPermissions: ['a:write', 'a:approve'],
      roleBeingGranted: { name: 'A_BOTH', permissions: ['a:write', 'a:approve'] },
      targetScope: leaf,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^SEPARATION_OF_DUTIES/);
  });
});

describe('validateGrant — unknown role', () => {
  it('rejects an unknown role name', () => {
    const r = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: 'GHOST',
      targetScope: leaf,
      catalog,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^UNKNOWN_ROLE/);
  });
});

describe('validateGrant — the demo host’s composed governance catalog', () => {
  it('rejects the real purchasing SoD pair in a custom role', () => {
    const r = validateGrant({
      granterPermissions: DEMO_CATALOG.permissions.list,
      roleBeingGranted: {
        name: 'ROGUE_BUYER',
        permissions: ['acquisitions:write', 'acquisitions:approve'],
      },
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^SEPARATION_OF_DUTIES/);
  });

  it('rejects assigning BRANCH_LEAD (leaf-only) at an org scope', () => {
    const r = validateGrant({
      granterPermissions: DEMO_CATALOG.permissions.list,
      roleBeingGranted: 'BRANCH_LEAD',
      targetScope: org,
      catalog: DEMO_CATALOG.governance,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^SCOPE_CEILING/);
  });

  it('allows a real template role (SELECTOR) at a leaf scope for a full-power granter', () => {
    // SELECTOR holds purchasing:read:own (instance) so it is leaf-scoped; at leaf it is fine.
    const buyer = DEMO_CATALOG.roleTemplates.find((r) => r.name === 'SELECTOR')!;
    expect(
      validateGrant({
        granterPermissions: DEMO_CATALOG.permissions.list,
        roleBeingGranted: buyer,
        targetScope: leaf,
        catalog: DEMO_CATALOG.governance,
      }).ok,
    ).toBe(true);
  });

  // Regression (Greptile review, PR #130): a NAMED catalog role that legitimately
  // holds an owner-marker permission must remain grantable — owner-protection for a
  // named template comes solely from `ownerRoles`, not from its permission contents.
  it('allows granting the named HEAD_LIBRARIAN template (holds owner-marker roles:manage)', () => {
    expect(
      validateGrant({
        granterPermissions: DEMO_CATALOG.permissions.list,
        roleBeingGranted: 'HEAD_LIBRARIAN',
        targetScope: leaf,
        catalog: DEMO_CATALOG.governance,
      }).ok,
    ).toBe(true);
  });

  it('allows granting the named TREASURER template (holds owner-marker budget:manage)', () => {
    expect(
      validateGrant({
        granterPermissions: DEMO_CATALOG.permissions.list,
        roleBeingGranted: 'TREASURER',
        targetScope: leaf,
        catalog: DEMO_CATALOG.governance,
      }).ok,
    ).toBe(true);
  });

  it('still rejects an INLINE custom role that smuggles an owner-marker permission', () => {
    const r = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: {
        name: 'SNEAKY',
        permissions: ['titles:read:all', 'roles:manage'],
      },
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });

  it('still rejects the named DIRECTOR role via ownerRoles', () => {
    const r = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: 'DIRECTOR',
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });

  it('still rejects the named NETWORK_OPS role via ownerRoles', () => {
    const r = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: 'NETWORK_OPS',
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });
});

// FUT-217: a per-tenant template override is a CURATED role being re-tuned (inline
// perms, but `curatedTemplate: true`). Like a named catalog role it is exempt from
// the owner-marker + SoD composition guards, but escalation and scope-ceiling — and
// owner-role protection — still bite.
describe('validateGrant — curated template override (FUT-217)', () => {
  const adminBaseline = DEMO_CATALOG.roleTemplates.find((r) => r.name === 'HEAD_LIBRARIAN')!
    .permissions as readonly string[];

  it("preserves HEAD_LIBRARIAN's intrinsic owner-markers when a full-power actor edits it", () => {
    // The edited set still carries roles:manage + budget:manage (owner-markers) and
    // the acquisitions:write/approve SoD pair — a curated template keeps both.
    expect(
      validateGrant({
        granterPermissions: DEMO_CATALOG.permissions.list,
        roleBeingGranted: { name: 'HEAD_LIBRARIAN', permissions: adminBaseline },
        targetScope: leaf,
        catalog: DEMO_CATALOG.governance,
        curatedTemplate: true,
      }).ok,
    ).toBe(true);
  });

  it('rejects editing a template into an ESCALATION (a permission the actor lacks)', () => {
    // An actor holding only titles:read:all tries to override BRANCH_LEAD while adding
    // a permission (loans:waive) they do not themselves hold → escalation.
    const r = validateGrant({
      granterPermissions: ['titles:read:all'],
      roleBeingGranted: {
        name: 'BRANCH_LEAD',
        permissions: ['titles:read:all', 'loans:waive'],
      },
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
      curatedTemplate: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^ESCALATION/);
  });

  it('rejects overriding an owner role (DIRECTOR) even in curated mode', () => {
    const r = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: { name: 'DIRECTOR', permissions: ['titles:read:all'] },
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
      curatedTemplate: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });

  it('still enforces the scope-ceiling on a curated template at an org scope', () => {
    // BRANCH_LEAD is leaf-only; a curated override does not lift that ceiling.
    const r = validateGrant({
      granterPermissions: DEMO_CATALOG.permissions.list,
      roleBeingGranted: { name: 'BRANCH_LEAD', permissions: ['titles:read:all'] },
      targetScope: org,
      catalog: DEMO_CATALOG.governance,
      curatedTemplate: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^SCOPE_CEILING/);
  });

  it('WITHOUT the curated flag the same owner-marker edit is rejected (composition guard)', () => {
    // Proves the flag is what exempts markers: the identical inline role, treated as
    // a freshly-composed custom role, trips OWNER_PROTECTED on the owner-marker.
    const r = validateGrant({
      granterPermissions: DEMO_CATALOG.permissions.list,
      roleBeingGranted: { name: 'HEAD_LIBRARIAN', permissions: adminBaseline },
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^OWNER_PROTECTED/);
  });

  const managerBaseline = DEMO_CATALOG.roleTemplates.find((r) => r.name === 'BRANCH_LEAD')!
    .permissions as readonly string[];

  it('rejects INJECTING an owner-marker absent from the seed into an editable template', () => {
    // The curated exemption preserves a seed's INTRINSIC markers — it must not let an
    // actor ADD one the seed never had. A full-power granter (holds budget:manage,
    // so escalation would pass) overrides BRANCH_LEAD with the seed set PLUS budget:manage.
    // BRANCH_LEAD's seed has no owner-marker, so this is composing new owner-level power and
    // must be blocked by owner-protection, NOT merely by escalation.
    const r = validateGrant({
      granterPermissions: DEMO_CATALOG.permissions.list,
      roleBeingGranted: {
        name: 'BRANCH_LEAD',
        permissions: [...managerBaseline, 'budget:manage'],
      },
      targetScope: leaf,
      catalog: DEMO_CATALOG.governance,
      curatedTemplate: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/^OWNER_PROTECTED/);
      expect(r.reason).toContain('budget:manage');
    }
  });

  it('allows an edit to BRANCH_LEAD that stays within its (marker-free) seed', () => {
    // Guards against over-blocking: trimming BRANCH_LEAD (no marker added) is still fine.
    expect(
      validateGrant({
        granterPermissions: DEMO_CATALOG.permissions.list,
        roleBeingGranted: {
          name: 'BRANCH_LEAD',
          permissions: ['titles:read:all', 'loans:read:all'],
        },
        targetScope: leaf,
        catalog: DEMO_CATALOG.governance,
        curatedTemplate: true,
      }).ok,
    ).toBe(true);
  });
});
