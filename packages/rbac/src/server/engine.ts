import { createRbac, type Rbac } from '../core/engine';
import type { AuthzContext, RoleAssignment } from '../core/types';

import { GLOBAL_SCOPE, type RbacServerConfig } from './context';
import type { RbacDbProvider } from './db';
import { parseRolePermissions, tenantRoleKey } from './permissions-format';

/**
 * The DB-backed engine wiring (12-13) — ported from the origin host's
 * `lib/rbac/rbac.ts`, with every origin-host domain name turned into config.
 * The resolver reads ONLY the tables this package owns, which is what lets it
 * live here rather than in every host.
 */

/** Whether a scope key is an org scope (`'org:<id>'`). */
export function isOrgScope(scope: string): boolean {
  return scope.startsWith('org:');
}

/** Whether a scope is a LEAF tenant (not GLOBAL, not an org chain). */
export function isTenantScope(scope: string): boolean {
  return scope !== GLOBAL_SCOPE && !isOrgScope(scope);
}

/**
 * Load the LIVE tenant roles matching the `(clientId, name)` pairs, keyed by
 * {@link tenantRoleKey}. `archivedAt: null` is SECURITY-CRITICAL: a
 * soft-deleted custom role must NOT grant at runtime — excluding it makes an
 * archived role resolve to zero permissions, exactly like a hard delete.
 */
export async function getTenantRolesByName(
  db: RbacDbProvider,
  requests: readonly { clientId: string; name: string }[],
): Promise<Map<string, readonly string[] | '*'>> {
  const resolved = new Map<string, readonly string[] | '*'>();
  if (requests.length === 0) return resolved;

  const clientIds = [...new Set(requests.map((r) => r.clientId))];
  const names = [...new Set(requests.map((r) => r.name))];
  const wanted = new Set(requests.map((r) => tenantRoleKey(r.clientId, r.name)));

  const client = await db();
  const rows = await client.role.findMany({
    where: { clientId: { in: clientIds }, name: { in: names }, archivedAt: null },
    select: {
      id: true,
      clientId: true,
      name: true,
      permissions: true,
      description: true,
      kind: true,
      locked: true,
    },
  });

  for (const row of rows) {
    // A template row (clientId NULL) is never a per-tenant override.
    if (row.clientId === null) continue;
    const key = tenantRoleKey(row.clientId, row.name);
    if (wanted.has(key)) resolved.set(key, parseRolePermissions(row.permissions));
  }
  return resolved;
}

/**
 * Resolve a DB user id to its role assignments. Two sources, unioned:
 *
 *   - `Membership` rows and their `membership_roles` n:m join — the
 *     authoritative per-tenant source: every role a membership holds becomes
 *     `{ role, scope: clientId, permissions }` with the role's DB permissions
 *     attached INLINE, so tenant permissions derive entirely from `Role` rows.
 *     Only ACTIVE memberships grant — the soft "Desativar" really revokes.
 *   - `RoleAssignment` rows — platform/GLOBAL grants, `org:` grants, and the
 *     roster's additive tenant custom-role grants. A tenant-scoped grant at an
 *     explicitly soft-disabled membership's tenant is NOT honored.
 */
