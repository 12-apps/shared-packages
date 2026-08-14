/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-random-data --
   the database IS the subject: the retention sweep is raw SQL, so the only test
   worth having runs it against a real Postgres and counts what is left. Each case
   gets its own in-process PGlite. */
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { createAuditRetention } from '@12-apps/audit/server';

import { applyAuditMigrations, auditDb } from '../src/audit-db';

/**
 * The retention sweep against a real Postgres, asking the two questions an
 * adversarial reader asks first: does it delete MORE than its window, and does
 * it reach ANOTHER tenant.
 *
 * This is the only delete path that exists for the trail, so a bug here destroys
 * history nothing can restore. The package's unit suite pins the STATEMENT; this
 * pins what the statement does.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const A = 'tenant-a';
const B = 'tenant-b';

async function seed(
  pg: PGlite,
  rows: { id: string; clientId: string; daysAgo: number }[],
): Promise<void> {
  for (const row of rows) {
    await pg.query(
      `INSERT INTO audit_logs (id, client_id, action, resource_type, resource_id, created_at)
       VALUES ($1, $2, 'lamp.extinguish', 'lamp', $1, $3)`,
      [row.id, row.clientId, new Date(Date.now() - row.daysAgo * DAY_MS)],
    );
  }
}

const remaining = async (pg: PGlite): Promise<string[]> => {
  const { rows } = await pg.query<{ id: string }>('SELECT id FROM audit_logs ORDER BY id');
  return rows.map((row) => row.id);
};

async function withDb<T>(run: (pg: PGlite) => Promise<T>): Promise<T> {
  const pg = new PGlite();
  try {
    await applyAuditMigrations(pg);
    return await run(pg);
  } finally {
    await pg.close();
  }
}

describe('the global floor sweep', () => {
  it('deletes only what is older than the window, across tenants', async () => {
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)), {
        floorDays: 365,
      });
      await seed(pg, [
        { id: 'old-a', clientId: A, daysAgo: 400 },
        { id: 'old-b', clientId: B, daysAgo: 366 },
        { id: 'edge', clientId: A, daysAgo: 364 },
        { id: 'new-a', clientId: A, daysAgo: 1 },
      ]);

      expect(await retention.purgeExpired()).toBe(2);
      expect(await remaining(pg)).toEqual(['edge', 'new-a']);
    });
  });

  it('deletes NOTHING when everything is inside the window', async () => {
    // The sweep runs on a schedule, so "nothing to do" is its most common day.
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)));
      await seed(pg, [{ id: 'new', clientId: A, daysAgo: 3 }]);

      expect(await retention.purgeExpired()).toBe(0);
      expect(await remaining(pg)).toEqual(['new']);
    });
  });

  it('honours a caller window narrower than the floor', async () => {
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)));
      await seed(pg, [
        { id: 'd40', clientId: A, daysAgo: 40 },
        { id: 'd20', clientId: A, daysAgo: 20 },
      ]);

      expect(await retention.purgeExpired(30)).toBe(1);
      expect(await remaining(pg)).toEqual(['d20']);
    });
  });

  it('refuses a window that bounds nothing instead of deleting the whole table', async () => {
    // `0` is the sharp one: it reads as "no retention" and means "keep nothing",
    // because the cutoff lands at `now`. Against a real table that is every row.
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)));
      await seed(pg, [{ id: 'today', clientId: A, daysAgo: 0 }]);
      const refusal = /must be a positive, finite number of days/;

      await expect(retention.purgeExpired(-1)).rejects.toThrow(refusal);
      await expect(retention.purgeExpired(0)).rejects.toThrow(refusal);
      await expect(retention.purgeExpired(Number.NaN)).rejects.toThrow(refusal);
      expect(await remaining(pg)).toEqual(['today']);
    });
  });

  it('refuses the same window at CONSTRUCTION, where a host declares it', async () => {
    // The floor is host CONFIG now, so a value that bounds nothing is a boot
    // failure rather than a sweep that finds out later. Nothing is created, so
    // nothing can run.
    await withDb(async (pg) => {
      const db = () => Promise.resolve(auditDb(pg));
      await seed(pg, [{ id: 'today', clientId: A, daysAgo: 0 }]);

      expect(() => createAuditRetention(db, { floorDays: 0 })).toThrow(/retention\.floorDays/);
      expect(() => createAuditRetention(db, { floorDays: Number.NaN })).toThrow(
        /retention\.floorDays/,
      );
      expect(await remaining(pg)).toEqual(['today']);
    });
  });
});

describe('the per-tenant window sweep', () => {
  it('deletes inside [since, cutoff) for ONE tenant and nothing else', async () => {
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)));
      await seed(pg, [
        // Before the watermark: accumulated under a longer entitlement, so it must
        // survive a shortened window. This is the "downgrade never deletes" rule.
        { id: 'a-before-watermark', clientId: A, daysAgo: 120 },
        // Inside the window and aged past the cutoff: the only prunable row.
        { id: 'a-prunable', clientId: A, daysAgo: 60 },
        // Newer than the cutoff.
        { id: 'a-fresh', clientId: A, daysAgo: 5 },
        // The neighbour, at the same age as the prunable row.
        { id: 'b-same-age', clientId: B, daysAgo: 60 },
      ]);
      const since = new Date(Date.now() - 90 * DAY_MS);
      const cutoff = new Date(Date.now() - 30 * DAY_MS);

      expect(await retention.purgeTenantWindow(A, since, cutoff)).toBe(1);
      expect(await remaining(pg)).toEqual(['a-before-watermark', 'a-fresh', 'b-same-age']);
    });
  });

  it('is a no-op for an empty range, and leaves every row', async () => {
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)));
      await seed(pg, [{ id: 'a1', clientId: A, daysAgo: 60 }]);
      const at = new Date();

      expect(await retention.purgeTenantWindow(A, at, at)).toBe(0);
      expect(await remaining(pg)).toEqual(['a1']);
    });
  });

  it('cannot be pointed at every tenant by omitting the id', async () => {
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)));
      await seed(pg, [{ id: 'a1', clientId: A, daysAgo: 60 }]);

      await expect(
        retention.purgeTenantWindow('', new Date(0), new Date()),
      ).rejects.toThrow(/requires a tenant id/);
      expect(await remaining(pg)).toEqual(['a1']);
    });
  });

  it('treats the bounds as half-open, so a repeated sweep is idempotent', async () => {
    await withDb(async (pg) => {
      const retention = createAuditRetention(() => Promise.resolve(auditDb(pg)));
      await seed(pg, [{ id: 'a1', clientId: A, daysAgo: 60 }]);
      const since = new Date(Date.now() - 90 * DAY_MS);
      const cutoff = new Date(Date.now() - 30 * DAY_MS);

      expect(await retention.purgeTenantWindow(A, since, cutoff)).toBe(1);
      expect(await retention.purgeTenantWindow(A, since, cutoff)).toBe(0);
    });
  });
});
