/**
 * The audit WRITER (12-14): the thin, transactional "who did what" append.
 *
 * Every audited mutation calls it with the transaction client it is already
 * running in, so "it happened" and "it was logged" commit or roll back together
 * — explicitly NOT fire-and-forget (a refund succeeding with no trail defeats
 * the purpose). One mutation writes exactly one entry, and a failed insert
 * PROPAGATES so the caller's transaction rolls back.
 *
 * This function is the only thing that inserts into the model, and that is what
 * makes the impersonation rule enforceable at all: it is checked once, here,
 * instead of at the dozens of route bodies that stamp their own actor. See
 * {@link resolveActorUserId} for the two ways the impersonated subject would
 * otherwise end up named as the actor, and why neither can be left to a call
 * site to remember.
 */
import type { AuditVocabularyIndex } from '../core/vocabulary';
import { AuditVocabularyError, redactDiff } from '../core/vocabulary';

import { getActorAttribution, getActorUserId, type ActorAttributionSnapshot } from './actor-context';
import type { AuditWriteClient } from './db';

export interface AuditEntryInput {
  clientId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  /** State before the mutation (omit for pure creates); allowlist-redacted. */
  before?: Record<string, unknown>;
  /** State after the mutation; allowlist-redacted. */
  after?: Record<string, unknown>;
  /**
   * Explicit actor override. Omit to take the request's actor context; pass
   * `null` to force a system write (a provider webhook, say).
   *
   * There is exactly ONE value it cannot take: the identity a live impersonation
   * is rendering as, which {@link resolveActorUserId} replaces with the real
   * human. A caller that resolved this id from a row the guard loaded for the
   * effective subject is naming the target without meaning to, and the row it
   * would write is the unrecoverable one.
   */
  actorUserId?: string | null;
  /**
   * Explicit impersonation override, with the same precedence as
   * {@link actorUserId}: omit to take whatever the request's context carries,
   * pass `null` to assert "no impersonation applies to this entry" from a caller
   * that knows better than the ambient context — a queued job draining inside an
   * impersonated request, say, where the ambient value would attribute work
   * nobody asked for.
   *
   * NEVER a substitute for `actorUserId`. Passing the impersonated id here and
   * leaving `actorUserId` to the context is the ONLY correct shape; swapping them
   * produces a row that reads as though the target acted themselves, on an
   * append-only table.
   */
  onBehalfOfUserId?: string | null;
  /** Correlation id when the caller has one. */
  requestId?: string | null;
}

/** A live impersonation, as the request's actor context reports it. */
interface LiveImpersonation {
  /** The real human whose credentials authorized the request. */
  realUserId: string;
  /** The identity the request is being rendered as. */
  subjectUserId: string;
}

/**
 * The impersonation the context carries, or `null` for an ordinary request.
 *
 * BOTH halves are required. `onBehalfOfUserId` alone says only that someone
 * declared an impersonation; without the real human beside it there is nobody to
 * attribute the write to, and guessing — falling back to whatever id was stamped
 * last — is exactly the failure this guard exists to prevent. The stamp writes
 * the pair atomically, so a half-populated context cannot arise in production;
 * treating it as "not impersonated" fails towards the ordinary, correct path.
 */
function liveImpersonation(attribution: ActorAttributionSnapshot): LiveImpersonation | null {
  const { onBehalfOfUserId, realUserId } = attribution;
  if (!onBehalfOfUserId || !realUserId) return null;
  return { realUserId, subjectUserId: onBehalfOfUserId };
}

