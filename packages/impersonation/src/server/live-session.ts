import type { ImpersonationSessionCodec } from '../core/session';
import { toImpersonationState } from '../core/session';
import type { ImpersonationSession, ImpersonationState } from '../core/types';

import type { ImpersonationRequest, ImpersonationServerConfig } from './context';

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

/**
 * The same reader, plus the host's live-authority check.
 *
 * Used by every ROUTE, so the banner, the nesting refusal and the end audit all
 * agree with the guards about whether a session exists. `liveSession` above
 * stays synchronous because a host's own actor resolution runs on every request
 * and must not be made async by a check most hosts answer from memory — such a
 * host applies {@link ImpersonationServerConfig.stillAuthorized} itself there,
 * exactly as it does here.
 */
export async function authorizedSession(
  codec: ImpersonationSessionCodec,
  config: Pick<ImpersonationServerConfig, 'stillAuthorized'>,
  request: Pick<ImpersonationRequest, 'actor' | 'cookieValue'>,
): Promise<LiveSession | null> {
  const live = liveSession(codec, request);
  if (!live || !config.stillAuthorized) return live;
  return (await config.stillAuthorized(live.state, request.actor)) ? live : null;
}
