import {
  foldApiError,
  gatesOf,
  messagesOf,
  ok,
  pageResponse,
  type RbacActor,
  type RbacRoute,
  type RbacServerConfig,
} from './context';
import type { GrantGovernance } from './grant-governance';
import type { RbacGuards } from './guards';
import type { MyPermissionsPayload } from './payloads';
import type { RolesStore } from './roles-store';
import {
  parseBody,
  parseRoleListQuery,
  requireParam,
  type RoleWireSchemas,
} from './wire';

/**
 * The role CRUD + template-override + permissions routes (12-13) — the
 * package half of the origin host's `app/api/admin/[tenantSlug]/{roles,permissions}`
 * files. Route paths are relative to the host's admin mount (the segment that
 * used to be `/api/admin/:tenantSlug`).
 *
 * What did NOT move in: the entity-lifecycle wrapping (drafts / versions /
 * approvals — ticket 12-17's surface) and the entitlement gate on custom-role
 * creation (billing, answered by the host before the request reaches these
 * handlers — e.g. in its `resolveActor`).
 */

interface RoleRouteDeps<P extends string> {
  config: RbacServerConfig<P>;
  guards: RbacGuards<P>;
  governance: GrantGovernance;
  roles: RolesStore;
  wire: RoleWireSchemas;
  /**
   * The staff tier `GET /permissions` sits behind (any non-customer
   * membership, or a platform admin) — the shell's entry gate.
   */
  requireStaffTier: (actor: RbacActor) => Promise<void>;
}

/** The `roles:manage` gate every route in this file sits behind. */
function requireManageRoles<P extends string>(
  deps: RoleRouteDeps<P>,
  actor: RbacActor,
): Promise<void> {
  const gates = gatesOf(deps.config);
  return deps.guards.requirePermission(
    { userId: actor.userId, isSuper: actor.isSuper, permissionCeiling: actor.permissionCeiling },
    gates.manageRoles as P,
    { scope: actor.tenantId },
  );
}

