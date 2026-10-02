import { fencedAudit, foldApiError, gatesOf, messagesOf, ok, type RbacRoute } from './context';
import { requireAdminTier, requirePermission, type TeamRouteDeps } from './routes-team';
import { requireParam } from './wire';

/**
 * `POST /team/invites/:inviteId/resend` — mail a pending invite a fresh link
 * (FUT-3165).
 *
 * Its own module because `routes-team.ts` sits near the 400-line ceiling; it is
 * mounted after `teamRoutes`, which is safe because no team route shares its
 * four-segment POST shape.
 *
 * Same guard as cancel — admin tier plus `manageTeam` — because it acts on the
 * same row. The WRITE is the host's (`RbacInvitesPort.resend`): only the host
 * knows where the credential lives and whether the mail left, and the contract
 * on the port says it must write nothing when it did not.
 *
 * `not_sent` answers 502: the request was sound and an upstream (the mail
 * vendor, or the absence of one) failed it. The sentence says the previous link
 * still works, because the host promised to leave it.
 */
function resendInviteRoute<P extends string>(deps: TeamRouteDeps<P>): RbacRoute {
  return {
    method: 'POST',
    path: '/team/invites/:inviteId/resend',
    async handle({ actor, params, locale }) {
      try {
        await requireAdminTier(deps, actor, locale);
        await requirePermission(deps, actor, gatesOf(deps.config).manageTeam);
        const messages = messagesOf(deps.config, locale);
        if (!deps.config.invites?.resend) {
          return { status: 501, body: { error: messages.invitesNotConfigured } };
        }
        const inviteId = requireParam(params, 'inviteId', messages);
        const result = await deps.config.invites.resend(actor.tenantId, inviteId);
        if (result.status === 'not_found') {
          return { status: 404, body: { error: messages.inviteNotFound } };
        }
        if (result.status === 'not_sent') {
          return { status: 502, body: { error: messages.inviteNotSent } };
        }
        await fencedAudit(deps.config.audit)?.({
          clientId: actor.tenantId,
          action: 'team.invite_resend',
          resourceType: 'membership',
          resourceId: inviteId,
        });
        return ok({ status: 'resent' as const, email: result.email });
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

/** The invite routes that act on ONE pending invite beyond cancelling it. */
export function inviteRoutes<P extends string>(deps: TeamRouteDeps<P>): RbacRoute[] {
  return [resendInviteRoute(deps)];
}
