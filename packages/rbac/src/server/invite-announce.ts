/**
 * Telling the invitee — the half that did not exist.
 *
 * Split from `./routes-team` at the 400-line gate, on a real seam: that file
 * is the roster's route descriptors, and this is the one side effect any of
 * them has beyond its own write.
 */

import type { RbacActor } from './context';
import { TEAM_INVITED_NOTIFICATION_TYPE } from './notifications';

/** What the invites port reported, and who it granted if it granted anyone. */
interface InviteOutcome {
  status: 'added' | 'invited';
  userId?: string;
}

/** Just the config this needs — the optional port, and nothing else. */
interface InviteAnnounceDeps {
  config: {
    notify?: {
      emit(event: {
        type: string;
        recipient: { userId: string };
        payload: Record<string, unknown>;
      }): Promise<{ accepted: boolean; reason?: string }>;
    };
  };
}

/**
 * Tell the invitee — the half that did not exist.
 *
 * Deliberately AFTER the port's write and the audit entry, never before and
 * never inside them: a notification about a row is a lie until the row is
 * durable, and `notify` announcing mid-transaction is the read-your-own-hint
 * race the notifications package documents on its own emit path.
 *
 * Three things it does NOT do, each on purpose:
 *
 * - **It never throws.** `RbacNotifyPort.emit` is contractually outcome-only,
 *   so a pipeline having a bad day cannot fail an invite that already
 *   committed. Nothing here re-wraps it; adding a try/catch would suggest the
 *   port might throw, which is precisely the property callers must be able to
 *   rely on.
 * - **It does not reach an accountless invitee.** With no `userId` there is no
 *   inbox to write to — the address has no account yet — so the notification
 *   is skipped. Reaching that reader is a MAIL, addressed to an e-mail rather
 *   than a user, which is a different port and stays the host's signup flow.
 *   The skip is silent by design here and visible where it matters: the host
 *   binding the port sees an unbound recipient, not a delivered message.
 * - **It does not invent a recipient.** Notifying "whoever can manage the
 *   team" instead would tell the roster about its own action and still leave
 *   the invitee uninformed — the incident, restated.
 */
export async function announceInvite(
  deps: InviteAnnounceDeps,
  actor: RbacActor,
  email: string,
  result: InviteOutcome,
): Promise<void> {
  const notify = deps.config.notify;
  if (!notify || !result.userId) return;
  await notify.emit({
    type: TEAM_INVITED_NOTIFICATION_TYPE,
    recipient: { userId: result.userId },
    payload: {
      tenantId: actor.tenantId,
      email,
      status: result.status,
      ...(actor.userId ? { invitedByUserId: actor.userId } : {}),
    },
  });
}