function listRolesRoute<P extends string>(deps: RoleRouteDeps<P>): RbacRoute {
  return {
    method: 'GET',
    path: '/roles',
    async handle({ actor, query }) {
      try {
        await requireManageRoles(deps, actor);
        const page = await deps.roles.listRolesPage(actor.tenantId, parseRoleListQuery(query));
        return pageResponse(page.data, page.pagination);
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function createRoleRoute<P extends string>(deps: RoleRouteDeps<P>): RbacRoute {
  return {
    method: 'POST',
    path: '/roles',
    async handle({ actor, body, locale }) {
      try {
        await requireManageRoles(deps, actor);
        const input = parseBody(deps.wire.roleWriteBody, body, messagesOf(deps.config, locale));
        // Governance runs BEFORE the write (immediate feedback).
        await deps.governance.assertCanCreateRole(actor, {
          name: input.name,
          permissions: input.permissions,
        });
        const role = await deps.roles.createTenantRole(
          actor.tenantId,
          {
            name: input.name,
            description: input.description ?? null,
            permissions: input.permissions,
          },
          locale,
        );
        return ok(role);
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function updateRoleRoute<P extends string>(deps: RoleRouteDeps<P>): RbacRoute {
  return {
    method: 'PATCH',
    path: '/roles/:id',
    async handle({ actor, params, body, locale }) {
      try {
        await requireManageRoles(deps, actor);
        const messages = messagesOf(deps.config, locale);
        const input = parseBody(deps.wire.roleWriteBody, body, messages);
        await deps.governance.assertCanCreateRole(actor, {
          name: input.name,
          permissions: input.permissions,
        });
        const role = await deps.roles.updateTenantRole(
          requireParam(params, 'id', messages),
          actor.tenantId,
          {
            name: input.name,
            description: input.description ?? null,
            permissions: input.permissions,
          },
          locale,
        );
        // A stale id or another tenant's row → 404.
        return role ? ok(role) : { status: 404, body: { error: messages.roleNotFound } };
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function deleteRoleRoute<P extends string>(deps: RoleRouteDeps<P>): RbacRoute {
  return {
    method: 'DELETE',
    path: '/roles/:id',
    async handle({ actor, params, locale }) {
      try {
        await requireManageRoles(deps, actor);
        const messages = messagesOf(deps.config, locale);
        const deleted = await deps.roles.deleteTenantRole(
          requireParam(params, 'id', messages),
          actor.tenantId,
          locale,
        );
        return deleted
          ? ok({ status: 'deleted' as const })
          : { status: 404, body: { error: messages.roleNotFound } };
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function overrideTemplateRoute<P extends string>(deps: RoleRouteDeps<P>): RbacRoute {
  return {
    method: 'PUT',
    path: '/roles/templates/:name',
    async handle({ actor, params, body, locale }) {
      try {
        await requireManageRoles(deps, actor);
        const messages = messagesOf(deps.config, locale);
        const name = requireParam(params, 'name', messages);
        deps.governance.assertEditableTemplateName(name);
        const input = parseBody(deps.wire.templateOverrideBody, body, messages);
        await deps.governance.assertCanOverrideTemplateRole(actor, {
          name,
          permissions: input.permissions,
        });
        const role = await deps.roles.upsertTemplateOverride(
          actor.tenantId,
          name,
          {
            description: input.description ?? null,
            permissions: input.permissions,
          },
          locale,
        );
        return ok(role);
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

/**
 * Reset is an OVERRIDE whose permission set happens to be the seed's, so it is
 * governed exactly like the `PUT` above and in the same order — gate, then
 * name, then governance, then write. It used to run only the first two, and
 * that asymmetry was an escalation: narrowing a system template through the
 * governed `PUT` is the only mechanism the product offers an owner for
 * withholding a permission from an administrator, and an ungoverned reset threw
 * that narrowing away and restored the code's seed — so any holder of
 * `roles:manage` (an ADMIN, by seed) could hand their own role back whatever
 * the owner had removed, repeatedly. The check is against the set the write
 * LANDS, not against the row's current one.
 */
function resetTemplateRoute<P extends string>(deps: RoleRouteDeps<P>): RbacRoute {
  return {
    method: 'DELETE',
    path: '/roles/templates/:name',
    async handle({ actor, params, locale }) {
      try {
        await requireManageRoles(deps, actor);
        const name = requireParam(params, 'name', messagesOf(deps.config, locale));
        deps.governance.assertEditableTemplateName(name);
        const seedPermissions = deps.roles.templateSeedPermissions(name);
        // An unseeded name writes nothing, so there is nothing to govern: it
        // stays the idempotent no-op below rather than becoming a refusal.
        if (seedPermissions !== null) {
          await deps.governance.assertCanOverrideTemplateRole(actor, {
            name,
            permissions: seedPermissions,
          });
        }
        await deps.roles.resetTemplateRole(actor.tenantId, name, locale);
        // Reset is idempotent — a no-op still answers `reset`.
        return ok({ status: 'reset' as const });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function permissionsRoute<P extends string>(deps: RoleRouteDeps<P>): RbacRoute {
  return {
    method: 'GET',
    path: '/permissions',
    async handle({ actor }) {
      try {
        // The caller's OWN resolved set — an actor may always learn what THEY
        // can do (never another actor's set); the set itself does the fine
        // gating. Staff-gated (any non-customer membership), the shell's tier.
        await deps.requireStaffTier(actor);
        const permissions = await deps.guards.getActorPermissions(
          {
            userId: actor.userId,
            isSuper: actor.isSuper,
            permissionCeiling: actor.permissionCeiling,
          },
          actor.tenantId,
        );
        const extras = (await deps.config.permissionsExtras?.(actor)) ?? {};
        // Sorted for a stable wire shape (Set iteration is insertion-defined).
        //
        // `satisfies` rather than a bare object: this payload is the one a host
        // ADVERTISES, and until FUT-760 nothing tied the two together. The
        // annotation makes `MyPermissionsPayload` the single description of it,
        // so a field added here cannot silently stop matching the type hosts
        // hold their schemas to.
        return ok({
          permissions: [...permissions].sort(),
          ...extras,
        } satisfies MyPermissionsPayload);
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

export function roleRoutes<P extends string>(deps: RoleRouteDeps<P>): RbacRoute[] {
  return [
    listRolesRoute(deps),
    createRoleRoute(deps),
    updateRoleRoute(deps),
    deleteRoleRoute(deps),
    overrideTemplateRoute(deps),
    resetTemplateRoute(deps),
    permissionsRoute(deps),
  ];
}
