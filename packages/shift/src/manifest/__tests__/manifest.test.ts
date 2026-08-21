/**
 * The wiring-compliance suite (the report-builder shape). The manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from '@12-apps/wiring/producer';
import type { WireJobContext } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { createApiShift } from '../../http';
import { SHIFT_JOBS } from '../../jobs';
import { shiftManifest } from '../index';
import { shiftServerManifest } from '../server';

describe('the shared manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(shiftManifest)).toBe(shiftManifest);
    expect(defineServerManifest(shiftManifest, shiftServerManifest)).toBe(shiftServerManifest);
  });

  it('declares the package identity and the two runtime capabilities', () => {
    expect(shiftManifest.name).toBe('@12-apps/shift');
    expect(shiftManifest.contract).toBe(1);
    expect(shiftManifest.server).toEqual(['http', 'jobs']);
    expect(shiftManifest.observability).toEqual({ namespace: 'shift' });
    // The routes carry no policy on purpose — which permission gates a close
    // depends on the BODY's mode, so guards stay in the host's adapter and
    // the ids stay host vocabulary. No web, no packaged journeys either.
    expect(shiftManifest).not.toHaveProperty('web');
    expect(shiftManifest).not.toHaveProperty('mcp');
    expect(shiftManifest).not.toHaveProperty('permissions');
    expect(shiftManifest).not.toHaveProperty('e2e');
  });

  it('inventories http as createApiShift, and its routes declare no policy', () => {
    expect(shiftServerManifest.http.create).toBe(createApiShift);
    const { routes } = createApiShift({
      shifts: {} as never,
      serialize: () => null,
    });
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /shifts',
      'POST /shifts',
      'PATCH /shifts/:shiftId',
    ]);
    for (const route of routes) {
      expect(route).not.toHaveProperty('permission');
      expect(route).not.toHaveProperty('entitlement');
    }
  });

  it('declares the Prisma contribution prisma:sync actually copies', () => {
    expect(shiftManifest.db).toEqual({
      partial: 'prisma/shift.prisma',
      migrations: 'prisma/migrations',
    });
  });

  it('mirrors db into package.json, and the exports map matches the declarations', () => {
    expect(() => assertDbMirror(shiftManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(shiftManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(shiftManifest, packageJson)).not.toThrow();
  });
});

function stubContext(): WireJobContext & { logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } } {
  return {
    runId: 'run-1',
    attempt: 1,
    maxAttempts: 1,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('the auto-close blueprint — the first with a lease', () => {
  it('declares the cadence, the lease and the no-retry posture the host wrote by hand', () => {
    expect(shiftServerManifest.jobs).toBe(SHIFT_JOBS);
    expect(SHIFT_JOBS.namespace).toBe('shift');
    const blueprint = SHIFT_JOBS.blueprints.autoClose;
    expect(blueprint.name).toBe('auto-close');
    expect(blueprint.schedule).toEqual({ pattern: '*/15 * * * *' });
    // The wiring 1.3.0 lease field, first used in anger: the declaration
    // replaces the host's hand-rolled withSweepLease(…, 30 min, …) wrapper.
    expect(blueprint.lease).toEqual({ ttlMs: 30 * 60 * 1000 });
    expect(blueprint.attempts).toBe(1);
    expect(blueprint).not.toHaveProperty('interval');
  });

  it('sweeps through the one host dep and reports through the attempt logger', async () => {
    const context = stubContext();
    const autoCloseOverdue = vi.fn().mockResolvedValue({
      closed: [{ id: 's1' }],
      failures: [
        { clientId: 't1', shiftId: 's2', code: 'DB_CONFLICT', message: 'row moved' },
      ],
    });
    await SHIFT_JOBS.blueprints.autoClose.handle(
      undefined as never,
      { autoCloseOverdue },
      context,
    );
    expect(autoCloseOverdue).toHaveBeenCalledTimes(1);
    expect(context.logger.info).toHaveBeenCalledWith(
      'shift auto-close swept: 1 closed, 1 failed',
    );
    expect(context.logger.error).toHaveBeenCalledWith(
      'shift auto-close failed for shift s2 (tenant t1): DB_CONFLICT row moved',
    );
  });

  it('stays silent on an empty sweep — a quiet quarter-hour is not a log line', async () => {
    const context = stubContext();
    await SHIFT_JOBS.blueprints.autoClose.handle(
      undefined as never,
      { autoCloseOverdue: vi.fn().mockResolvedValue({ closed: [], failures: [] }) },
      context,
    );
    expect(context.logger.info).not.toHaveBeenCalled();
    expect(context.logger.error).not.toHaveBeenCalled();
  });
});
