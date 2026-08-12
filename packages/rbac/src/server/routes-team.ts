import {
  RbacApiError,
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
import type { RolesStore } from './roles-store';
import type { TeamStore } from './team-store';
import { parseBody, parseTeamListQuery, requireParam, type RoleWireSchemas } from './wire';

/**
 * The team roster routes (12-13) — the package half of future-pay's
 * `app/api/admin/[tenantSlug]/team/**` files.
 *
 * ROUTE ORDER IS PART OF THE SURFACE: `/team/context` and `/team/invites/…`
 * are registered before `/team/:userId`, so a literal segment can never be
 * captured as a member id. The array `teamRoutes` returns is that order;
 * adapters must mount it verbatim.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVITES_NOT_CONFIGURED = { status: 501, body: { error: 'Convites não estão configurados.' } };

interface TeamRouteDeps<P extends string> {
  config: RbacServerConfig<P>;
  guards: RbacGuards<P>;
  governance: GrantGovernance;
  roles: RolesStore;
  team: TeamStore;
  wire: RoleWireSchemas;
}

/**
 * The coarse admin tier — the outer boundary the whole roster sits behind
 * (future-pay's `requireTenantAdminBySlug`). Answers the actor's base role
 * for the ownership rules; a platform admin passes as `SUPERADMIN`.
 */
async function requireAdminTier<P extends string>(
  deps: TeamRouteDeps<P>,
  actor: RbacActor,
): Promise<string> {
  const messages = messagesOf(deps.config);
  const adminRoles = new Set(deps.config.adminRoles ?? ['OWNER', 'ADMIN']);
  if (actor.isSuper) return 'SUPERADMIN';
  if (!actor.userId) throw new RbacApiError(403, messages.forbidden);
  const role = actor.role ?? (await deps.team.getMemberRole(actor.tenantId, actor.userId));
  if (!role || !adminRoles.has(role)) {
    throw new RbacApiError(403, messages.forbidden);
  }
  return role;
}

function requirePermission<P extends string>(
  deps: TeamRouteDeps<P>,
  actor: RbacActor,
  permission: string,
): Promise<void> {
  return deps.guards.requirePermission(
    { userId: actor.userId, isSuper: actor.isSuper, permissionCeiling: actor.permissionCeiling },
    permission as P,
    { scope: actor.tenantId },
  );
}

function rosterRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'GET',
    path: '/team',
    async handle({ actor, query }) {
      try {
        await requireAdminTier(deps, actor);
        const page = await deps.team.listTeamPage(actor.tenantId, parseTeamListQuery(query));
        return pageResponse(page.data, page.pagination);
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function inviteRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'POST',
    path: '/team',
    async handle({ actor, body }) {
      try {
        await requireAdminTier(deps, actor);
        // Accountless invites need storage this package does not own — the
        // optional invites port; without it the affordance does not exist.
        if (!deps.config.invites) return INVITES_NOT_CONFIGURED;
        const input = parseBody(deps.wire.inviteBody, body);
        const email = input.email.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) {
          throw new RbacApiError(400, messagesOf(deps.config).invalidEmail);
        }
        const result = await deps.config.invites.invite(actor.tenantId, email);
        return ok({ status: result.status });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

// Registered BEFORE `/team/:userId` — a literal segment, not a member id.
function contextRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'GET',
    path: '/team/context',
    async handle({ actor }) {
      try {
        await requireAdminTier(deps, actor);
        // Same gate as the member-detail read: the context exposes invite
        // e-mails and per-member role assignments.
        await requirePermission(deps, actor, gatesOf(deps.config).readTeam);
        const [customRoles, assignableRoles, pendingInvites] = await Promise.all([
          deps.team.listTenantMemberExtraRoles(actor.tenantId),
          deps.roles.listAssignableRoleNames(actor.tenantId),
          deps.config.invites?.listPending(actor.tenantId) ?? Promise.resolve([]),
        ]);
        return ok({
          customRolesByMember: [...customRoles.entries()].map(([userId, names]) => ({
            userId,
            roles: names,
          })),
          assignableRoles,
          pendingInvites,
          invitesEnabled: Boolean(deps.config.invites),
        });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function cancelInviteRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'DELETE',
    path: '/team/invites/:inviteId',
    async handle({ actor, params }) {
      try {
        await requireAdminTier(deps, actor);
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam);
        if (!deps.config.invites) return INVITES_NOT_CONFIGURED;
        // Idempotent — a stale invite id is a no-op.
        await deps.config.invites.cancel(actor.tenantId, requireParam(params, 'inviteId'));
        return ok({ status: 'cancelled' as const });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function memberDetailRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'GET',
    path: '/team/:userId',
    async handle({ actor, params }) {
      try {
        await requireAdminTier(deps, actor);
        await requirePermission(deps, actor, gatesOf(deps.config).readTeam);
        const member = await deps.team.getTenantMemberDetail(
          actor.tenantId,
          requireParam(params, 'userId'),
        );
        // A non-member id is a 404 that reveals nothing.
        if (!member) throw new RbacApiError(404, messagesOf(deps.config).memberNotFound);
        return ok({
          userId: member.userId,
          name: member.name,
          email: member.email,
          image: member.image,
          role: member.role,
          customRoles: member.customRoles,
          memberSince: member.memberSince.toISOString(),
          lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
        });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function setMemberRoleRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'PATCH',
    path: '/team/:userId',
    async handle({ actor, params, body }) {
      try {
        await requireAdminTier(deps, actor);
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam);
        const input = parseBody(deps.wire.setMemberRoleBody, body);
        const userId = requireParam(params, 'userId');
        // The shared governance (escalation / scope-ceiling / SoD /
        // owner-protected) runs BEFORE the write.
        await deps.governance.assertCanGrantRole(actor, input.role, userId);
        await deps.team.setMemberRole(actor.tenantId, userId, input.role);
        return ok({ status: 'updated' as const, role: input.role });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function removeMemberRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'DELETE',
    path: '/team/:userId',
    async handle({ actor, params }) {
      try {
        const actorRole = await requireAdminTier(deps, actor);
        await deps.team.removeTenantMemberGuarded(
          actor.tenantId,
          requireParam(params, 'userId'),
          actorRole,
        );
        return ok({ status: 'removed' as const });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function memberStatusRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'PATCH',
    path: '/team/:userId/status',
    async handle({ actor, params, body }) {
      try {
        await requireAdminTier(deps, actor);
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam);
        const input = parseBody(deps.wire.setMemberActiveBody, body);
        await deps.team.setMembershipActive(
          actor.tenantId,
          requireParam(params, 'userId'),
          input.active,
        );
        return ok({ status: 'updated' as const });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function grantMemberRoleRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'POST',
    path: '/team/:userId/roles',
    async handle({ actor, params, body }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageRoles);
        const input = parseBody(deps.wire.grantMemberRoleBody, body);
        const userId = requireParam(params, 'userId');
        await deps.governance.assertCanGrantRole(actor, input.role, userId);
        await deps.team.grantCustomRoleToMember(actor.tenantId, userId, input.role);
        return ok({ status: 'granted' as const, role: input.role });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

function revokeMemberRoleRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'DELETE',
    path: '/team/:userId/roles/:role',
    async handle({ actor, params }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageRoles);
        // Idempotent — revoking a role the member doesn't hold is a no-op.
        await deps.team.revokeCustomRoleFromMember(
          actor.tenantId,
          requireParam(params, 'userId'),
          requireParam(params, 'role'),
        );
        return ok({ status: 'revoked' as const });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

export function teamRoutes<P extends string>(deps: TeamRouteDeps<P>): RbacRoute[] {
  return [
    rosterRoute(deps),
    inviteRoute(deps),
    contextRoute(deps),
    cancelInviteRoute(deps),
    memberDetailRoute(deps),
    setMemberRoleRoute(deps),
    removeMemberRoute(deps),
    memberStatusRoute(deps),
    grantMemberRoleRoute(deps),
    revokeMemberRoleRoute(deps),
  ];
}
