import { describe, expect, it } from 'vitest';

import {
  composePermissions,
  RbacCatalogError,
  type ComposedPermissions,
} from '../core/compose';
import {
  definePermissionContribution,
  type PermissionSpec,
} from '../core/contribution';
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

describe('composePermissions — ids and specs must name the same set', () => {
  /**
   * `PermissionContribution` is a PUBLIC interface, so a source may hand over
   * an `ids` array it built itself rather than one derived from the map — the
   * shape the next planned consumer (a `lifecycleApprovalPermissions([...])`
   * factory) has. Both directions of the mismatch are refused, because both
   * fail OPEN if they are not.
   */
  it('refuses an id with no spec', () => {
    const missingSpec = {
      source: 'drifted',
      ids: ['a:read', 'a:write'] as const,
      permissions: { 'a:read': { kind: 'class' } } as const,
      labels: {},
    };
    try {
      composePermissions(missingSpec);
      expect.unreachable('an id with no spec must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('UNKNOWN_PERMISSION');
      expect(failure.message).toContain('a:write');
    }
  });

  it('refuses a spec left out of the ids — the direction that used to pass', () => {
    // Silently dropped, this loses the spec's `ownerMarker` (so an inline
    // custom role may bundle it) and its `separateFrom` (so the duty pair is
    // never derived). Both guards only ever REMOVE power, so their loss is
    // invisible at every later layer.
    const orphanSpec = {
      source: 'drifted',
      ids: ['a:read'] as const,
      permissions: {
        'a:read': { kind: 'class' },
        'a:pay': { kind: 'class', ownerMarker: true, separateFrom: ['a:read'] },
      } as const,
      labels: {},
    };
    try {
      composePermissions(orphanSpec);
      expect.unreachable('a spec missing from ids must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('UNKNOWN_PERMISSION');
      expect(failure.message).toContain('a:pay');
      expect(failure.message).toContain('drifted');
    }
  });
});

describe('composePermissions — a spec must actually declare what it claims', () => {
  /**
   * `PermissionSpec` makes `kind` required, but a catalog only ever passes
   * through the compiler ONCE — at the boundary where it is read. Assembly now
   * lives in the HOST, where a catalog is far likelier to be generated or
   * loaded than written as a literal, so the two shapes below both type-check
   * and both used to compose: an unset `kind` resolved to `'class'`, which
   * means RBAC alone decides and the entity gate never runs. An
   * instance-scoped id declared without its kind (`orders:read:own`,
   * `tables:read:assigned`) therefore granted class-wide access.
   */
  it('refuses a spec whose kind is missing — the config/JSON path', () => {
    const fromConfig = JSON.parse(
      '{"posts:read:own":{"ownerMarker":false}}',
    ) as Record<string, PermissionSpec>;
    const catalog = definePermissionContribution({
      source: 'config',
      permissions: fromConfig,
    });
    expect(() => composePermissions(catalog)).toThrow(RbacCatalogError);
    try {
      composePermissions(catalog);
      expect.unreachable('a spec with no kind must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('INVALID_PERMISSION_SPEC');
      expect(failure.message).toContain('posts:read:own');
      expect(failure.message).toContain('config');
      expect(failure.message).toContain('instance');
    }
  });

  it('refuses a spec whose kind is missing — the hand-built contribution', () => {
    const hand = {
      source: 'hand',
      ids: ['a:b'],
      permissions: { 'a:b': {} as PermissionSpec },
      labels: {},
    };
    expect(() => composePermissions(hand)).toThrow(RbacCatalogError);
    try {
      composePermissions(hand);
      expect.unreachable('a hand-built spec with no kind must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('INVALID_PERMISSION_SPEC');
      expect(failure.message).toContain('a:b');
      expect(failure.message).toContain('hand');
    }
  });

  it('refuses a kind that is neither class nor instance', () => {
    const typo = {
      source: 'typo',
      ids: ['a:b'],
      permissions: { 'a:b': { kind: 'Instance' } as unknown as PermissionSpec },
      labels: {},
    };
    expect(() => composePermissions(typo)).toThrow(RbacCatalogError);
    try {
      composePermissions(typo);
      expect.unreachable('a misspelt kind must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('INVALID_PERMISSION_SPEC');
      expect(failure.message).toContain('Instance');
    }
  });

  it('refuses an ownerMarker that is not a boolean', () => {
    // Owner markers are collected with `=== true`, so `"true"` — what a JSON
    // or env-shaped catalog writes — is NOT one: the id stays composable into
    // an inline custom role, which is the guard silently going away.
    const fromConfig = JSON.parse(
      '{"money:move":{"kind":"class","ownerMarker":"true"}}',
    ) as Record<string, PermissionSpec>;
    const compose = (): unknown =>
      composePermissions(
        definePermissionContribution({ source: 'config', permissions: fromConfig }),
      );
    expect(compose).toThrow(RbacCatalogError);
    try {
      compose();
      expect.unreachable('a non-boolean ownerMarker must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('INVALID_PERMISSION_SPEC');
      expect(failure.message).toContain('money:move');
      expect(failure.message).toContain('ownerMarker');
    }
  });

  it('refuses a separateFrom that is not a list of ids', () => {
    // `null` is what JSON writes for an absent list, and `?? []` reads it as
    // "declares no pair" — so the duty pair is never derived and `checkSoD`
    // never fires, for a spec that says on its face that it must.
    const fromConfig = JSON.parse(
      '{"posts:approve":{"kind":"class","separateFrom":null}}',
    ) as Record<string, PermissionSpec>;
    const compose = (): unknown =>
      composePermissions(
        definePermissionContribution({ source: 'config', permissions: fromConfig }),
      );
    expect(compose).toThrow(RbacCatalogError);
    try {
      compose();
      expect.unreachable('a malformed separateFrom must not compose');
    } catch (error) {
      const failure = error as RbacCatalogError;
      expect(failure.code).toBe('INVALID_PERMISSION_SPEC');
      expect(failure.message).toContain('posts:approve');
      expect(failure.message).toContain('separateFrom');
    }
  });

  it('still accepts the stated-and-empty forms of both optional fields', () => {
    // The rule is about a field that is present and MALFORMED, not about one a
    // source deliberately leaves off or states as empty.
    const stated = definePermissionContribution({
      source: 'stated',
      permissions: {
        'a:read': { kind: 'instance', ownerMarker: false, separateFrom: [] },
        'a:write': { kind: 'class' },
      },
    });
    const composed = composePermissions(stated);
    expect(composed.permissions.kind('a:read')).toBe('instance');
    expect(composed.ownerPermissions).toEqual([]);
    expect(composed.sodPairs).toEqual([]);
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
      posts: 'Publicações',
      money: 'Dinheiro',
    });
    expect(composed.labels.actions).toMatchObject({
      write: 'Editar',
      approve: 'Aprovar',
    });
    expect(composed.labels.permissions).toEqual({ 'posts:read:own': 'Ver os seus' });
  });

  it('composes no words from this package — its own ride the web copy port', () => {
    // `RBAC_PERMISSIONS` used to label `roles`/`team` (and `read`/`manage`)
    // in pt-BR, which shipped one application's voice to every adopter
    // through this very merge. Those words are now the REQUIRED
    // `RbacWebCopy.permissionLabels`, so the contribution composes to an
    // empty vocabulary — if a word ever shows up here again, it is the same
    // leak and this fails.
    const { labels } = composePermissions(RBAC_PERMISSIONS);
    expect(labels.domains).toEqual({});
    expect(labels.actions).toEqual({});
    expect(labels.permissions).toEqual({});
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
      leafOnlyRoles: [],
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
      composeAll().withRoles({
        roles: ROLES,
        ownerRoles: ['OWNR'],
        leafOnlyRoles: [],
        platformOnlyRoles: [],
      });
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
        leafOnlyRoles: [],
        platformOnlyRoles: [],
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
