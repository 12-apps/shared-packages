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
  leafOnlyRoles: [],
  platformOnlyRoles: [],
});

// @ts-expect-error the catalog's own registry still narrows to the union
const notAPermission: ComposedPerm = composedCatalog.permissions.list.includes(
  'docs:read',
)
  ? 'docs:publish'
  : 'docs:read';

/**
 * THE UNION IS NOT `string` — the assertion every `@ts-expect-error` above
 * silently depends on.
 *
 * `PermissionOf` distributes over the contributed sources, and `string`
 * ABSORBS every literal beside it (`'a' | 'b' | string` IS `string`). So one
 * source typed `PermissionContribution<string>` collapses the WHOLE catalog's
 * union — and the collapse is invisible in the failure direction: every
 * `@ts-expect-error` above turns into an unused directive, which reports as
 * "this line no longer errors", never as "the type is now string".
 *
 * That is exactly what `PermissionContribution<P extends string = string>`
 * used to invite: `const X: PermissionContribution = definePermissionContribution({…})`
 * is the annotation ADOPTING.md asked for, and it erased the ids. The default
 * is gone; this pair of aliases is the tripwire that keeps it gone.
 */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/** `never` if the union ever collapses to `string`; `true` while it holds. */
type UnionSurvives = Eq<ComposedPerm, string> extends true ? never : true;
const unionSurvives: UnionSurvives = true;

/** …and it survives `withRoles` too, which is what the factories receive. */
type CatalogUnionSurvives = Eq<
  PermissionOf<typeof composedCatalog>,
  string
> extends true
  ? never
  : true;
const catalogUnionSurvives: CatalogUnionSurvives = true;

void unionSurvives;
void catalogUnionSurvives;
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
