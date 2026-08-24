import { describe, expect, it } from 'vitest';

import { AUDIT_JOBS, type AuditJobDeps, type AuditRetentionRange } from '../jobs';

/**
 * The retention sweep as a bound job.
 *
 * `retention.test.ts` covers what the two predicates delete; this covers the
 * BLUEPRINT around them — which is the half a host used to write, and the half
 * that decides whether a delete pass runs at all and over what.
 *
 * The first case is the one that matters most: it is the property whose absence
 * made the first version of `AuditJobDeps` unbindable by any real host.
 */

interface Recorded {
  floor: number[];
  windows: AuditRetentionRange[];
  logs: string[];
}

/** A context per case — the flakiness lane refuses shared mutable test state. */
function context(recorded: Recorded) {
  return {
    runId: 'run-1',
    attempt: 1,
    maxAttempts: 1,
    logger: {
      info: (message: string) => recorded.logs.push(message),
      warn: (message: string) => recorded.logs.push(message),
      error: (message: string) => recorded.logs.push(message),
    },
  };
}

function blank(): Recorded {
  return { floor: [], windows: [], logs: [] };
}

/** What a host's mounted api offers, built AFTER the bindings are written. */
function lateApi(recorded: Recorded, removes: number) {
  return {
    retention: {
      floorDays: 365,
      purgeExpired: (days?: number) => {
        recorded.floor.push(days ?? 365);
        return Promise.resolve(removes);
      },
      purgeTenantWindow: (clientId: string, since: Date, cutoff: Date) => {
        recorded.windows.push({ clientId, since, cutoff });
        return Promise.resolve(1);
      },
    },
  };
}

const sweep = () => AUDIT_JOBS.blueprints.retention;

describe('the retention blueprint', () => {
  it('binds against an api that does not exist yet — the deferred case', async () => {
    // The ordering every wiring host has: `adoptServer` TAKES the bindings and
    // the mounted api comes out the other side, so deps written at binding time
    // cannot hold the api. The first version of `AuditJobDeps` asked for the
    // whole retention OBJECT and was therefore unbindable by any real host;
    // narrowing it to the two methods is what lets a host pass arrows that
    // reach for the api when the sweep runs. This case is that property.
    const recorded = blank();
    // A CONTAINER rather than a reassigned binding: that is this repo's rule
    // for mutable test state, and it models the real thing more honestly —
    // the host holds a mount slot that the adoption fills in later.
    const mount: { api?: ReturnType<typeof lateApi> } = {};

    const deps: AuditJobDeps = {
      retention: {
        purgeExpired: (days) => {
          if (!mount.api) throw new Error('the sweep ran before the api existed');
          return mount.api.retention.purgeExpired(days);
        },
        purgeTenantWindow: (clientId, since, cutoff) => {
          if (!mount.api) throw new Error('the sweep ran before the api existed');
          return mount.api.retention.purgeTenantWindow(clientId, since, cutoff);
        },
      },
    };

    // Only now does the mount exist — exactly as `adoptServer` returns it.
    mount.api = lateApi(recorded, 3);

    await sweep().handle(undefined as never, deps, context(recorded));
    expect(recorded.floor).toEqual([365]);
  });

  it('sweeps the global floor and NOTHING else when no windows are supplied', async () => {
    // The fail-safe direction. Who decides a tenant's window is a billing
    // question a package cannot answer, so a host with no plan resolver omits
    // `tenantWindows` — and must get the floor alone rather than a guess.
    const recorded = blank();
    const api = lateApi(recorded, 2);
    const deps: AuditJobDeps = { retention: api.retention };

    await sweep().handle(undefined as never, deps, context(recorded));

    expect(recorded.floor).toHaveLength(1);
    expect(recorded.windows).toEqual([]);
  });

  it('sweeps each window the host authorised, and only those', async () => {
    const recorded = blank();
    const api = lateApi(recorded, 0);
    const since = new Date('2026-01-01T00:00:00Z');
    const cutoff = new Date('2026-06-01T00:00:00Z');
    const deps: AuditJobDeps = {
      retention: api.retention,
      tenantWindows: () => Promise.resolve([{ clientId: 'tenant-a', since, cutoff }]),
      now: () => new Date('2026-08-24T00:00:00Z'),
    };

    await sweep().handle(undefined as never, deps, context(recorded));

    expect(recorded.windows).toEqual([{ clientId: 'tenant-a', since, cutoff }]);
    // The watermark travels UNCHANGED: `since` is the "downgrade never deletes"
    // bound, and a sweep that widened it would destroy history accumulated
    // under a longer entitlement.
    expect(recorded.windows[0]?.since).toBe(since);
  });

  it('passes the host its own clock, so a window resolver is testable', async () => {
    const recorded = blank();
    const api = lateApi(recorded, 0);
    const seen: Date[] = [];
    const deps: AuditJobDeps = {
      retention: api.retention,
      tenantWindows: (now) => {
        seen.push(now);
        return Promise.resolve([]);
      },
      now: () => new Date('2026-08-24T00:00:00Z'),
    };

    await sweep().handle(undefined as never, deps, context(recorded));

    expect(seen[0]?.toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });

  it('says nothing when it removed nothing — silence IS the steady state', async () => {
    const recorded = blank();
    const api = lateApi(recorded, 0);
    const deps: AuditJobDeps = { retention: api.retention };

    await sweep().handle(undefined as never, deps, context(recorded));

    expect(recorded.logs).toEqual([]);
  });

  it('reports what the pass actually removed, across both halves', async () => {
    const recorded = blank();
    const api = lateApi(recorded, 4);
    const deps: AuditJobDeps = {
      retention: api.retention,
      tenantWindows: () =>
        Promise.resolve([
          { clientId: 'a', since: new Date(0), cutoff: new Date('2026-01-01T00:00:00Z') },
        ]),
    };

    await sweep().handle(undefined as never, deps, context(recorded));

    expect(recorded.logs).toHaveLength(1);
    expect(recorded.logs[0]).toContain('removed 4 entry(ies) past the global floor');
    expect(recorded.logs[0]).toContain('1 inside 1 tenant window(s)');
  });
});
