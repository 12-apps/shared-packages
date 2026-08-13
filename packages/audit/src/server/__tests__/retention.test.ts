/* eslint-disable test-flakiness/no-random-data --
   `Date.now()` is the SUBJECT: the sweep computes its cutoff from the current
   instant, so a case pinning "the cutoff is one window in the past" has to read
   the same clock. The assertions are range comparisons, never equality against a
   captured timestamp. */
import { describe, expect, it } from 'vitest';

import { createAuditRetention } from '../retention';

import { fakeAuditDb } from './fake-db';

/**
 * The retention sweep (12-14) — the ONLY sanctioned delete path, and therefore
 * the one place a bug deletes history that cannot be recovered.
 *
 * These cases pin the STATEMENT: which predicate, which bounds, which values
 * bound as parameters. That the statement then deletes exactly those rows is
 * proven against real Postgres in `harness/backend/tests/audit-retention.test.ts`
 * — a fake cannot tell you what SQL does, and asserting the SQL is what tells you
 * the fake and the database were asked the same thing.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

describe('the global floor', () => {
  it('defaults to 365 days and deletes only what is older', async () => {
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db));

    const before = Date.now();
    await retention.purgeExpired();

    expect(retention.floorDays).toBe(365);
    expect(fake.raw).toHaveLength(1);
    const [statement] = fake.raw;
    expect(statement?.sql).toBe('DELETE FROM "audit_logs" WHERE "created_at" < $1');
    const cutoff = statement?.values[0] as Date;
    // One cutoff, one bound, in the past by exactly the window.
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 365 * DAY_MS);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - 365 * DAY_MS);
  });

  it('takes a caller window and binds the cutoff as a PARAMETER', async () => {
    // Never interpolated: a date is the only value here, and the difference
    // between a bound parameter and a formatted string is the difference between a
    // sweep and an injection point.
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db));

    await retention.purgeExpired(30);

    expect(fake.raw[0]?.values).toHaveLength(1);
    expect(fake.raw[0]?.values[0]).toBeInstanceOf(Date);
    expect(fake.raw[0]?.sql).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('REFUSES a negative window instead of deleting everything', async () => {
    // A negative window puts the cutoff in the FUTURE, so the predicate matches
    // every row including the ones written seconds ago. On an append-only table
    // there is nothing to undo it with.
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db));

    await expect(retention.purgeExpired(-1)).rejects.toThrow(/Invalid retention window/);
    await expect(retention.purgeExpired(Number.NaN)).rejects.toThrow(/Invalid retention window/);
    expect(fake.raw).toEqual([]);
  });

  it('honours a host floor', async () => {
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db), { floorDays: 90 });

    expect(retention.floorDays).toBe(90);
    await retention.purgeExpired();
    const cutoff = fake.raw[0]?.values[0] as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(90 * DAY_MS - 1000);
  });
});

describe('the per-tenant window', () => {
  it('bounds the delete by tenant AND by both ends of the range', async () => {
    // The lower bound is the "downgrade never deletes" rule: rows written before
    // the current window took effect were accumulated under a longer entitlement.
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db));
    const since = new Date('2026-01-01T00:00:00Z');
    const cutoff = new Date('2026-06-01T00:00:00Z');

    await retention.purgeTenantWindow('client-1', since, cutoff);

    expect(fake.raw[0]).toEqual({
      sql:
        'DELETE FROM "audit_logs" WHERE "client_id" = $1 AND "created_at" >= $2 ' +
        'AND "created_at" < $3',
      values: ['client-1', since, cutoff],
    });
  });

  it('is a NO-OP for an empty or inverted range', async () => {
    // A caller computing `[watermark, now - window)` legitimately gets an empty
    // range for the first `window` days after the window changed. Throwing would
    // push a "did I get a real range?" check into every caller; sweeping would
    // delete the wrong side of the watermark.
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db));
    const at = new Date('2026-06-01T00:00:00Z');

    expect(await retention.purgeTenantWindow('client-1', at, at)).toBe(0);
    expect(await retention.purgeTenantWindow('client-1', at, new Date('2026-01-01Z'))).toBe(0);
    expect(fake.raw).toEqual([]);
  });

  it('refuses a missing tenant id rather than sweeping every tenant', async () => {
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db));

    await expect(
      retention.purgeTenantWindow('', new Date(0), new Date()),
    ).rejects.toThrow(/requires a tenant id/);
    expect(fake.raw).toEqual([]);
  });
});

describe('the table name', () => {
  it('is validated at CONSTRUCTION, not at sweep time', async () => {
    // The one identifier that cannot be a bound parameter, so it is the one thing
    // that must be checked. A host that mistyped it should find out when it wires
    // the surface, not months later when the first sweep runs.
    expect(() =>
      createAuditRetention(() => Promise.resolve(fakeAuditDb().db), {
        table: 'audit_logs"; DROP TABLE clients; --',
      }),
    ).toThrow(/Invalid audit table name/);
  });

  it('accepts a plain host table name', async () => {
    const fake = fakeAuditDb();
    const retention = createAuditRetention(() => Promise.resolve(fake.db), {
      table: 'app_audit_entries',
    });

    await retention.purgeExpired(10);

    expect(fake.raw[0]?.sql).toContain('"app_audit_entries"');
  });
});
