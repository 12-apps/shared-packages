/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation,
   test-flakiness/no-global-state-mutation --
   the database IS the subject: these cases apply the PUBLISHED extensions to a
   client over a real Postgres and read the stamped columns back with SELECT.
   Each case gets its own in-process PGlite. */
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  AppendOnlyViolationError,
  applyAppendOnlyGuard,
  applyAuditStamps,
  createAuditWriter,
  runWithActor,
  runWithActorScope,
  setActor,
  type AuditWriteClient,
} from '@12-apps/audit/server';
import { FUTURE_PAY_AUDIT_VOCABULARY, indexVocabulary } from '@12-apps/audit';

import { applyAuditMigrations, auditDb } from '../src/audit-db';

/**
 * The two published Prisma extensions, and the writer, against a REAL database
 * (12-14) — the port of the parts of future-pay's audit integration suites that
 * were about the MECHANISM rather than about its money paths:
 * `audit-log.integration.test.ts`'s append-only and roll-back cases, and the
 * `created_by`/`updated_by` stamping its repository tests relied on.
 *
 * The package's own unit suite pins the extensions' semantics against a fake
 * client. What only a database can show is what this file shows: that the stamped
 * value reaches a COLUMN, that a blocked delete really left the row there, and
 * that a failed audit insert takes the caller's transaction with it.
 *
 * The client below is Prisma-SHAPED rather than Prisma: a generated client needs a
 * schema and a codegen step, which the harness deliberately does not have. What it
 * reproduces faithfully is the contract the extensions depend on — `$extends`
 * composition, `{ model, args, query }` hooks, the delegate names — and everything
 * under it is real SQL.
 */
const index = indexVocabulary(FUTURE_PAY_AUDIT_VOCABULARY);
const TENANT = 'client-1';

interface HookArgs {
  model: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => unknown;
}

type Extension = { name?: string; query: { $allModels: Record<string, (a: HookArgs) => unknown> } };

