import { describe, expect, it, vi } from 'vitest';

import { AuditVocabularyError, FUTURE_PAY_AUDIT_VOCABULARY, indexVocabulary } from '../../index';
import { getActorAttribution, runWithActorScope, setActor } from '../actor-context';
import type { AuditWriteClient } from '../db';
import { AuditActorConflictError, createAuditWriter } from '../writer';

/**
 * The audit writer (12-14) — ported from future-pay's
 * `lib/audit/__tests__/audit.test.ts` (actor precedence) and
 * `audit-impersonation.test.ts` (the same invariant through the REAL actor
 * context).
 *
 * Those were two files because the context lived in another package and had to be
 * mocked to test precedence. Here it is the same package, so every case drives the
 * real AsyncLocalStorage context: the join between the two modules — where the bug
 * actually lived — is never stubbed out.
 */
const index = indexVocabulary(FUTURE_PAY_AUDIT_VOCABULARY);
const audit = createAuditWriter(index);

const base = {
  clientId: 'tenant-1',
  action: 'order.cancel',
  resourceType: 'order',
  resourceId: 'order-1',
};

/** A tx stub exposing just the audit write (pass a custom fn to force failure). */
function makeTx(create = vi.fn().mockResolvedValue({})): {
  tx: AuditWriteClient;
  create: ReturnType<typeof vi.fn>;
} {
  return { tx: { auditLog: { create } } as unknown as AuditWriteClient, create };
}

const REAL = 'support-agent';
const TARGET = 'shop-owner';

/** What an impersonation-aware guard stamps once the session is resolved. */
const stampImpersonatedSession = (): void =>
  setActor(REAL, { role: 'OWNER', scope: 'tenant-1', onBehalfOfUserId: TARGET });

/** What a route body does straight afterwards, unaware of the session. */
const routeBodyStampsItsOwnGrant = (): void =>
  setActor(TARGET, { role: 'OWNER', scope: 'tenant-1' });

