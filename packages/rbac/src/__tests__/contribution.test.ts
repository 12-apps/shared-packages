import { describe, expect, it } from 'vitest';

import {
  composePermissions,
  RbacCatalogError,
  type ComposedPermissions,
} from '../core/compose';
import { definePermissionContribution } from '../core/contribution';
import { DEFAULT_GATE_PERMISSIONS } from '../server/context';
import { RBAC_PERMISSIONS } from '../permissions';

/**
 * COMPOSITION — the seam that replaced this package owning an application's
 * catalog (12-13 follow-up).
 *
 * The claims under test are the ones a host cannot verify for itself once the
 * catalog is spread across N owners: that an id arrives with its scope-kind
 * attached, that two owners claiming one id is a LOUD failure rather than a
 * silent overwrite, and that a separation-of-duties pair may span sources.
 */

const LIFECYCLE = definePermissionContribution({
  source: '@demo/lifecycle',
  permissions: {
    'posts:approve': { kind: 'class', separateFrom: ['posts:write'] },
  },
  labels: { actions: { approve: 'Aprovar' } },
});

const DOMAIN = definePermissionContribution({
  source: 'demo-host',
  permissions: {
    'posts:write': { kind: 'class' },
    'posts:read:own': { kind: 'instance', label: 'Ver os seus' },
    'money:move': { kind: 'class', ownerMarker: true },
  },
  labels: {
    domains: { posts: 'Publicações', money: 'Dinheiro' },
    actions: { write: 'Editar', move: 'Movimentar' },
    scopes: { own: 'próprios' },
  },
});

describe('composePermissions — assembling one catalog from many owners', () => {
  it('unions every source, in contribution order, and remembers who owns what', () => {
    const composed = composePermissions(RBAC_PERMISSIONS, LIFECYCLE, DOMAIN);

    expect(composed.ids).toEqual([
      'roles:manage',
      'team:read',
      'team:manage',
      'posts:approve',
      'posts:write',
      'posts:read:own',
      'money:move',
    ]);
    expect(composed.sourceOf('roles:manage')).toBe('@12-apps/rbac');
    expect(composed.sourceOf('posts:approve')).toBe('@demo/lifecycle');
    expect(composed.sourceOf('money:move')).toBe('demo-host');
    expect(composed.sourceOf('nothing:here')).toBeUndefined();
  });

  it('carries each id\'s scope-kind through composition', () => {
    // The half-wiring this contribution shape exists to prevent: an id that
    // arrives without its kind resolves to `class` and SKIPS the entity gate,
    // so `posts:read:own` would silently grant every post.
    const composed = composePermissions(LIFECYCLE, DOMAIN);
    expect(composed.permissions.kind('posts:read:own')).toBe('instance');
    expect(composed.permissions.kind('posts:write')).toBe('class');
    expect(composed.permissions.has('posts:write')).toBe(true);
    expect(composed.permissions.has('posts:destroy')).toBe(false);
  });

  it('collects owner markers from every source', () => {
    const composed = composePermissions(RBAC_PERMISSIONS, DOMAIN);
    expect(composed.ownerPermissions).toEqual(['roles:manage', 'money:move']);
  });
});

describe('composePermissions — collisions fail loudly', () => {
  const IMPOSTOR = definePermissionContribution({
    source: 'impostor',
    // Same id, WEAKER kind: last-write-wins would downgrade an instance
    // permission to class and open every row it was gating.
    permissions: { 'posts:read:own': { kind: 'class' } },
  });

  it('refuses two sources claiming the same id, naming both', () => {
    expect(() => composePermissions(DOMAIN, IMPOSTOR)).toThrow(RbacCatalogError);
    try {
      composePermissions(DOMAIN, IMPOSTOR);
      expect.unreachable('composition must not accept a duplicated id');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('PERMISSION_COLLISION');
      expect(failure.message).toContain('posts:read:own');
      expect(failure.message).toContain('demo-host');
      expect(failure.message).toContain('impostor');
    }
  });

  it('refuses in either order — there is no "later source wins"', () => {
    expect(() => composePermissions(IMPOSTOR, DOMAIN)).toThrow(RbacCatalogError);
  });
});

