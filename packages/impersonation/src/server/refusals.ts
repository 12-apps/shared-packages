import type { PreviewSubject } from '../core/types';

import {
  ImpersonationApiError,
  type ImpersonationMessages,
  messagesOf,
  type ImpersonationCopySource,
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

const REFUSAL_STATUS: Record<string, number> = {
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

const REFUSAL_MESSAGE_KEYS: Record<string, keyof ImpersonationMessages> = {
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
  /**
   * The SOURCE, not a resolved pack.
   *
   * `createRefusals` runs once at the host's mount and its methods run per
   * request, so a pack resolved on the way in would word every later denial in
   * the language the process started with.
   */
  messages: ImpersonationCopySource<ImpersonationMessages>;
  onError?(message: string, error: unknown): void;
}

export interface Refusals {
  /**
   * Record the refusal and build the error.
   *
   * FENCED, and the reasoning is the opposite of the START's. A start whose
   * trail write fails must not happen at all — an unrecorded session is the
   * outcome this mechanism exists to prevent. But a REFUSAL whose trail write
   * fails must still REFUSE: the security outcome has already happened (no
   * session), and letting the failure surface would turn a 403 into a 500,
   * which hands a caller a way to convert a denial into an outage. The row is
   * lost and reported; the denial stands.
   */
  refuse(
    refusal: ImpersonationRefusal,
    attempt: AttemptContext,
    /** The caller's language, for the sentence only — never for the trail. */
    locale?: string,
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
    /** The caller's language, for the sentence only — never for the trail. */
    locale?: string,
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
  /** Record a refusal with no standing check — the caller is already known. */
  record(refusal: ImpersonationRefusal, attempt: AttemptContext): Promise<void>;
}

export function createRefusals(parts: RefusalParts): Refusals {
  const errorFor = (
    refusal: ImpersonationRefusal,
    locale: string | undefined,
  ): ImpersonationApiError => {
    // A host-supplied entitlement code lands on the 403 fallback; it never
    // reaches here, because that gate answers with the host's own status.
    const key = REFUSAL_MESSAGE_KEYS[refusal];
    const messages = messagesOf(parts, locale);
    return new ImpersonationApiError(
      REFUSAL_STATUS[refusal] ?? 403,
      key ? messages[key] : messages.notAuthorized,
    );
  };

  const concernsTenant = async (attempt: AttemptContext): Promise<boolean> => {
    if (!attempt.actorUserId) return false;
    return parts.directory.isActiveMember(attempt.actorUserId, attempt.tenantId);
  };

  /** Write the row, or lose it — see {@link Refusals.refuse}. */
  const record = async (
    refusal: ImpersonationRefusal,
    attempt: AttemptContext,
  ): Promise<void> => {
    try {
      await parts.audit.refused({ ...attempt, refusal });
    } catch (error) {
      parts.onError?.(`could not record the ${refusal} refusal`, error);
    }
  };

  const recordUnauthorized = async (
    refusal: ImpersonationRefusal,
    attempt: AttemptContext,
  ): Promise<void> => {
    if (!(await concernsTenant(attempt))) return;
    await record(refusal, attempt);
  };

  return {
    record,
    recordUnauthorized,
    async refuse(refusal, attempt, locale) {
      await record(refusal, attempt);
      return errorFor(refusal, locale);
    },
    async refuseUnauthorized(refusal, attempt, locale) {
      await recordUnauthorized(refusal, attempt);
      return errorFor(refusal, locale);
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
