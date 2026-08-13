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
   * INERT while a live impersonation is in scope. There, `actor_user_id` is
   * ALWAYS the real human — the subject's own id and `null` both resolve to them,
   * and any THIRD-party id throws (see {@link resolveActorUserId}): the caller is
   * one field away from being right, and rewriting it silently would hide their
   * bug. A caller that wants to name the row's owner puts that id in the diff,
   * where the allowlist already carries `userId` / `endedByUserId`.
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
 * Thrown when a caller names a third party as the actor of a write made INSIDE a
 * live impersonation. Carries both ids so the offending call site is findable.
 */
export class AuditActorConflictError extends Error {
  constructor(explicit: string, realUserId: string) {
    super(
      `Cannot attribute an audit entry to "${explicit}" while impersonating: ` +
        `actor_user_id must be the real human ("${realUserId}"). ` +
        'Put the id you meant to record in the diff instead.',
    );
    this.name = 'AuditActorConflictError';
    Object.setPrototypeOf(this, AuditActorConflictError.prototype);
  }
}

/**
 * WHO the row names as its actor.
 *
 * **The rule: while a live impersonation exists, `actor_user_id` is ALWAYS the
 * real human.** Not "unless the caller says otherwise" — there is no third column
 * to hold them, the table is append-only, and support impersonation is only
 * defensible because the trail names the staff member who used it. Every way of
 * losing that name is silent, and no call site looks wrong:
 *
 * 1. **The stamped context id.** Route bodies call `setActor(grant.userId, …)`
 *    themselves, and while a session is impersonated the tenant guard resolves
 *    that grant for the EFFECTIVE subject, so the last id handed to `setActor` is
 *    the subject's. A live impersonation is therefore resolved from `realUserId`
 *    and the stamped id is not consulted at all: anyone can re-stamp the context,
 *    nobody can re-stamp `realUserId`.
 *
 * 2. **An explicit `actorUserId` naming the SUBJECT.** Vector 1 wearing a
 *    different hat — an id read off a row the guard loaded for the effective
 *    subject, handed over in good faith. Resolved to the real human.
 *
 * 3. **An explicit `actorUserId` naming a THIRD PARTY.** The pattern is
 *    legitimate outside a session (`audit(tx, { actorUserId: shift.userId })`
 *    attributing an entry to the owner of the row it changed) and destroys the
 *    trail inside one: the row then reads "closing-cook, on behalf of owner-1",
 *    and the support agent who actually did it is unrecoverable. So it THROWS —
 *    inside the caller's transaction, which therefore rolls back. Not silently
 *    rewritten: the caller is one field from being right, and quietly moving
 *    their id would hide a real bug in their code.
 *
 * 4. **An explicit `null`** (a webhook or a helper forcing a system write).
 *    Resolved to the real human too. A human IS driving this session, so the row
 *    must say who; the "system" character of the write is carried by the absent
 *    role/scope in {@link buildRow}, not by an absent human.
 */
function resolveActorUserId(
  explicit: string | null | undefined,
  impersonation: LiveImpersonation | null,
): string | null {
  if (!impersonation) {
    // No session: the override keeps full precedence, `null` included.
    return explicit === undefined ? (getActorUserId() ?? null) : explicit;
  }
  if (explicit === undefined || explicit === null) return impersonation.realUserId;
  if (explicit === impersonation.subjectUserId || explicit === impersonation.realUserId) {
    return impersonation.realUserId;
  }
  throw new AuditActorConflictError(explicit, impersonation.realUserId);
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
  // Whether the row NAMES an actor whose authority these two columns describe.
  //
  // Read from the INPUT, not from the resolved id: a caller forcing
  // `actorUserId: null` inside a live impersonation still gets the real human in
  // the column (they are answerable, and there is nowhere else to record them),
  // and the "system" character of that write has to be carried by something. It
  // is carried here — role/scope describe the authorization the caller declined
  // to claim, so they are dropped exactly as they are for a system write outside
  // a session.
  const namesAnActor = input.actorUserId !== null && actorUserId !== null;
  return {
    clientId: input.clientId,
    actorUserId,
    actorRole: namesAnActor ? (attribution.role ?? null) : null,
    scope: namesAnActor ? (attribution.scope ?? null) : null,
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
