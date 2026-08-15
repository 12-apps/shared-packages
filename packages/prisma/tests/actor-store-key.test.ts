/* eslint-disable test-flakiness/no-test-isolation --
   the shared mutable state IS the subject: this file tests the `globalThis`
   keys two module copies coordinate through, so seeding and reading those
   globals directly is the behaviour under test, not an isolation leak. The
   order the cases need is stated where it matters (the bridge describe runs
   first, on a pristine global), and the file runs in its own vitest module
   registry, so no other file can observe these writes. */
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, it, vi } from 'vitest';

import { defineAuditVocabulary } from '@12-apps/audit';
import { createApiAudit, type AuditWriteClient } from '@12-apps/audit/server';

import {
  actorContextKey,
  DEFAULT_ACTOR_STORE_KEY,
  declareActorContextKey,
  getActorUserId,
  runWithActor,
  runWithActorScope,
  setActor,
} from '../src/actor-context';
import type { ActorContext } from '../src/actor-context';

/**
 * The actor-store KEY as a contract: the fork failure reproduced, the legacy
 * bridge proven, and the declare seam's rules pinned.
 *
 * This file deliberately does NOT call `declareActorContextKey` on the audit
 * side (the interop suite does, and each vitest file gets its own module
 * registry) — that omission is the first case's whole subject.
 *
 * The 5.0.0 rename made the key a contract change, not a cosmetic one: any
 * party still using the pre-5.0.0 host-branded key — an older copy of this
 * package in the same process, or an audit store declared against the old
 * name — would otherwise get a SECOND AsyncLocalStorage, and the failure is
 * silent (see the fork case below). The bridge in `store()` keeps one
 * instance under both names for one major; these tests are what lets 6.0.0
 * delete it knowingly rather than re-discover why it existed.
 */

/** The pre-5.0.0 key, decoded the same way the source does (brand gates). */
const LEGACY_KEY = atob('X19mdXR1cmVQYXlBY3RvclN0b3Jl');

const globals = globalThis as unknown as Record<string, AsyncLocalStorage<ActorContext> | undefined>;

/** A tx stub exposing just the audit write. */
function makeTx(): { tx: AuditWriteClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  return { tx: { auditLog: { create } } as unknown as AuditWriteClient, create };
}

/** The audit package's writer, bound to a vocabulary of its own. */
function auditWriter() {
  return createApiAudit({
    db: () =>
      Promise.resolve({
        auditLog: {
          create: () => Promise.resolve({}),
          findMany: () => Promise.resolve([]),
          count: () => Promise.resolve(0),
        },
        $executeRawUnsafe: () => Promise.resolve(0),
      }),
    resolveActor: () => null,
    vocabulary: defineAuditVocabulary({
      actions: { 'order.cancel': { label: 'Order cancelled' } },
      resources: { order: { label: 'Order', fields: ['fulfillmentStatus'] } },
    }),
  }).write;
}

const entry = {
  clientId: 'tenant-1',
  action: 'order.cancel',
  resourceType: 'order',
  resourceId: 'order-1',
};

describe('the pre-5.0.0 legacy key bridge', () => {
  // These two run FIRST in the file: the adopt case needs a pristine
  // globalThis (no store yet under either key), and vitest gives each test
  // file its own module registry, so file order is the only order that
  // matters here.
  it('ADOPTS a store an older copy already created under the legacy key', () => {
    // Simulate a pre-5.0.0 copy of this package having initialised first: its
    // store sits under the old branded key and holds nothing yet.
    const older = new AsyncLocalStorage<ActorContext>();
    globals[LEGACY_KEY] = older;
    expect(globals[DEFAULT_ACTOR_STORE_KEY]).toBeUndefined();

    runWithActor('legacy-actor', () => {
      // The stamp went through THIS copy; the older copy's instance sees it,
      // because there is exactly one instance.
      expect(older.getStore()?.userId).toBe('legacy-actor');
    });

    expect(globals[DEFAULT_ACTOR_STORE_KEY]).toBe(older);
  });

  it('MIRRORS a fresh store under the legacy key for an older copy loaded later', () => {
    // The first suite above (or the adopt case) has already created the store;
    // both names must point at the same instance either way.
    runWithActor('any', () => undefined);
    expect(globals[DEFAULT_ACTOR_STORE_KEY]).toBeDefined();
    expect(globals[LEGACY_KEY]).toBe(globals[DEFAULT_ACTOR_STORE_KEY]);
  });
});

describe('the fork failure the key contract exists to prevent', () => {
  it('drops every attribution column SILENTLY when the two packages disagree', async () => {
    // Nothing here declares the shared key, so audit reads its OWN default
    // store — a store nothing ever stamped. This is the exact adopter mistake
    // a key rename can cause: no error, no failed suite, structurally valid
    // rows... with every attribution column NULL, on an append-only table.
    const write = auditWriter();
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor('support-agent', { role: 'SUPERADMIN', scope: 'tenant-1' });
      // This package believes a context is set:
      expect(getActorUserId()).toBe('support-agent');
      await write(tx, entry);
    });

    // ...and the audit row carries none of it. If this case ever starts
    // failing because the packages learned to agree WITHOUT a declaration,
    // delete it consciously — it documents the current contract.
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: null,
        actorRole: null,
        scope: null,
        onBehalfOfUserId: null,
      }),
    });
  });
});

describe('the declare seam', () => {
  it('exports the default key audit is told to adopt', () => {
    expect(DEFAULT_ACTOR_STORE_KEY).toBe('__12appsPrismaActorStore');
    expect(actorContextKey()).toBe(DEFAULT_ACTOR_STORE_KEY);
  });

  it('re-declaring the key in force is a no-op; a blank key is refused', () => {
    expect(() => declareActorContextKey(DEFAULT_ACTOR_STORE_KEY)).not.toThrow();
    expect(() => declareActorContextKey('   ')).toThrow(/must not be blank/);
  });

  it('REFUSES to move the key once the store exists', () => {
    // The store was created by the cases above; moving the key now would fork
    // it — captured contexts keep flowing to the old instance while later
    // reads go elsewhere. Refusal is the contract, same as audit's seam.
    expect(() => declareActorContextKey('__someHostActorStore')).toThrow(/cannot change/);
  });
});