/**
 * WHO the row names as its actor, with the impersonation invariant applied.
 *
 * Two vectors would otherwise put the impersonated SUBJECT in `actorUserId`, and
 * both are silent — no call site looks wrong:
 *
 * 1. **The stamped context id.** Route bodies call `setActor(grant.userId, …)`
 *    themselves, and while a session is impersonated the tenant guard resolves
 *    that grant for the EFFECTIVE subject, so the last id handed to `setActor` is
 *    the subject's. A live impersonation is therefore resolved from `realUserId`
 *    and the stamped id is not consulted at all: anyone can re-stamp the context,
 *    nobody can re-stamp `realUserId`.
 *
 * 2. **An explicit `actorUserId`.** It keeps its precedence — a caller may
 *    deliberately attribute an entry to the owner of the row it changed — with
 *    exactly one value ruled out: the subject of a live impersonation. That is
 *    vector 1 wearing a different hat, and it yields the one row that cannot be
 *    corrected: a write that reads as though the impersonated person made it.
 *
 * A third-party id and an explicit `null` (a webhook forcing a system write) are
 * both honored verbatim: neither claims the subject acted, and the session is
 * recorded beside them in `onBehalfOfUserId` either way.
 */
function resolveActorUserId(
  explicit: string | null | undefined,
  impersonation: LiveImpersonation | null,
): string | null {
  if (explicit === undefined) {
    return impersonation ? impersonation.realUserId : (getActorUserId() ?? null);
  }
  return impersonation && explicit === impersonation.subjectUserId
    ? impersonation.realUserId
    : explicit;
}

/** The row the writer builds, before it reaches the seam. */
function buildRow(
  index: AuditVocabularyIndex,
  input: AuditEntryInput,
  attribution: ActorAttributionSnapshot,
): Parameters<AuditWriteClient['auditLog']['create']>[0]['data'] {
  const impersonation = liveImpersonation(attribution);
  const actorUserId = resolveActorUserId(input.actorUserId, impersonation);
  // Who the actor was ACTING AS. Same explicit-beats-context precedence as
  // `actorUserId` — and deliberately WITHOUT the `actorUserId !== null` gate that
  // suppresses `actorRole`/`scope` below. The asymmetry is the point:
  //
  // `actorRole`/`scope` describe the authorization the NAMED ACTOR used, so when
  // a caller forces `actorUserId: null` they no longer describe anything and are
  // dropped. "Someone was being impersonated" is a fact about the SESSION, not
  // about whichever actor a caller chose to name, and it stays true either way.
  // Gate it like the other two and any path that writes a system-attributed
  // entry mid-session — a webhook, a job, a helper that hard-codes
  // `actorUserId: null` — silently launders the impersonation out of the trail.
  //
  // Read from `attribution`, not from `impersonation`: a context that declared a
  // subject but carries no real human is not one this writer will attribute a
  // write to, yet the declaration itself is still a fact worth keeping. Dropping
  // information here is the failure mode; keeping it is never one.
  const onBehalfOfUserId =
    input.onBehalfOfUserId !== undefined
      ? input.onBehalfOfUserId
      : (attribution.onBehalfOfUserId ?? null);
  return {
    clientId: input.clientId,
    actorUserId,
    actorRole: actorUserId !== null ? (attribution.role ?? null) : null,
    scope: actorUserId !== null ? (attribution.scope ?? null) : null,
    onBehalfOfUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    before: redactDiff(index, input.resourceType, input.before),
    after: redactDiff(index, input.resourceType, input.after),
    requestId: input.requestId ?? null,
  };
}

/** The bound writer a host calls: `audit(tx, entry)`. */
export type AuditWriter = (tx: AuditWriteClient, input: AuditEntryInput) => Promise<void>;

/**
 * Bind a writer to a vocabulary.
 *
 * The action is validated too, not only the resource type: an unknown action
 * passes redaction untouched and lands as a row no filter can select and no
 * viewer can label. On an append-only table that is permanent, so it is a throw
 * — inside the caller's transaction, which therefore rolls back.
 */
export function createAuditWriter(index: AuditVocabularyIndex): AuditWriter {
  return async function audit(tx: AuditWriteClient, input: AuditEntryInput): Promise<void> {
    if (!index.hasAction(input.action)) throw new AuditVocabularyError('action', input.action);
    const row = buildRow(index, input, getActorAttribution());
    await tx.auditLog.create({ data: row });
  };
}
