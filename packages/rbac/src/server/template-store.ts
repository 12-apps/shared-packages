import type { TenantRoleSeed } from '../tenant-role-seeds';

import { ROLE_SELECT } from './db';
import { roleDiff, toRoleRecord, type RoleRecord, type RolesStoreCtx } from './roles-store';

/**
 * Per-tenant TEMPLATE overrides (12-13) — the copy-on-write edit of a seeded
 * SYSTEM role and its reset to the catalog default, ported from future-pay's
 * `lib/repositories/role.ts` (FUT-217/FUT-231 half). Split from
 * `roles-store.ts` so both stay within the size gate.
 */

/**
 * Create-or-update the row that shadows template `name`. Under the per-tenant
 * catalog the row always exists (seeded); this edits it in place. `kind:
 * SYSTEM` is preserved so it stays a catalog role that can be reset. A locked
 * (Owner) row is never reachable here — governance rejects owner names first.
 */
export async function upsertTemplateOverride(
  ctx: RolesStoreCtx,
  tenantId: string,
  name: string,
  input: { description: string | null; permissions: string },
): Promise<RoleRecord> {
  const db = await ctx.db();
  const saved = await db.$transaction(async (tx) => {
    const existing = await tx.role.findFirst({
      where: { clientId: tenantId, name },
      select: ROLE_SELECT,
    });
    const row = await tx.role.upsert({
      where: { clientId_name: { clientId: tenantId, name } },
      create: {
        clientId: tenantId,
        name,
        description: input.description,
        permissions: input.permissions,
        isTemplate: false,
        kind: 'SYSTEM',
      },
      update: { description: input.description, permissions: input.permissions, kind: 'SYSTEM' },
      select: ROLE_SELECT,
    });
    return { row, existing };
  });
  // Tuning a seeded template is a permission-bundle change.
  await ctx.audit?.({
    clientId: tenantId,
    action: 'role.update',
    resourceType: 'role',
    resourceId: saved.row.id,
    ...(saved.existing ? { before: roleDiff(saved.existing) } : {}),
    after: roleDiff(saved.row),
  });
  return toRoleRecord(saved.row);
}

/**
 * The seeded catalog default a reset of `name` would WRITE, or undefined when
 * nothing is seeded under that name (the reset is then a no-op).
 *
 * Exported because the reset ROUTE has to run governance against the exact
 * permission set the write lands, and a second `find` at the call site could
 * resolve a different seed than the write does. One lookup, so the check and
 * the write can never disagree about what is being restored.
 */
export function templateSeedFor(
  ctx: RolesStoreCtx,
  name: string,
): TenantRoleSeed | undefined {
  return ctx.tenantRoleSeeds.find((role) => role.name === name);
}

/**
 * Restore a tenant's SYSTEM role `name` to the seeded catalog default. Reset
 * EDITS the row back in place rather than deleting it (deleting would strip
 * the tenant's role and every member's link to it). Tenant-scoped and
 * locked-safe via the `where`; idempotent — false when nothing matched.
 *
 * This WRITES a permission set, so it is governed like the override it is: the
 * route runs `assertCanOverrideTemplateRole` against {@link templateSeedFor}
 * before calling it.
 */
export async function resetTemplateRole(
  ctx: RolesStoreCtx,
  tenantId: string,
  name: string,
): Promise<boolean> {
  const seed: TenantRoleSeed | undefined = templateSeedFor(ctx, name);
  if (!seed) return false;
  const db = await ctx.db();
  const reset = await db.$transaction(async (tx) => {
    const before = await tx.role.findFirst({
      where: { clientId: tenantId, name, locked: false },
      select: ROLE_SELECT,
    });
    const result = await tx.role.updateMany({
      where: { clientId: tenantId, name, locked: false },
      data: { permissions: seed.permissions, description: seed.description, kind: 'SYSTEM' },
    });
    return result.count > 0 && before ? { before } : null;
  });
  if (!reset) return false;
  // Resetting to the catalog default is itself a bundle change.
  await ctx.audit?.({
    clientId: tenantId,
    action: 'role.update',
    resourceType: 'role',
    resourceId: reset.before.id,
    before: roleDiff(reset.before),
    after: { name, description: seed.description, permissions: seed.permissions },
  });
  return true;
}

/**
 * The per-tenant SYSTEM role rows to create for a new tenant — deterministic
 * ids make re-seeding a no-op via `skipDuplicates`.
 */
export function tenantRoleSeedRows(
  tenantId: string,
  seeds: readonly TenantRoleSeed[],
): {
  id: string;
  clientId: string;
  name: string;
  permissions: string;
  description: string;
  isTemplate: boolean;
  kind: string;
  locked: boolean;
}[] {
  return seeds.map((seed) => ({
    id: `${tenantId}-role-${seed.name.toLowerCase()}`,
    clientId: tenantId,
    name: seed.name,
    permissions: seed.permissions,
    description: seed.description,
    isTemplate: false,
    kind: seed.kind,
    locked: seed.locked,
  }));
}
