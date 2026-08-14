/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject of the lease half: the suite
   reads the migration OUT OF THE PUBLISHED TARBALL and runs it on a real
   Postgres, because the claim's whole design is that the database decides the
   winner. Mocking either would race two holders against a fixture instead of
   the artifact. Fresh in-process PGlite per suite, no shared state. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import {
  clearJobs,
  createSweepLease,
  defineJob,
  enqueueJob,
  resetJobRuntime,
  type RegisteredJob,
  type SweepLeaseDb,
} from '@12-apps/jobs';
import { createApiJobs } from '@12-apps/jobs/server';
import { jobsRouter } from '@12-apps/jobs/hono';

/**
 * The published runtime, driven the way a consumer drives it: `createApiJobs`
 * out of the tarball, mounted with the packaged Hono adapter, and the sweep
 * lease claiming against a real Postgres that ran the packaged migration.
 *
 * The zero-config case is the one this ticket exists to keep true: a host
 * with NO Redis and NO driver config must start green on the inline driver,
 * run an enqueued handler in-process, and answer 200 on /health.
 */

/** The environment a fresh host boots in: nothing configured. */
function stubBareEnv(): void {
  vi.stubEnv('REDIS_URL', '');
  vi.stubEnv('JOBS_DRIVER', '');
  vi.stubEnv('JOBS_WORKER', '');
  vi.stubEnv('NODE_ENV', 'development');
}

afterEach(() => {
  resetJobRuntime();
  clearJobs();
  vi.unstubAllEnvs();
});

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * One declared job — the minimum a host may mount the package with.
 *
 * `jobs: []` used to stand in for "this case is about something else", and it
 * is exactly what the published factory now refuses at assembly: a process
 * that declares nothing consumes no queue, installs no schedule and still
 * answers /health with `ok`. Passing one job is also what a real host does.
 */
function oneJob(name = 'harness.declared'): RegisteredJob<never>[] {
  return [defineJob({ name, handle: async () => undefined }) as RegisteredJob<never>];
}

describe('createApiJobs — zero config, no Redis', () => {
  it('starts green on the inline driver and runs a handler in-process', async () => {
    stubBareEnv();
    const gate: { open?: (value: string) => void } = {};
    const handled = new Promise<string>((resolve) => {
      gate.open = resolve;
    });
    const job = defineJob<{ id: string }>({
      name: 'harness.echo',
      handle: async ({ id }) => {
        gate.open?.(id);
      },
    });

    const api = createApiJobs({ jobs: [job], logger: silent });
    await api.start();

    const result = await job.enqueue({ id: 'from-harness' });
    expect(result.enqueued).toBe(true);
    await expect(handled).resolves.toBe('from-harness');
  });

  it('serves 200 ok from /health through the packaged Hono adapter', async () => {
    stubBareEnv();
    const api = createApiJobs({ jobs: oneJob(), logger: silent });
    await api.start();

    // The one-call mount a host writes.
    const app = new Hono();
    app.route('/api/internal/jobs', jobsRouter(api));

    const response = await app.request('/api/internal/jobs/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      checks: { driver: string; worker: boolean };
    };
    expect(body.status).toBe('ok');
    expect(body.checks.driver).toBe('inline');
    expect(body.checks.worker).toBe(false);
  });

  it('reports degraded (503) when production has no queue', async () => {
    stubBareEnv();
    const api = createApiJobs({ jobs: oneJob(), logger: silent, production: true });
    await api.start();

    const app = new Hono();
    app.route('/api/internal/jobs', jobsRouter(api));

    const response = await app.request('/api/internal/jobs/health');
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string; checks: { driver: null } };
    expect(body.status).toBe('degraded');
    expect(body.checks.driver).toBeNull();
  });
});

/**
 * The refusals, driven out of the PUBLISHED tarball rather than the source.
 *
 * Each one guards a state that looks healthy: a process that declares no jobs
 * probes green while every schedule in the deployment has stopped, and an
 * enqueue nobody can consume reports success and dead-letters minutes later.
 * A consumer must inherit those guards from the package it installed, which is
 * what this suite — and only this suite — actually proves.
 */
describe('the published package refuses what would fail silently', () => {
  it('refuses an empty `jobs` at the factory, before start() is reached', () => {
    stubBareEnv();

    expect(() => createApiJobs({ jobs: [], logger: silent })).toThrow(
      /declares no work/,
    );
  });

  it('refuses a thunk that registers nothing, at start()', async () => {
    stubBareEnv();
    const api = createApiJobs({ jobs: () => undefined, logger: silent });

    await expect(api.start()).rejects.toThrow(/no jobs are registered/);

    // And the probe reports the failed boot rather than a green empty runtime.
    const app = new Hono().route('/api/internal/jobs', jobsRouter(api));
    const response = await app.request('/api/internal/jobs/health');
    expect(response.status).toBe(503);
  });

  it('refuses a definition whose cron pattern would never fire', () => {
    expect(() =>
      defineJob({
        name: 'harness.never',
        schedule: { pattern: '@daily' },
        handle: async () => undefined,
      }),
    ).toThrow(/schedule.pattern/);
  });

  it('refuses an enqueue of a job the registry does not hold', async () => {
    stubBareEnv();
    const api = createApiJobs({ jobs: oneJob(), logger: silent });
    await api.start();

    // Same name as a registered job, different object: the payload would reach
    // a handler that never agreed to it, so identity is what the gate checks.
    await expect(
      enqueueJob(
        { name: 'harness.declared', handle: () => Promise.resolve() },
        { spoofed: true },
        {},
      ),
    ).resolves.toEqual({ enqueued: false, reason: 'unregistered' });
  });
});