async function resolveAssignments(
  config: Pick<RbacServerConfig, 'db'>,
  actorId: string,
): Promise<RoleAssignment[]> {
  const client = await config.db();
  const [memberships, joinRows, roleAssignments] = await Promise.all([
    client.membership.findMany({
      where: { userId: actorId },
      select: { id: true, userId: true, clientId: true, role: true, active: true, createdAt: true },
    }),
    // The joined roles of the actor's memberships; each role's permission
    // string is read inline from its Role row below (one batched read).
    client.membershipRole.findMany({
      where: { membership: { userId: actorId } },
      select: {
        membership: { select: { userId: true, clientId: true, role: true } },
        role: { select: { id: true, name: true } },
      },
    }),
    client.roleAssignment.findMany({
      where: { userId: actorId },
      select: { userId: true, roleName: true, scope: true },
    }),
  ]);

  const activeTenants = new Set(
    memberships.filter((m) => m.active).map((m) => m.clientId),
  );

  const wantedRoles = joinRows
    .filter((row) => activeTenants.has(row.membership.clientId))
    .map((row) => ({ clientId: row.membership.clientId, name: row.role.name }));
  const tenantRoles = await getTenantRolesByName(config.db, wantedRoles);

  const fromMemberships: RoleAssignment[] = joinRows
    .filter((row) => activeTenants.has(row.membership.clientId))
    .flatMap((row) => {
      const permissions = tenantRoles.get(
        tenantRoleKey(row.membership.clientId, row.role.name),
      );
      // A join row whose Role is archived resolves to nothing — deny-by-default.
      if (permissions === undefined) return [];
      return [{ role: row.role.name, scope: row.membership.clientId, permissions }];
    });

  // Grants at an EXPLICITLY disabled membership's tenant are not honored;
  // assignment-only grants (no membership row at all) stay honored.
  const disabledTenants = new Set(
    memberships.filter((m) => !m.active).map((m) => m.clientId),
  );
  const honored = roleAssignments.filter((r) => !disabledTenants.has(r.scope));
  const tenantScoped = honored.filter((r) => isTenantScope(r.scope));
  const assignmentRoles = await getTenantRolesByName(
    config.db,
    tenantScoped.map((r) => ({ clientId: r.scope, name: r.roleName })),
  );
  const fromAssignments: RoleAssignment[] = honored.map((r) => {
    const permissions = assignmentRoles.get(tenantRoleKey(r.scope, r.roleName));
    return permissions === undefined
      ? { role: r.roleName, scope: r.scope }
      : { role: r.roleName, scope: r.scope, permissions };
  });
  return [...fromMemberships, ...fromAssignments];
}

/** The tenant narrowing for the assignment relation: a bare tenant scope IS
 * the tenant id; GLOBAL and `org:` stay unfiltered (an org grant spans its
 * member tenants by design). */
function assignmentTenantFilter(scope: AuthzContext['scope']): { clientId?: string } {
  return typeof scope === 'string' && isTenantScope(scope) ? { clientId: scope } : {};
}

/**
 * The resource ids of `resourceType` the subject holds an ACTIVE claim on.
 * The temporal filter lives HERE, once: active = `validFrom <= now AND
 * (validTo IS NULL OR validTo > now)`, so a future-dated revocation keeps
 * granting until its scheduled instant.
 */
async function activeAssignmentIds(
  db: RbacDbProvider,
  subject: string,
  resourceType: string,
  tenantFilter: { clientId?: string },
  now: Date,
): Promise<string[]> {
  const client = await db();
  const rows = await client.resourceAssignment.findMany({
    where: {
      userId: subject,
      resourceType,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      ...tenantFilter,
    },
    select: { resourceId: true },
  });
  return rows.map((row) => row.resourceId);
}

/** Build the shared engine for a config — one per `createApiRbac` call. */
export function createDbEngine<P extends string>(config: RbacServerConfig<P>): Rbac<P> {
  return createRbac<P>({
    permissions: config.catalog.permissions,
    roles: config.catalog.roleTemplates,
    resolver: (actorId) => resolveAssignments(config, actorId),
    globalScope: GLOBAL_SCOPE,
    ...(config.scopeParent ? { scopeParent: config.scopeParent } : {}),
    ...(config.ownership ? { ownership: config.ownership } : {}),
    assignmentResolver: async (subject, resourceType, context) => {
      const tenantFilter = assignmentTenantFilter(context.scope);
      const direct = await activeAssignmentIds(
        config.db,
        subject,
        resourceType,
        tenantFilter,
        new Date(),
      );
      if (!config.expandAssignments) return direct;
      return config.expandAssignments(direct, resourceType, context);
    },
  });
}
