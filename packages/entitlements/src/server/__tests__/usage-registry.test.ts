// @vitest-environment node
/**
 * The usage registry — the guard rails around "a quota without a counter is
 * worse than no quota". The engine's own missing-port guard cannot fire once
 * a port exists, so the registry is what turns a silently-unlimited ceiling
 * into a loud failure.
 */
import { describe, expect, it, vi } from 'vitest';

import { createUsageRegistry, monthWindowStart } from '../usage-registry';

interface FakeDb {
  rows: number;
}

describe('createUsageRegistry', () => {
  it('counts through the caller-supplied db (a transaction client) when given one', async () => {
    const registry = createUsageRegistry<FakeDb>({
      counters: { 'stations.online': (db) => Promise.resolve(db.rows) },
      getDb: () => ({ rows: 3 }),
    });
    await expect(registry.count('t1', 'stations.online')).resolves.toBe(3);
    await expect(registry.count('t1', 'stations.online', { rows: 9 })).resolves.toBe(9);
  });

  it('THROWS for a quota feature with no counter — never a silent zero', async () => {
    const registry = createUsageRegistry<FakeDb>({ counters: {}, getDb: () => ({ rows: 0 }) });
    await expect(registry.count('t1', 'crew.seats')).rejects.toThrow(/no usage counter/);
  });

  it('answers zero for a retention quota — days, not a count of rows', async () => {
    const counter = vi.fn();
    const registry = createUsageRegistry<FakeDb>({
      counters: { 'readings.retention_days': counter },
      retentionFeatures: ['readings.retention_days', 'archive.bin_days'],
      getDb: () => ({ rows: 0 }),
    });
    await expect(registry.count('t1', 'archive.bin_days')).resolves.toBe(0);
    // Registered AND retention: retention wins, the counter is never asked.
    await expect(registry.count('t1', 'readings.retention_days')).resolves.toBe(0);
    expect(counter).not.toHaveBeenCalled();
  });

  it('refuses to build an engine over a catalog it cannot count', () => {
    const registry = createUsageRegistry<FakeDb>({
      counters: { 'stations.online': (db) => Promise.resolve(db.rows) },
      retentionFeatures: ['readings.retention_days'],
      getDb: () => ({ rows: 0 }),
    });
    expect(() =>
      registry.assertRegistered(['stations.online', 'readings.retention_days']),
    ).not.toThrow();
    expect(() => registry.assertRegistered(['crew.seats'])).toThrow(/crew\.seats/);
  });

  it('exposes the engine port over the same counters', async () => {
    const registry = createUsageRegistry<FakeDb>({
      counters: { 'stations.online': (db) => Promise.resolve(db.rows) },
      getDb: () => ({ rows: 5 }),
    });
    await expect(registry.port.count('t1', 'stations.online')).resolves.toBe(5);
  });
});

describe('monthWindowStart', () => {
  const TZ = 'America/Sao_Paulo';

  it('starts the month at tenant-local midnight, expressed in UTC', () => {
    // 2026-07-30 12:00Z is July in São Paulo (UTC-3): the window starts at
    // July 1st 00:00 local = 03:00Z.
    const start = monthWindowStart(new Date('2026-07-30T12:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-07-01T03:00:00.000Z');
  });

  it("keeps a late-night booking in the tenant's month, not UTC's", () => {
    // 2026-07-01 01:00Z is still June 30th 22:00 in São Paulo — June usage.
    const start = monthWindowStart(new Date('2026-07-01T01:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-06-01T03:00:00.000Z');
  });

  it('is exact at the boundary itself', () => {
    // Exactly local midnight of the 1st: the window starts NOW, not a month ago.
    const start = monthWindowStart(new Date('2026-07-01T03:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-07-01T03:00:00.000Z');
  });

  it('handles a UTC zone without an offset dance', () => {
    const start = monthWindowStart(new Date('2026-07-15T10:00:00Z'), 'UTC');
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});
