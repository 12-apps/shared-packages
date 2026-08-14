import type { PreviewSubject } from '../core/types';

import {
  ImpersonationApiError,
  type ImpersonationMessages,
} from './context';
import type {
  ImpersonationAuditPort,
  ImpersonationDirectory,
  ImpersonationRefusal,
} from './ports';

/**
 * Recording a refusal, and turning it into the error the caller receives.
 *
 * Every function here RETURNS the error for the caller to `throw await`, rather
 * than throwing on its behalf. A function returning `Promise<never>` does not
 * tell TypeScript's control flow that the code after it is dead, so the throw
 * has to be visible at the call site anyway; returning the error keeps the
 * narrowing honest instead of paying for it in casts.
 */

/** What a refusal names, beyond the refusal itself. */
export interface AttemptContext {
  tenantId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  targetUserId: string | null;
  reason: string | null;
  previewOf: PreviewSubject | null;
}

const REFUSAL_STATUS: Record<ImpersonationRefusal, number> = {
  not_authorized: 403,
  actor_not_recorded: 403,
  target_is_platform_admin: 403,
  target_not_found: 404,
  not_a_member: 403,
  not_entitled: 403,
  /**
   * 403 rather than 409, and deliberately the same status on BOTH surfaces. A
   * conflict status reads better in isolation, but the two mints produce the
   * SAME cookie, and a client that branched on the status would then have to
   * know which endpoint it called to interpret the same refusal.
   */
  already_impersonating: 403,
};

const REFUSAL_MESSAGE_KEYS: Partial<
  Record<ImpersonationRefusal, keyof ImpersonationMessages>
> = {
  not_authorized: 'notAuthorized',
  actor_not_recorded: 'actorNotRecorded',
  target_is_platform_admin: 'targetIsPlatformAdmin',
  target_not_found: 'targetNotFound',
  not_a_member: 'notAMember',
  already_impersonating: 'alreadyImpersonating',
};

interface RefusalParts {
  audit: ImpersonationAuditPort;
  directory: ImpersonationDirectory;
  messages: ImpersonationMessages;
}

export interface Refusals {
  /**
   * Record the refusal and build the error.
   *
   * The audit write comes FIRST and is NOT fenced: if the trail cannot be
   * written the caller gets a 500 rather than a tidy 403, which is the right
   * trade for an append-only log — a refusal nobody can see is barely a refusal.
   * (Ending a session is the one place that trade flips.)
   */
  refuse(
    refusal: ImpersonationRefusal,
    attempt: AttemptContext,
  ): Promise<ImpersonationApiError>;
  /**
   * The same, for the two AUTHORIZATION denials — where the caller may be a
   * complete stranger to the tenant they named.
   *
   * A refusal row is written ONLY when the tenant has standing to hear about it.
   * The trail is append-only, unbounded, and keyed to a tenant the CALLER chose
   * by putting an id or a slug in the request; recording every denial therefore
   * hands any signed-in stranger a write primitive against any tenant's history
   * — attempt at a hundred tenants and a hundred owners each get a line about
   * somebody they have never heard of. That is not a security signal, it is a
   * way to bury one.
   *
   * So the row is written only for a caller with an ACTIVE membership: someone
   * whose reach the tenant already administers, and whose attempt is therefore a
   * fact about their own team. A stranger's 403 is a platform-side event and
   * belongs to nobody's tenant history.
   *
   * NONE of this changes the RESPONSE: whoever was refused gets the same status
   * either way, so nothing here is a probe for tenant existence.
   *
   * Chosen over a rate limit deliberately: a limit still admits the first N rows
   * per tenant, and it answers the VOLUME without answering the RELEVANCE —
   * which is the part that makes these rows worth keeping.
   */
  refuseUnauthorized(
    refusal: ImpersonationRefusal,
    attempt: AttemptContext,
  ): Promise<ImpersonationApiError>;
  /**
   * Record an authorization denial WITHOUT building an error, for a caller that
   * must rethrow something of its own — the entitlement gate, whose 402 and 409
   * are distinct on the wire and must not be collapsed into a flat 403.
   */
  recordUnauthorized(
    refusal: ImpersonationRefusal,
    attempt: AttemptContext,
  ): Promise<void>;
}

export function createRefusals(parts: RefusalParts): Refusals {
  const errorFor = (refusal: ImpersonationRefusal): ImpersonationApiError => {
    const key = REFUSAL_MESSAGE_KEYS[refusal];
    return new ImpersonationApiError(
      REFUSAL_STATUS[refusal],
      key ? parts.messages[key] : parts.messages.notAuthorized,
    );
  };

  const concernsTenant = async (attempt: AttemptContext): Promise<boolean> => {
    if (!attempt.actorUserId) return false;
    return parts.directory.isActiveMember(attempt.actorUserId, attempt.tenantId);
  };

  const recordUnauthorized = async (
    refusal: ImpersonationRefusal,
    attempt: AttemptContext,
  ): Promise<void> => {
    if (!(await concernsTenant(attempt))) return;
    await parts.audit.refused({ ...attempt, refusal });
  };

  return {
    recordUnauthorized,
    async refuse(refusal, attempt) {
      await parts.audit.refused({ ...attempt, refusal });
      return errorFor(refusal);
    },
    async refuseUnauthorized(refusal, attempt) {
      await recordUnauthorized(refusal, attempt);
      return errorFor(refusal);
    },
  };
}

/** An attempt with nothing resolved yet — the shape every route starts from. */
export function attemptOf(tenantId: string, overrides: Partial<AttemptContext> = {}): AttemptContext {
  return {
    tenantId,
    actorUserId: null,
    actorEmail: null,
    targetUserId: null,
    reason: null,
    previewOf: null,
    ...overrides,
  };
}
