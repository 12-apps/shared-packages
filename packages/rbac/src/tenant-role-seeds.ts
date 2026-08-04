/**
 * PER-TENANT ROLE SEEDING — the projection of the role templates into DB rows.
 *
 * Split out of `templates.ts` so that file stays what it says it is: DATA. This
 * is the only code in the template layer, and the only place the catalog is
 * serialized into the shape `roles` rows carry.
 */
import type { RoleDef } from './core/types';
import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_GOVERNANCE,
  FUTURE_PAY_PLATFORM_ONLY_ROLES,
  type FuturePayPermission,
} from './templates';

/**
 * A per-tenant role row to seed into the DB (FUT-231). Every tenant gets one row
 * per {@link DEFAULT_ROLE_TEMPLATES} staff role (the platform-only SUPERADMIN is
 * excluded — it is never a per-tenant staff role). `permissions` is already the
 * DB string the engine consumes ('*' or a JSON array of permission strings), so
 * the seed and the runtime resolver can never drift. `kind` is always `'SYSTEM'`
 * (seeded from the catalog); `locked` marks an Owner role (never editable).
 */
export interface TenantRoleSeed {
  name: string;
  permissions: string;
  description: string;
  kind: 'SYSTEM';
  locked: boolean;
}

/** Serialize a template's permissions to the DB string ('*' or a JSON array). */
function serializeSeedPermissions(
  permissions: RoleDef<FuturePayPermission>['permissions'],
): string {
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
 * template except the platform-only ones, with the Owner role(s) locked. The
 * single source of truth for the runtime creation-time seed, the Prisma seed and
 * the backfill migration — all three derive their rows from this one function.
 */
export function futurePayTenantRoleSeeds(): readonly TenantRoleSeed[] {
  return DEFAULT_ROLE_TEMPLATES.filter(
    (role) => !FUTURE_PAY_PLATFORM_ONLY_ROLES.includes(role.name),
  ).map((role) => ({
    name: role.name,
    permissions: serializeSeedPermissions(role.permissions),
    description: role.description ?? '',
    kind: 'SYSTEM' as const,
    locked: FUTURE_PAY_GOVERNANCE.ownerRoles.includes(role.name),
  }));
}