/**
 * The lease over a REAL Postgres carrying the PACKAGED migration. The unit
 * suite pins the statement shapes; this pins the thing the shapes exist for —
 * that the database actually arbitrates between two racing holders.
 */
describe('createSweepLease — against the shipped sweep_leases table', () => {
  let pg: PGlite;
  let db: () => Promise<SweepLeaseDb>;

  /** A Prisma-shaped delegate over PGlite — what a non-Prisma host writes. */
  function pgSweepLeaseDb(target: PGlite): SweepLeaseDb {
    return {
      sweepLease: {
        async updateMany({ where, data }) {
          const params: unknown[] = [];
          const bind = (value: unknown): string => {
            params.push(value);
            return `$${params.length}`;
          };
          const sets: string[] = [];
          if (data.holder !== undefined) sets.push(`"holder" = ${bind(data.holder)}`);
          if (data.acquiredAt !== undefined) sets.push(`"acquired_at" = ${bind(data.acquiredAt)}`);
          sets.push(`"expires_at" = ${bind(data.expiresAt)}`);
          const conditions = [`"name" = ${bind(where.name)}`];
          if (where.expiresAt !== undefined) {
            conditions.push(`"expires_at" <= ${bind(where.expiresAt.lte)}`);
          }
          if (where.holder !== undefined) conditions.push(`"holder" = ${bind(where.holder)}`);
          const result = await target.query(
            `UPDATE "sweep_leases" SET ${sets.join(', ')} WHERE ${conditions.join(' AND ')}`,
            params,
          );
          return { count: result.affectedRows ?? 0 };
        },
        async create({ data }) {
          try {
            await target.query(
              'INSERT INTO "sweep_leases" ("name", "holder", "acquired_at", "expires_at") VALUES ($1, $2, $3, $4)',
              [data.name, data.holder, data.acquiredAt, data.expiresAt],
            );
            return {};
          } catch (error) {
            if (String(error).includes('duplicate key')) {
              // The seam's one contract: a lost race reads as Prisma's P2002.
              throw Object.assign(new Error('sweep_leases primary key violation'), {
                code: 'P2002',
              });
            }
            throw error;
          }
        },
      },
    };
  }

  beforeAll(async () => {
    pg = new PGlite();
    const migrationsDir = fileURLToPath(
      new URL('../node_modules/@12-apps/jobs/prisma/migrations', import.meta.url),
    );
    const names = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      await pg.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
    }
    db = async () => pgSweepLeaseDb(pg);
  });

  afterAll(async () => {
    await pg.close();
  });

  it('lets exactly one of two workers run, and frees the lease afterwards', async () => {
    const workerA = createSweepLease({ db, holder: 'worker-a' });
    const workerB = createSweepLease({ db, holder: 'worker-b' });

    const outcome = await workerA.withSweepLease('harness.sweep', 60_000, async () => {
      // While A holds the lease, B's pass must do nothing.
      const inner = await workerB.withSweepLease('harness.sweep', 60_000, async () => 'b');
      expect(inner).toEqual({ ran: false, result: null });
      return 'a';
    });
    expect(outcome).toEqual({ ran: true, result: 'a' });

    // A released on the way out, so the next tick — whoever runs it — claims.
    const next = await workerB.withSweepLease('harness.sweep', 60_000, async () => 'b');
    expect(next).toEqual({ ran: true, result: 'b' });
  });

  it('treats an expired holder as dead and lets the next worker claim', async () => {
    const crashed = createSweepLease({ db, holder: 'crashed-worker' });
    const healthy = createSweepLease({ db, holder: 'healthy-worker' });

    // A non-positive TTL makes the lease expired the instant it is taken —
    // the deterministic stand-in for a holder that overran and died.
    await crashed.withSweepLease('harness.recovery', -1, async () => {
      const inner = await healthy.withSweepLease('harness.recovery', 60_000, async () => 'took over');
      expect(inner).toEqual({ ran: true, result: 'took over' });
      return 'stale';
    });
  });

  it('releases the lease when the sweep throws, so one bad pass costs one tick', async () => {
    const workerA = createSweepLease({ db, holder: 'thrower' });
    const workerB = createSweepLease({ db, holder: 'successor' });

    await expect(
      workerA.withSweepLease('harness.faulty', 60_000, async () => {
        throw new Error('sweep blew up');
      }),
    ).rejects.toThrow('sweep blew up');

    const next = await workerB.withSweepLease('harness.faulty', 60_000, async () => 'recovered');
    expect(next).toEqual({ ran: true, result: 'recovered' });
  });

  it('surfaces a missing lease table instead of skipping silently', async () => {
    const isolated = new PGlite(); // no migration ran here
    try {
      const lease = createSweepLease({
        db: async () => pgSweepLeaseDb(isolated),
        holder: 'no-table',
      });
      const work = vi.fn();
      await expect(lease.withSweepLease('harness.no-table', 60_000, work)).rejects.toThrow(
        /sweep_leases/,
      );
      expect(work).not.toHaveBeenCalled();
    } finally {
      await isolated.close();
    }
  });

  it('binds the same lease through createApiJobs({ db })', async () => {
    stubBareEnv();
    const api = createApiJobs({ jobs: oneJob(), logger: silent, db });
    await api.start();

    const held = createSweepLease({ db, holder: 'other-worker' });
    const outcome = await held.withSweepLease('harness.bound', 60_000, async () => {
      const inner = await api.withSweepLease('harness.bound', 60_000, async () => 'api');
      expect(inner).toEqual({ ran: false, result: null });
      return 'held';
    });
    expect(outcome.ran).toBe(true);
  });
});