/** A tracked host model (`products`) plus the package's own table, over PGlite. */
async function client(pg: PGlite) {
  await applyAuditMigrations(pg);
  await pg.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT
    );
  `);
  const db = auditDb(pg);
  const base: Record<string, unknown> = {
    product: {
      async create({ data }: { data: Record<string, unknown> }) {
        await pg.query(
          'INSERT INTO products (id, name, created_by, updated_by) VALUES ($1, $2, $3, $4)',
          [data.id, data.name, data.createdBy ?? null, data.updatedBy ?? null],
        );
        return {};
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        await pg.query('UPDATE products SET name = COALESCE($2, name), updated_by = $3 WHERE id = $1', [
          where.id,
          data.name ?? null,
          data.updatedBy ?? null,
        ]);
        return {};
      },
    },
    auditLog: {
      create: db.auditLog.create,
      update: () => Promise.reject(new Error('reached the database')),
      updateMany: () => Promise.reject(new Error('reached the database')),
      updateManyAndReturn: () => Promise.reject(new Error('reached the database')),
      upsert: () => Promise.reject(new Error('reached the database')),
      delete: () => Promise.reject(new Error('reached the database')),
      deleteMany: () => Promise.reject(new Error('reached the database')),
    },
  };
  base.$extends = function extend(this: Record<string, unknown>, extension: unknown): unknown {
    const hooks = (extension as Extension).query.$allModels;
    const next: Record<string, unknown> = {};
    for (const [key, delegate] of Object.entries(this)) {
      if (key === '$extends') continue;
      const model = key.charAt(0).toUpperCase() + key.slice(1);
      next[key] = Object.fromEntries(
        Object.entries(delegate as Record<string, (a: Record<string, unknown>) => unknown>).map(
          ([operation, inner]) => {
            const hook = hooks[operation];
            return hook
              ? [operation, (args: Record<string, unknown>) => hook({ model, args, query: inner })]
              : [operation, inner];
          },
        ),
      );
    }
    next.$extends = base.$extends;
    return next;
  };
  return base as {
    product: { create(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
    auditLog: AuditWriteClient['auditLog'] & Record<string, (a: unknown) => Promise<unknown>>;
    $extends(extension: unknown): unknown;
  };
}

/** The two extensions, applied the way `extendPrismaClient` applies them. */
const extended = <T>(raw: T): T =>
  applyAppendOnlyGuard(applyAuditStamps(raw, { trackedModels: ['Product'] }), {
    models: ['AuditLog'],
  });

async function withDb<T>(run: (pg: PGlite) => Promise<T>): Promise<T> {
  const pg = new PGlite();
  try {
    return await run(pg);
  } finally {
    await pg.close();
  }
}

describe('created_by / updated_by, in real columns', () => {
  it('stamps both columns from the actor context on a create', async () => {
    await withDb(async (pg) => {
      const prisma = extended(await client(pg));

      await runWithActor('user-7', () =>
        prisma.product.create({ data: { id: 'p1', name: 'Chopp' } }),
      );

      const { rows } = await pg.query<{ created_by: string; updated_by: string }>(
        'SELECT created_by, updated_by FROM products WHERE id = $1',
        ['p1'],
      );
      expect(rows[0]).toEqual({ created_by: 'user-7', updated_by: 'user-7' });
    });
  });

  it('stamps only updated_by on an update, and leaves created_by alone', async () => {
    await withDb(async (pg) => {
      const prisma = extended(await client(pg));
      await runWithActor('author', () =>
        prisma.product.create({ data: { id: 'p1', name: 'Chopp' } }),
      );

      await runWithActor('editor', () =>
        prisma.product.update({ where: { id: 'p1' }, data: { name: 'Chopp claro' } }),
      );

      const { rows } = await pg.query<{ created_by: string; updated_by: string; name: string }>(
        'SELECT created_by, updated_by, name FROM products WHERE id = $1',
        ['p1'],
      );
      expect(rows[0]).toEqual({ created_by: 'author', updated_by: 'editor', name: 'Chopp claro' });
    });
  });

  it('leaves the columns NULL for a write with no actor in scope', async () => {
    await withDb(async (pg) => {
      const prisma = extended(await client(pg));

      await prisma.product.create({ data: { id: 'p1', name: 'Seed' } });

      const { rows } = await pg.query<{ created_by: string | null }>(
        'SELECT created_by FROM products WHERE id = $1',
        ['p1'],
      );
      expect(rows[0]?.created_by).toBeNull();
    });
  });
});

describe('append-only, against the real table', () => {
  it('writes an entry through the writer, and refuses to mutate it afterwards', async () => {
    await withDb(async (pg) => {
      const prisma = extended(await client(pg));
      const audit = createAuditWriter(index);

      await runWithActorScope(async () => {
        setActor('user-7', { role: 'OWNER', scope: TENANT });
        await audit(prisma, {
          clientId: TENANT,
          action: 'order.cancel',
          resourceType: 'order',
          resourceId: 'o1',
          after: { fulfillmentStatus: 'CANCELED' },
        });
      });

      // The row is really in Postgres, with the attribution the context carried.
      const { rows } = await pg.query<{
        actor_user_id: string;
        actor_role: string;
        action: string;
        after: unknown;
      }>('SELECT actor_user_id, actor_role, action, after FROM audit_logs');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_user_id: 'user-7',
        actor_role: 'OWNER',
        action: 'order.cancel',
      });
      expect(rows[0]?.after).toEqual({ fulfillmentStatus: 'CANCELED' });

      // …and every mutating delegate throws BEFORE the database is reached (the
      // delegates under the guard reject with "reached the database" if it is not).
      for (const operation of [
        'update',
        'updateMany',
        'updateManyAndReturn',
        'upsert',
        'delete',
        'deleteMany',
      ]) {
        expect(
          () => prisma.auditLog[operation]?.({ where: {}, data: {}, create: {}, update: {} }),
          operation,
        ).toThrow(AppendOnlyViolationError);
      }

      const after = await pg.query('SELECT id FROM audit_logs');
      expect(after.rows).toHaveLength(1);
    });
  });

  it('is bypassed by RAW SQL — the documented blind spot, and the sweep depends on it', async () => {
    await withDb(async (pg) => {
      const prisma = extended(await client(pg));
      const audit = createAuditWriter(index);
      await audit(prisma, {
        clientId: TENANT,
        action: 'order.cancel',
        resourceType: 'order',
        resourceId: 'o1',
      });

      // Not an assertion that this is GOOD: it is the honest limit ADOPTING.md
      // states, pinned so nobody later claims the guard is a guarantee. A real
      // guarantee is a database privilege or a trigger, and the host owns both.
      await auditDb(pg).$executeRawUnsafe('DELETE FROM audit_logs');

      const { rows } = await pg.query('SELECT id FROM audit_logs');
      expect(rows).toEqual([]);
    });
  });
});

describe('the writer is transactional, not fire-and-forget', () => {
  it('propagates a failed insert so the caller transaction rolls back', async () => {
    // future-pay proved this by renaming the table out from under the writer. Same
    // trick: the mutation and the entry are in ONE transaction, so a broken audit
    // insert must undo the mutation rather than leaving money moved with no trail.
    await withDb(async (pg) => {
      const prisma = extended(await client(pg));
      const audit = createAuditWriter(index);
      await pg.exec('ALTER TABLE audit_logs RENAME TO audit_logs_broken');

      let failed = false;
      try {
        await pg.transaction(async (tx) => {
          await tx.query('INSERT INTO products (id, name) VALUES ($1, $2)', ['p1', 'Chopp']);
          await audit(
            { auditLog: auditDb(tx as unknown as PGlite).auditLog },
            {
              clientId: TENANT,
              action: 'order.cancel',
              resourceType: 'order',
              resourceId: 'o1',
            },
          );
        });
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);
      // The product never landed: one transaction, both or neither.
      const { rows } = await pg.query('SELECT id FROM products');
      expect(rows).toEqual([]);
      await pg.exec('ALTER TABLE audit_logs_broken RENAME TO audit_logs');
    });
  });

  it('commits the entry and the mutation together on the happy path', async () => {
    await withDb(async (pg) => {
      await applyAuditMigrations(pg);
      await pg.exec('CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
      const audit = createAuditWriter(index);

      await pg.transaction(async (tx) => {
        await tx.query('INSERT INTO products (id, name) VALUES ($1, $2)', ['p1', 'Chopp']);
        await audit(
          { auditLog: auditDb(tx as unknown as PGlite).auditLog },
          {
            clientId: TENANT,
            action: 'order.cancel',
            resourceType: 'order',
            resourceId: 'o1',
          },
        );
      });

      expect((await pg.query('SELECT id FROM products')).rows).toHaveLength(1);
      expect((await pg.query('SELECT id FROM audit_logs')).rows).toHaveLength(1);
    });
  });
});
