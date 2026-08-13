/**
 * PER-TENANT ROLE SEEDING — the projection of a host's role templates into the
 * DB rows every new tenant gets.
 *
 * Mechanism, not data: the templates are the host's (they leave with its
 * catalog), the projection is the package's, and it stays the only place a role
 * matrix is serialized into the shape `roles` rows carry — so a seeded row and
 * the runtime resolver can never drift. Reached through
 * `catalog.tenantRoleSeeds`, which binds it to the composed role policy.
 */
import type { RoleDef } from './core/types';

/**
 * A per-tenant role row to seed into the DB (FUT-231). Every tenant gets one
 * row per template staff role; platform-only roles are excluded — they are
 * never a per-tenant staff role. `permissions` is already the DB string the
 * engine consumes (`'*'` or a JSON array of permission strings). `kind` is
 * always `'SYSTEM'` (seeded from the catalog); `locked` marks an owner role
 * (never editable).
 */
export interface TenantRoleSeed {
  name: string;
  permissions: string;
  description: string;
  kind: 'SYSTEM';
  locked: boolean;
}

/** The role-policy slice the projection reads. */
interface TenantRoleSeedInput {
  readonly roles: readonly RoleDef[];
  /** Owner roles — seeded, but `locked`. */
  readonly ownerRoles: readonly string[];
  /** Platform-only roles — never seeded per tenant. Required, `[]` included. */
  readonly platformOnlyRoles: readonly string[];
}

/** Serialize a template's permissions to the DB string ('*' or a JSON array). */
function serializeSeedPermissions(permissions: RoleDef['permissions']): string {
  if (permissions === '*') return '*';
  return JSON.stringify(
    permissions.map((entry) => {
      // Templates use bare permission strings; a caveat entry can't round-trip as
      // a plain permission — fail loudly rather than seed a wrong catalog.
      if (typeof entry !== 'string') {
        throw new Error(
          `Cannot seed a role permission with a caveat: ${JSON.stringify(entry)}`,
        );
      }
      return entry;
    }),
  );
}

/**
 * The per-tenant role catalog to materialize for EVERY tenant (FUT-231): every
 * template except the platform-only ones, with the owner role(s) locked. The
 * single source of truth for the runtime creation-time seed, a host's Prisma
 * seed and any backfill migration — all three derive their rows from here.
 */
export function tenantRoleSeeds(
  input: TenantRoleSeedInput,
): readonly TenantRoleSeed[] {
  const platformOnly = new Set(input.platformOnlyRoles);
  return input.roles
    .filter((role) => !platformOnly.has(role.name))
    .map((role) => ({
      name: role.name,
      permissions: serializeSeedPermissions(role.permissions),
      description: role.description ?? '',
      kind: 'SYSTEM' as const,
      locked: input.ownerRoles.includes(role.name),
    }));
}
