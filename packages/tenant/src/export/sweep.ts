/**
 * The sweep job's handler: what makes the build's enqueue only the fast path.
 * It never builds itself (a build can outlast the sweep's lease and its shared
 * queue), it QUEUES the build again:
 *
 * - a PREPARING export whose build never started or went quiet, with tries
 *   left, is queued again (`enqueueBuild` with `{ source: 'sweep', attempts }`,
 *   so the host's dedupe key is one job per try);
 * - one out of tries is FAILED (the write asks again that it is quiet, so a
 *   build that renewed its claim since the read is never failed under it);
 * - a READY or FAILED export whose notice was never recorded is told again (a
 *   READY one only after `staleAfterMs`, so the build's own notice is never
 *   doubled);
 * - an archive past its link is deleted from storage, then stamped.
 *
 * Bounded per step (`sweepBatch`); every step idempotent by the row's own
 * stamps. Failing comes before telling, so a row failed now is told in this
 * same pass.
 */
import type { ExportEngine } from './engine';
import { tellRequester } from './tell';
import type { TenantDataExportQuiet, TenantExportSweepResult } from './types';

const quietSince = (stale: Date): { status: 'PREPARING'; OR: TenantDataExportQuiet } => ({
  status: 'PREPARING',
  OR: [{ startedAt: null, requestedAt: { lt: stale } }, { startedAt: { lt: stale } }],
});

async function requeue<S extends string, Tx>(engine: ExportEngine<S, Tx>, stale: Date): Promise<number> {
  const { maxAttempts, sweepBatch } = engine.config.limits;
  const waiting = await (await engine.table()).findMany({
    where: { ...quietSince(stale), attempts: { lt: maxAttempts } },
    orderBy: { requestedAt: 'asc' },
    take: sweepBatch,
  });
  for (const row of waiting) await engine.config.enqueueBuild(row.id, { source: 'sweep', attempts: row.attempts });
  return waiting.length;
}

async function failExhausted<S extends string, Tx>(engine: ExportEngine<S, Tx>, stale: Date): Promise<number> {
  const { maxAttempts, sweepBatch } = engine.config.limits;
  const exhausted = await (await engine.table()).findMany({
    where: { ...quietSince(stale), attempts: { gte: maxAttempts } },
    take: sweepBatch,
  });
  for (const row of exhausted) await engine.write(row.id, quietSince(stale), { status: 'FAILED' });
  return exhausted.length;
}

async function tellUntold<S extends string, Tx>(engine: ExportEngine<S, Tx>, stale: Date, now: Date): Promise<number> {
  const untold = await (await engine.table()).findMany({
    where: {
      notifiedAt: null,
      OR: [{ status: 'READY', readyAt: { lt: stale }, expiresAt: { gt: now } }, { status: 'FAILED' }],
    },
    take: engine.config.limits.sweepBatch,
  });
  for (const row of untold) await tellRequester(engine, row, row.status === 'FAILED');
  return untold.length;
}

async function deleteExpired<S extends string, Tx>(engine: ExportEngine<S, Tx>, now: Date): Promise<number> {
  const expired = await (await engine.table()).findMany({
    where: { status: 'READY', deletedAt: null, expiresAt: { lte: now } },
    take: engine.config.limits.sweepBatch,
  });
  for (const row of expired) {
    if (row.storageKey !== null) await engine.config.archives.delete(row.storageKey);
    await engine.write(row.id, { deletedAt: null }, { deletedAt: now });
  }
  return expired.length;
}

export async function sweepExports<S extends string, Tx>(engine: ExportEngine<S, Tx>, now: Date): Promise<TenantExportSweepResult> {
  const stale = new Date(now.getTime() - engine.config.limits.staleAfterMs);
  const queued = await requeue(engine, stale);
  const failed = await failExhausted(engine, stale);
  const told = await tellUntold(engine, stale, now);
  const deleted = await deleteExpired(engine, now);
  return { queued, failed, told, deleted };
}
