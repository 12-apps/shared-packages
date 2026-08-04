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
