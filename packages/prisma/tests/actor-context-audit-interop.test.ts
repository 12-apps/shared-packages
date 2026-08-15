import { describe, expect, it, vi } from 'vitest';

import { defineAuditVocabulary } from '@12-apps/audit';
import {
  createApiAudit,
  getActorAttribution as auditGetActorAttribution,
  runWithActorScope as auditRunWithActorScope,
  setActor as auditSetActor,
  declareActorContextKey,
  type AuditWriteClient,
} from '@12-apps/audit/server';

import {
  DEFAULT_ACTOR_STORE_KEY,
  getActorAttribution,
  getActorUserId,
  runWithActor,
  runWithActorScope,
  setActor,
} from '../src/actor-context';

/**
 * ONE actor context, two packages.
 *
 * `@12-apps/audit/server` ships its own copy of this module — the port that will
 * eventually replace this one — and both copies keep their AsyncLocalStorage
 * instance on `globalThis` so a hot reload cannot fork it. That makes the GLOBAL
 * KEY a cross-package contract rather than an implementation detail, and it is
 * the one difference between the copies that is not cosmetic.
 *
 * As of `@12-apps/audit@2.0.0` that key is CONFIG rather than a literal compiled
 * into the shared package. It used to be this package's key, hard-coded there —
 * one host's vocabulary shipping as another package's constant, which is exactly
 * what that release removed. A host (or, here, a test) that needs the two
 * modules on ONE store declares it, ONCE, before anything stamps an actor:
 * `declareActorContextKey(...)` below.
 *
 * What breaks if they diverge, and why nothing else would catch it: a host keeps
 * its existing `setActor(...)` call sites (imported from `@12-apps/prisma`) and
 * routes its audit WRITES through `@12-apps/audit`'s `write()`, as that
 * package's ADOPTING.md rule 3 tells it to. The writer then reads a store
 * nothing ever stamped: every row lands with `actor_user_id`, `actor_role`,
 * `scope` and `on_behalf_of_user_id` NULL, the viewer renders the system label
 * for every human action, and `audit_logs` is append-only — so the attribution
 * is gone for good. The rows are structurally valid and no suite fails, because
 * each package's own tests stamp through their own store.
 *
 * Hence this file, which is deliberately the ONLY test in either package that
 * imports both copies: it drives one and asserts through the other, in both
 * directions, so a break in the sharing fails here instead of at a host's
 * adoption. The de-duplication (one module, one package) is a later PR; until
 * then, interoperability is the property under test.
 */
// The declaration a host makes, at module scope so it runs before any case
// stamps an actor — moving the key after the store exists is refused, which is
// the guard that keeps this from being a way to fork the store rather than share
// it. The key is THIS package's, imported as the constant it now exports so the
// contract cannot drift into a retyped literal; the audit package does not know
// it. (`tests/actor-store-key.test.ts` proves what happens when a host SKIPS
// this line — that is the failure this declaration exists to prevent.)
declareActorContextKey(DEFAULT_ACTOR_STORE_KEY);
const REAL = 'support-agent';
const TARGET = 'shop-owner';

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

describe('the two actor-context copies share one store', () => {
  it('lets @12-apps/audit read an attribution THIS package stamped', async () => {
    // The sharp direction, and the silent one: the host stamps through the import
    // it already has (this package) and writes through the new one.
    const write = auditWriter();
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor(REAL, { role: 'SUPERADMIN', scope: 'tenant-1', onBehalfOfUserId: TARGET });
      await write(tx, entry);
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        // Not NULL — which is what a forked store would have produced, on an
        // append-only row that renders as "Sistema" forever.
        actorUserId: REAL,
        actorRole: 'SUPERADMIN',
        scope: 'tenant-1',
        onBehalfOfUserId: TARGET,
      }),
    });
  });

  it('carries a runWithActor scope from this package into the audit writer', async () => {
    // The other constructor: background work (a job, a script) enters the context
    // through `runWithActor` rather than through a request boundary.
    const write = auditWriter();
    const { tx, create } = makeTx();

    await runWithActor('cron-1', async () => write(tx, entry), { role: 'SYSTEM' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: 'cron-1', actorRole: 'SYSTEM' }),
    });
  });

  it('lets THIS package read an attribution @12-apps/audit stamped', async () => {
    // The reverse: a host that mounts the audit package's middleware and keeps
    // this package's `created_by`/`updated_by` extension, which reads
    // `getActorUserId()` from here.
    await auditRunWithActorScope(async () => {
      auditSetActor(REAL, { role: 'OWNER', scope: 'tenant-1', onBehalfOfUserId: TARGET });

      expect(getActorUserId()).toBe(REAL);
      expect(getActorAttribution()).toEqual({
        role: 'OWNER',
        scope: 'tenant-1',
        onBehalfOfUserId: TARGET,
        realUserId: REAL,
      });
    });
  });

  it('lets a stamp from either copy be observed by the other, mid-scope', async () => {
    // Merge semantics, across the seam: a guard from one copy and a route body
    // from the other must mutate the SAME context object, or the last writer
    // silently wins in only one of the two readers.
    await runWithActorScope(async () => {
      setActor(REAL, { role: 'SUPERADMIN', onBehalfOfUserId: TARGET });
      // The route-body pattern, through the other copy: it moves `userId` and must
      // leave the pair standing.
      auditSetActor(TARGET, { role: 'OWNER' });

      expect(getActorUserId()).toBe(TARGET);
      expect(auditGetActorAttribution()).toEqual({
        role: 'OWNER',
        scope: undefined,
        onBehalfOfUserId: TARGET,
        realUserId: REAL,
      });
    });
  });

  it('keeps a realUserId forged through THIS copy inert in the audit writer', async () => {
    // This copy builds its fresh context with a spread, so an attribution literal
    // carrying its own `realUserId` survives when no impersonation is declared —
    // the audit copy copies field by field and does not. Sharing the store must
    // not import that weakness: the writer treats a session as impersonated only
    // when BOTH halves are present, so a lone forged `realUserId` names nobody.
    const write = auditWriter();
    const { tx, create } = makeTx();

    await runWithActorScope(async () => {
      setActor(REAL, { realUserId: 'somebody-else' } as never);
      await write(tx, entry);
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: REAL, onBehalfOfUserId: null }),
    });
  });
});