describe('actor precedence', () => {
  it('defaults the actor from the request context', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor('user-7');
      await audit(tx, { ...base, after: { fulfillmentStatus: 'CANCELED' } });
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        clientId: 'tenant-1',
        actorUserId: 'user-7',
        actorRole: null,
        scope: null,
        onBehalfOfUserId: null,
        action: 'order.cancel',
        resourceType: 'order',
        resourceId: 'order-1',
        before: {},
        after: { fulfillmentStatus: 'CANCELED' },
        requestId: null,
      },
    });
  });

  it('stamps the role/scope the request was authorized under', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor('user-7', { role: 'ADMIN', scope: 'tenant-1' });
      await audit(tx, base);
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-7',
        actorRole: 'ADMIN',
        scope: 'tenant-1',
      }),
    });
  });

  it('suppresses attribution on a SYSTEM write even when the context has one', async () => {
    // A webhook forcing `actorUserId: null` must not inherit a stale role/scope —
    // an entry either names its actor fully, or is system.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor('user-7', { role: 'ADMIN', scope: 'tenant-1' });
      await audit(tx, { ...base, actorUserId: null });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: null, actorRole: null, scope: null }),
    });
  });

  it('is NULL-actor (system) when no context is set', async () => {
    const { tx, create } = makeTx();

    await audit(tx, base);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: null }),
    });
  });

  it('propagates a failed write — the caller transaction must roll back', async () => {
    const { tx } = makeTx(vi.fn().mockRejectedValue(new Error('insert failed')));

    await expect(audit(tx, base)).rejects.toThrow('insert failed');
  });

  it('refuses an action the vocabulary does not declare', async () => {
    // Unknown actions pass redaction untouched and land as rows no filter can
    // select and no viewer can label. The throw happens inside the caller's
    // transaction, so nothing commits.
    const { tx, create } = makeTx();

    await expect(audit(tx, { ...base, action: 'order.vanish' })).rejects.toThrow(
      AuditVocabularyError,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * The impersonation half. The feature is only defensible if the trail can answer
 * "who really did this" and "who did the screen claim to be" independently, so
 * these cases pin the two ids APART rather than merely asserting the column is
 * populated.
 */
describe('impersonation attribution', () => {
  it('stores a NULL impersonation on an ordinary write', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor('user-7', { role: 'ADMIN', scope: 'tenant-1' });
      await audit(tx, base);
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: 'user-7', onBehalfOfUserId: null }),
    });
  });

  it('records the real human and the impersonated identity as two distinct ids', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      await audit(tx, base);
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: REAL,
        onBehalfOfUserId: TARGET,
        // The authorization attribution resolves for the TARGET while
        // impersonating (permissions never union), which is exactly why it cannot
        // double as the "who".
        actorRole: 'OWNER',
        scope: 'tenant-1',
      }),
    });
  });

  it('keeps the real human as the actor after a route body re-stamps the grant', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      routeBodyStampsItsOwnGrant();
      await audit(tx, { ...base, after: { fulfillmentStatus: 'CANCELED' } });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: REAL, onBehalfOfUserId: TARGET }),
    });
  });

  it('refuses an explicit actorUserId that names the impersonated subject', async () => {
    // The shape a caller reaches by accident: an id read off a row the guard
    // loaded for the effective subject, handed over as "the actor" in good faith.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      routeBodyStampsItsOwnGrant();
      await audit(tx, { ...base, actorUserId: TARGET });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: REAL, onBehalfOfUserId: TARGET }),
    });
  });

  it('REFUSES an explicit actorUserId naming a third party mid-session', async () => {
    // The legitimate pattern outside a session — `audit(tx, { actorUserId:
    // shift.userId })`, attributing an entry to the owner of the row it changed —
    // destroys the trail inside one: the row would read "closing-cook, on behalf
    // of shop-owner", and the support agent who actually force-closed the comanda
    // is unrecoverable on an append-only table. There is no third column for
    // them, so the write is refused rather than reinterpreted: the caller is one
    // field from being right, and silently moving their id would hide the bug.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      await expect(audit(tx, { ...base, actorUserId: 'closing-cook' })).rejects.toThrow(
        AuditActorConflictError,
      );
    });

    // Thrown before the insert, and inside the caller's transaction — so the
    // mutation it described rolls back with it.
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the override outside a session, including a third party', async () => {
    // The affordance the rule above narrows, and only there: with no session live
    // there is no real human to erase, so a caller may still name whoever owns
    // the row it changed.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor('user-7', { role: 'ADMIN', scope: 'tenant-1' });
      await audit(tx, { ...base, actorUserId: 'closing-cook' });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: 'closing-cook', onBehalfOfUserId: null }),
    });
  });

  it('accepts an explicit actorUserId that already names the real human', async () => {
    // Same rule, seen from the caller who got it right: naming the real human is
    // a no-op rather than a conflict.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      await audit(tx, { ...base, actorUserId: REAL });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: REAL,
        actorRole: 'OWNER',
        scope: 'tenant-1',
        onBehalfOfUserId: TARGET,
      }),
    });
  });

  it('never lets the impersonated identity replace the real actor', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor(REAL, { onBehalfOfUserId: TARGET });
      await audit(tx, { ...base, after: { fulfillmentStatus: 'CANCELED' } });
    });

    // Exact match, not `objectContaining`: the point is that adding the second
    // name changed nothing else about the row — least of all the first name.
    expect(create).toHaveBeenCalledWith({
      data: {
        clientId: 'tenant-1',
        actorUserId: REAL,
        actorRole: null,
        scope: null,
        onBehalfOfUserId: TARGET,
        action: 'order.cancel',
        resourceType: 'order',
        resourceId: 'order-1',
        before: {},
        after: { fulfillmentStatus: 'CANCELED' },
        requestId: null,
      },
    });
  });

  it('keeps the real human on a forced SYSTEM write, and still drops role/scope', async () => {
    // A forced `actorUserId: null` inside a live session cannot make the write
    // authorless: a human IS driving it, they are answerable, and no other column
    // can hold them. So the real human stays in `actor_user_id` — and the
    // "system" character of the write is carried by the DROPPED role/scope
    // instead, which is what the caller actually declined to claim.
    //
    // The impersonation survives too, which is the deliberate asymmetry: gate
    // that field the same way and any helper hard-coding `actorUserId: null`
    // launders the session out of an append-only trail.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      await audit(tx, { ...base, actorUserId: null });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: REAL,
        actorRole: null,
        scope: null,
        onBehalfOfUserId: TARGET,
      }),
    });
  });

  it('takes an explicit impersonation override ahead of the context', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      await audit(tx, { ...base, onBehalfOfUserId: 'other-target' });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: REAL, onBehalfOfUserId: 'other-target' }),
    });
  });

  it('lets an explicit null state that no impersonation applies', async () => {
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      await audit(tx, { ...base, onBehalfOfUserId: null });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: REAL, onBehalfOfUserId: null }),
    });
  });

  it('still refuses the subject as actor when the caller nulls the column', async () => {
    // The two overrides are independent. Saying "no impersonation applies to this
    // entry" is a claim about the ROW; whether the request runs inside an
    // impersonated session is a fact about the SESSION, and it is the fact that
    // decides whether naming the subject is a lie.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      routeBodyStampsItsOwnGrant();
      await audit(tx, { ...base, actorUserId: TARGET, onBehalfOfUserId: null });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: REAL, onBehalfOfUserId: null }),
    });
  });

  it('reads as the real human again once the session ends mid-request', async () => {
    // Ending an impersonation clears both halves, so the writes that follow are
    // ordinary ones — the property that makes the request which STOPS a session
    // attributable to nobody but the admin.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      stampImpersonatedSession();
      setActor(REAL, { onBehalfOfUserId: null });
      await audit(tx, base);
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: REAL, onBehalfOfUserId: null }),
    });
  });

  it('records a declared subject WITHOUT letting it become the actor', async () => {
    // The writer treats a session as impersonated only when BOTH halves are
    // present, and falls back to the ordinary path otherwise — inventing an actor
    // from the stamped id is what this whole guard exists to stop. That fallback is
    // defence in depth: the pair cannot be half-populated through the public API,
    // because declaring a subject always records the real human in the same call.
    // What IS reachable is this — an entry-level `onBehalfOfUserId` on an ordinary
    // request — and it must record the declaration while leaving the actor alone.
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor('user-7');
      expect(getActorAttribution().realUserId).toBeUndefined();
      await audit(tx, { ...base, onBehalfOfUserId: TARGET });
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: 'user-7', onBehalfOfUserId: TARGET }),
    });
  });
});
