import type { ImpersonationServerConfig } from './context';
import type { LiveSession } from './live-session';

/**
 * Record the end of a session — the ONE audit write in this package that is
 * FENCED, and the reason the trade flips here.
 *
 * Everywhere else a failed trail write becomes the caller's 500, because a start
 * nobody can see is the outcome this mechanism exists to prevent. There is no
 * mutation here to roll back, and the thing on the other side of the trade is
 * the operator's ability to STOP acting as someone else. A missing end row is
 * recoverable — the start row names the window, and the hard time box closes the
 * session whether or not anything was written — while a stuck session is not: it
 * would leave a human staring at another person's account with the exit
 * returning 500.
 *
 * KEYED TO THE SESSION'S OWN TENANT, never to the URL the exit was called on.
 * Either surface clears either kind of session (they mint the same cookie), so a
 * preview bounded to one tenant can legitimately be ended through another
 * tenant's mount — and an entry filed against the URL's tenant would leave the
 * start row dangling in a record nothing can amend, with the pair unfindable
 * through the very key the trail is read by.
 *
 * BOTH KINDS, through one writer. Filing every exit as one shape would record "O
 * ended a preview of O" for a role preview, with the role name dropped.
 */
export async function recordEnd(
  config: ImpersonationServerConfig,
  live: LiveSession | null,
): Promise<void> {
  if (!live) return;
  try {
    await config.audit.ended({
      kind: live.state.kind,
      tenantId: live.state.tenantId,
      actorUserId: live.state.realUserId,
      targetUserId: live.state.subjectUserId,
      previewRoleName: live.state.previewRoleName,
    });
  } catch (error) {
    config.onError?.('failed to record the end of a session', error);
  }
}
