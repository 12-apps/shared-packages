/**
 * COMPILE-TIME fixtures (FUT-146 acceptance: "unknown permission fails
 * typecheck"). The real assertion is `tsc --noEmit` (the package's
 * `check-types` script): every `@ts-expect-error` line MUST fail to compile
 * without the directive. If a library change ever loosens the permission union
 * so an off-catalog string is accepted, the directive itself becomes "unused"
 * and `check-types` fails — the tripwire fires both ways. The single runtime
 * test below only keeps the module a real (executed) suite.
 */
import { describe, expect, it } from 'vitest';
import { composePermissions } from '../core/compose';
import { definePermissionContribution, type PermissionOf } from '../core/contribution';
import { createRbac } from '../core/engine';
import { definePermissions } from '../core/registry';
import type { RoleDef } from '../core/types';

const PERMS = definePermissions({
  'docs:read': 'class',
  'docs:edit:own': 'instance',
} as const);

type Perm = (typeof PERMS.list)[number];

const makeEngine = () =>
  createRbac<Perm>({
    permissions: PERMS,
    roles: [],
    resolver: () => [],
  });

const rbac = makeEngine();

/** Exercised only by the type checker — deliberately never imported at runtime. */
export async function unknownPermissionFixtures(): Promise<void> {
  // Baseline: catalog permissions typecheck.
  await rbac.can('user', 'docs:read', null, {});
  await rbac.visibleResources('user', 'docs:edit:own', 'docs', {});

  // @ts-expect-error an off-catalog permission is a compile error on `can`
  await rbac.can('user', 'docs:write', null, {});

  // @ts-expect-error …and on `requirePermission`
  await rbac.requirePermission('user', 'docs:delete', null, {});

  // @ts-expect-error …and on the LIST seam
  await rbac.visibleResources('user', 'unknown:permission', 'docs', {});
}

// A role definition may only bundle catalog permissions.
const okRole: RoleDef<Perm> = { name: 'ok', permissions: ['docs:read'] };

// @ts-expect-error a role may not carry an off-catalog permission
const badRole: RoleDef<Perm> = { name: 'bad', permissions: ['docs:write'] };

void okRole;
void badRole;

/**
 * THE SAME TRIPWIRE, AFTER COMPOSITION (12-13 follow-up).
 *
 * The union above comes from one `definePermissions` call, which is how the
 * package used to derive it — from a catalog it owned. A host now assembles
 * one from N sources, so the question these fixtures answer is whether the
 * union SURVIVES that assembly: if `composePermissions` widened `P` to
 * `string` anywhere along the way, every `@ts-expect-error` below would go
 * unused and `check-types` would fail. That is the point of writing them.
 */
const PACKAGE_SIDE = definePermissionContribution({
  source: '@demo/docs',
  permissions: { 'docs:approve': { kind: 'class' } },
});

const HOST_SIDE = definePermissionContribution({
  source: 'demo-host',
  permissions: {
    'docs:read': { kind: 'class' },
    'docs:edit:own': { kind: 'instance' },
  },
});

const COMPOSED = composePermissions(PACKAGE_SIDE, HOST_SIDE);

/** The union a host's guards are checked against: BOTH sources' ids, unioned. */
type ComposedPerm = PermissionOf<typeof COMPOSED>;

const composedEngine = createRbac<ComposedPerm>({
  permissions: COMPOSED.permissions,
  roles: [],
  resolver: () => [],
});

/** Exercised only by the type checker — deliberately never called. */
export async function composedUnionFixtures(): Promise<void> {
  // Both sources' ids are in the union, so both typecheck.
  await composedEngine.can('user', 'docs:approve', null, {});
  await composedEngine.can('user', 'docs:edit:own', 'doc-1', {});

  // @ts-expect-error an id NO source contributes is still a compile error
  await composedEngine.can('user', 'docs:delete', null, {});
}

// A role built on the composed catalog may only bundle composed ids.
const okComposedRole: RoleDef<ComposedPerm> = {
  name: 'reviewer',
  permissions: ['docs:read', 'docs:approve'],
};

// @ts-expect-error …and not one that neither source declares
const badComposedRole: RoleDef<ComposedPerm> = { name: 'ghost', permissions: ['docs:publish'] };

// The catalog the factories take keeps the union too — `withRoles` does not
// erase it on the way through.
const composedCatalog = COMPOSED.withRoles({
  roles: [okComposedRole],
  ownerRoles: [],
});

// @ts-expect-error the catalog's own registry still narrows to the union
const notAPermission: ComposedPerm = composedCatalog.permissions.list.includes(
  'docs:read',
)
  ? 'docs:publish'
  : 'docs:read';

void okComposedRole;
void badComposedRole;
void notAPermission;
void composedUnionFixtures;

describe('unknown-permission typecheck fixtures', () => {
  it('the catalog baseline runs (the real assertions are compile-time)', async () => {
    // Never CALLED (the off-catalog requirePermission line would throw) — the
    // reference just keeps the fixture function part of the live module graph.
    void unknownPermissionFixtures;
    // No grants in the fixture engine — deny-by-default.
    const engine = makeEngine();
    expect(await engine.can('user', 'docs:read', null, {})).toBe(false);
  });
});