describe('composePermissions — separation of duties spans sources', () => {
  it('pairs a counterpart declared by another owner', () => {
    // `@demo/lifecycle` owns the approval surface and knows the pair; the
    // write id belongs to the host's domain and is validated against the
    // whole assembled catalog, not against the declaring source's own map.
    const composed = composePermissions(LIFECYCLE, DOMAIN);
    expect(composed.sodPairs).toEqual([['posts:approve', 'posts:write']]);
  });

  it('derives ONE pair when both sides declare each other', () => {
    const mirrored = definePermissionContribution({
      source: 'mirror',
      permissions: {
        'a:write': { kind: 'class', separateFrom: ['a:approve'] },
        'a:approve': { kind: 'class', separateFrom: ['a:write'] },
      },
    });
    expect(composePermissions(mirrored).sodPairs).toEqual([['a:write', 'a:approve']]);
  });

  it('refuses a counterpart nothing contributes', () => {
    // Composing the lifecycle source ALONE leaves `posts:write` undeclared —
    // a dangling pair would validate nothing and read as if it did.
    try {
      composePermissions(LIFECYCLE);
      expect.unreachable('a dangling SoD counterpart must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('UNKNOWN_PERMISSION');
      expect(failure.message).toContain('posts:write');
      expect(failure.message).toContain('@demo/lifecycle');
    }
  });
});

describe('composePermissions — labels travel with the ids they label', () => {
  it('merges each source\'s segment words and its per-id overrides', () => {
    const composed = composePermissions(RBAC_PERMISSIONS, LIFECYCLE, DOMAIN);
    expect(composed.labels.domains).toMatchObject({
      roles: 'Papéis',
      posts: 'Publicações',
    });
    expect(composed.labels.actions).toMatchObject({
      manage: 'Gerenciar',
      approve: 'Aprovar',
    });
    expect(composed.labels.permissions).toEqual({ 'posts:read:own': 'Ver os seus' });
  });
});

/** A factory, not a shared instance — each case composes its own. */
const composeAll = () => composePermissions(RBAC_PERMISSIONS, LIFECYCLE, DOMAIN);
const ROLES = [
  { name: 'OWNER', permissions: '*' as const, description: 'Everything.' },
  { name: 'EDITOR', permissions: ['posts:write'] as const, description: 'Writes.' },
  { name: 'PLATFORM', permissions: '*' as const, description: 'Platform only.' },
];

describe('withRoles — binding the host\'s role policy', () => {
  it('produces the governance catalog from both halves', () => {
    const catalog = composeAll().withRoles({
      roles: ROLES,
      ownerRoles: ['OWNER', 'PLATFORM'],
      leafOnlyRoles: ['EDITOR'],
      platformOnlyRoles: ['PLATFORM'],
      roleLabels: { EDITOR: 'Editor' },
    });

    // The permission half comes from the sources, the role half from the host.
    expect(catalog.governance.ownerPermissions).toEqual(['roles:manage', 'money:move']);
    expect(catalog.governance.sodPairs).toEqual([['posts:approve', 'posts:write']]);
    expect(catalog.governance.leafOnlyRoles).toEqual(['EDITOR']);
    expect(catalog.governance.roles).toBe(ROLES);
    expect(catalog.labels.roles).toEqual({ EDITOR: 'Editor' });
  });

  it('projects the seed rows, skipping platform-only and locking owners', () => {
    const catalog = composeAll().withRoles({
      roles: ROLES,
      ownerRoles: ['OWNER', 'PLATFORM'],
      platformOnlyRoles: ['PLATFORM'],
    });
    expect(catalog.tenantRoleSeeds).toEqual([
      { name: 'OWNER', permissions: '*', description: 'Everything.', kind: 'SYSTEM', locked: true },
      {
        name: 'EDITOR',
        permissions: JSON.stringify(['posts:write']),
        description: 'Writes.',
        kind: 'SYSTEM',
        locked: false,
      },
    ]);
  });

  it('refuses a policy naming a role that is not a template', () => {
    try {
      composeAll().withRoles({ roles: ROLES, ownerRoles: ['OWNR'] });
      expect.unreachable('a typo\'d owner role must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('UNKNOWN_ROLE');
      expect(failure.message).toContain('OWNR');
    }
  });

  it('refuses a role granting an id nothing contributes', () => {
    // The runtime half of the typed union. Widening to `ComposedPermissions<
    // string>` is how a role matrix reaches `withRoles` without the generic
    // ever seeing it — a seed parsed from JSON, or a JS host. The compile-time
    // half is proved in `unknown-permission.typecheck.test.ts`; this is what
    // catches the same mistake when the checker was never consulted.
    const untyped: ComposedPermissions<string> = composeAll();
    try {
      untyped.withRoles({
        roles: [{ name: 'GHOST', permissions: ['posts:publish'] }],
        ownerRoles: [],
      });
      expect.unreachable('an off-catalog role permission must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('UNKNOWN_PERMISSION');
      expect(failure.message).toContain('posts:publish');
      expect(failure.message).toContain('GHOST');
    }
  });
});

describe('this package\'s own contribution', () => {
  it('declares exactly the ids gating its own screens and endpoints', () => {
    expect(RBAC_PERMISSIONS.source).toBe('@12-apps/rbac');
    expect([...RBAC_PERMISSIONS.ids].sort()).toEqual(
      [
        DEFAULT_GATE_PERMISSIONS.manageRoles,
        DEFAULT_GATE_PERMISSIONS.readTeam,
        DEFAULT_GATE_PERMISSIONS.manageTeam,
      ].sort(),
    );
  });

  it('marks role administration as owner-level and nothing else', () => {
    // A role that hands out permissions is the one grant in this package that
    // WIDENS, so it is the one that may not be composed into a custom role.
    expect(composePermissions(RBAC_PERMISSIONS).ownerPermissions).toEqual([
      'roles:manage',
    ]);
  });
});
