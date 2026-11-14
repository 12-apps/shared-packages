import {
  RbacApiError,
  fencedAudit,
  foldApiError,
  gatesOf,
  messagesOf,
  ok,
  pageResponse,
  type RbacActor,
  type RbacRoute,
  type RbacServerConfig,
} from './context';
import { platformActorOf, type RbacActorTier } from './roster-policy';
import type { GrantGovernance } from './grant-governance';
import type { RbacGuards } from './guards';
import type { MemberDetailPayload } from './payloads';
import { announceInvite } from './invite-announce';
import { resolveInviteRoles } from './invite-roles';
import type { RolesStore } from './roles-store';
import type { TeamStore } from './team-store';
import { parseBody, parseTeamListQuery, requireParam, type RoleWireSchemas } from './wire';

/**
 * The team roster routes (12-13) — the package half of the origin host's
 * `app/api/admin/[tenantSlug]/team/**` files.
 *
 * ROUTE ORDER IS PART OF THE SURFACE: `/team/context` and `/team/invites/…`
 * are registered before `/team/:userId`, so a literal segment can never be
 * captured as a member id. The array `teamRoutes` returns is that order;
 * adapters must mount it verbatim.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TeamRouteDeps<P extends string> {
  config: RbacServerConfig<P>;
  guards: RbacGuards<P>;
  governance: GrantGovernance;
  roles: RolesStore;
  team: TeamStore;
  wire: RoleWireSchemas;
}

/**
 * The caller's tier, READ for the ownership rules and never a refusal: their
 * REAL membership role, or the platform discriminator for a caller the host
 * resolved as `isSuper`.
 *
 * It used to be the roster's outer boundary too (`requireAdminTier`, against
 * a host-stated `adminRoles` list), which made access a ROLE question: a
 * custom role holding `team:manage` could not invite, and a role holding
 * `team:read` could not open the roster. Access is now the permission each
 * route asks ({@link requirePermission}); the tier only answers who may touch
 * an owner. Call it AFTER the permission check, so a refusal never reads it.
 *
 * Resolved from the membership row, never from the actor object. The store's
 * tier reader answers `null` for a soft-disabled membership, and the
 * permission engine resolves nothing for one either, so a deactivated member
 * is refused by the permission check before this runs.
 */
export async function readActorTier<P extends string>(
  deps: TeamRouteDeps<P>,
  actor: RbacActor,
): Promise<RbacActorTier> {
  if (platformActorOf(actor)) return { role: null, isPlatformActor: true, userId: actor.userId };
  const role = actor.userId ? await deps.team.getMemberRole(actor.tenantId, actor.userId) : null;
  return { role, isPlatformActor: false, userId: actor.userId };
}

export function requirePermission<P extends string>(
  deps: TeamRouteDeps<P>,
  actor: RbacActor,
  permission: string,
  locale?: string,
): Promise<void> {
  return deps.guards.requirePermission(
    { userId: actor.userId, isSuper: actor.isSuper, permissionCeiling: actor.permissionCeiling },
    permission as P,
    { scope: actor.tenantId, locale },
  );
}

function rosterRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'GET',
    path: '/team',
    async handle({ actor, query, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).readTeam, locale);
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
    async handle({ actor, body, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam, locale);
        const messages = messagesOf(deps.config, locale);
        // Accountless invites need storage this package does not own — the
        // optional invites port; without it the affordance does not exist.
        if (!deps.config.invites) {
          return { status: 501, body: { error: messages.invitesNotConfigured } };
        }
        const input = parseBody(deps.wire.inviteBody, body, messages);
        const email = input.email.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) {
          throw new RbacApiError(400, messages.invalidEmail);
        }
        // Judged BEFORE the port runs, so a refused role writes nothing.
        const roles = await resolveInviteRoles(deps, actor, input, messages);
        const result = await deps.config.invites.invite(actor.tenantId, email, roles);
        // The invite is a membership-granting write (the "already has an
        // account" branch grants immediately inside the port), so it reports
        // like one. The port owns any richer trail of its own storage.
        await fencedAudit(deps.config.audit)?.({
          clientId: actor.tenantId,
          action: 'team.invite',
          resourceType: 'membership',
          resourceId: email,
          after: {
            status: result.status,
            // The trail says WHAT was granted, not merely that something was.
            // An invite is the one roster write whose role used to be invisible
            // to the audit log, because the port decided it after the entry.
            ...(roles ? { role: roles.role, customRoles: [...roles.customRoles] } : {}),
          },
        });
        await announceInvite(deps, actor, email, result);
        // A live grant carries the member's id, so the screen's confirmation
        // can open a profile the roster's sort may have paged away (FUT-3135).
        const live = result.status === 'added' && result.userId;
        return ok({ status: result.status, ...(live ? { userId: result.userId } : {}) });
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
    async handle({ actor, locale }) {
      try {
        // Same gate as the member-detail read: the context exposes invite
        // e-mails and per-member role assignments.
        await requirePermission(deps, actor, gatesOf(deps.config).readTeam, locale);
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
          invitesResendable: Boolean(deps.config.invites?.resend),
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
    async handle({ actor, params, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam, locale);
        const messages = messagesOf(deps.config, locale);
        if (!deps.config.invites) {
          return { status: 501, body: { error: messages.invitesNotConfigured } };
        }
        // Idempotent — a stale invite id is a no-op.
        const inviteId = requireParam(params, 'inviteId', messages);
        await deps.config.invites.cancel(actor.tenantId, inviteId);
        await fencedAudit(deps.config.audit)?.({
          clientId: actor.tenantId,
          action: 'team.invite_cancel',
          resourceType: 'membership',
          resourceId: inviteId,
        });
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
    async handle({ actor, params, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).readTeam, locale);
        const messages = messagesOf(deps.config, locale);
        const member = await deps.team.getTenantMemberDetail(
          actor.tenantId,
          requireParam(params, 'userId', messages),
        );
        // A non-member id is a 404 that reveals nothing.
        if (!member) throw new RbacApiError(404, messages.memberNotFound);
        // `satisfies` because this is a PROJECTION, not the record: it drops
        // `active`/`status` and sends the two timestamps as ISO strings. A host
        // advertises this shape, so it needs a published type of its own —
        // binding to `TeamMemberDetail` would make it declare two fields that
        // never arrive.
        return ok({
          userId: member.userId,
          name: member.name,
          email: member.email,
          image: member.image,
          role: member.role,
          customRoles: member.customRoles,
          memberSince: member.memberSince.toISOString(),
          lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
        } satisfies MemberDetailPayload);
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
    async handle({ actor, params, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam, locale);
        const tier = await readActorTier(deps, actor);
        await deps.team.removeTenantMemberGuarded(
          actor.tenantId,
          requireParam(params, 'userId', messagesOf(deps.config, locale)),
          tier,
          locale,
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
    async handle({ actor, params, body, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam, locale);
        const messages = messagesOf(deps.config, locale);
        const input = parseBody(deps.wire.setMemberActiveBody, body, messages);
        await deps.team.setMembershipActive(
          actor.tenantId,
          requireParam(params, 'userId', messages),
          input.active,
          locale,
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
    async handle({ actor, params, body, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageRoles, locale);
        const messages = messagesOf(deps.config, locale);
        const input = parseBody(deps.wire.grantMemberRoleBody, body, messages);
        const userId = requireParam(params, 'userId', messages);
        await deps.governance.assertCanGrantRole(actor, input.role, userId);
        await deps.team.grantCustomRoleToMember(actor.tenantId, userId, input.role, locale);
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
    async handle({ actor, params, locale }) {
      try {
        await requirePermission(deps, actor, gatesOf(deps.config).manageRoles, locale);
        const messages = messagesOf(deps.config, locale);
        // Idempotent — revoking a role the member doesn't hold is a no-op.
        // Gated on the permission alone, so the tier is not read: an owner
        // role's revoke re-reads the caller inside the write.
        await deps.team.revokeCustomRoleFromMember(
          actor.tenantId,
          requireParam(params, 'userId', messages),
          requireParam(params, 'role', messages),
          locale,
          { role: null, isPlatformActor: platformActorOf(actor), userId: actor.userId },
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
    removeMemberRoute(deps),
    memberStatusRoute(deps),
    grantMemberRoleRoute(deps),
    revokeMemberRoleRoute(deps),
  ];
}
