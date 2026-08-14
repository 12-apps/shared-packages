import type { ImpersonationSessionCodec } from '../core/session';
import { toImpersonationState } from '../core/session';
import type { ImpersonationSession, ImpersonationState } from '../core/types';

import type { ImpersonationRequest } from './context';

/** A session that decoded, authenticated, and belongs to THIS caller. */
export interface LiveSession {
  /**
   * The decoded payload. Carried alongside the collapsed state for one field:
   * `expiresAt` in its raw form, plus the operator variant's `targetApp` and
   * `reason`, which no authorization decision depends on and which the collapsed
   * state therefore drops.
   */
  session: ImpersonationSession;
  state: ImpersonationState;
}

/**
 * The impersonation in force for this request, or `null`.
 *
 * ONE reader, used by every route and lent to the host for its own actor
 * resolution. Every refusal — a failed authentication tag, a closed window, a
 * machine token, a cookie replayed into a browser signed in as someone else —
 * belongs to it, and re-implementing any of them elsewhere would create a second
 * implementation that could refuse a write on a session the guards treat as
 * ordinary, or worse, allow one on a session they do not.
 */
export function liveSession(
  codec: ImpersonationSessionCodec,
  request: Pick<ImpersonationRequest, 'actor' | 'cookieValue'>,
  now?: number,
): LiveSession | null {
  const session = codec.read({
    cookieValue: request.cookieValue,
    isMachineToken: request.actor.isMachineToken,
    now,
  });
  if (!session) return null;
  const state = toImpersonationState(session, request.actor.userId);
  return state ? { session, state } : null;
}
