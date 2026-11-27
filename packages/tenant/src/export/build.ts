/**
 * Building one archive, the build job's handler.
 *
 * - **The claim**: a conditional write takes a PREPARING row that no build
 *   holds (or whose holder went quiet for `staleAfterMs`) and has tries left
 *   (`maxAttempts`); a row out of tries is never claimed again: the sweep
 *   fails it and tells the person.
 * - **The heartbeat**: the build renews its claim as it writes, page by page
 *   (at most once per `beatEveryMs`), so a long build is never taken for a
 *   dead one; a build that finds its claim gone stops.
 * - **The archive** is streamed to a temp file (`./zip`, ZIP64), section by
 *   section, and stored from it through the archive port: it is never in
 *   memory whole.
 * - **READY** is written only by the claim's holder, with a link that expires
 *   after `linkDays`, never after the closing's purge date; then the person
 *   is told. A row the purge erased meanwhile gets its archive deleted.
 *
 * Never throws: a failure is retried by the sweep, up to `maxAttempts` builds.
 */
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { cellText, csvHeader, csvLine } from './csv';
import type { ExportEngine } from './engine';
import { expiryOf } from './requests';
import { tellRequester } from './tell';
import type { TenantDataExportRow, TenantExportBuildOutcome, TenantExportContext, TenantExportRowsSection, TenantExportSection } from './types';
import { ZipWriter, fileSink } from './zip';

class LostClaim extends Error {}

/** Claim a PREPARING export for this build, stamped `at`; false when another holds it, it is done, or out of tries. */
async function claim<S extends string, Tx>(engine: ExportEngine<S, Tx>, exportId: string, at: Date): Promise<boolean> {
  const { maxAttempts, staleAfterMs } = engine.config.limits;
  const stale = new Date(at.getTime() - staleAfterMs);
  const moved = await engine.write(
    exportId,
    { status: 'PREPARING', attempts: { lt: maxAttempts }, OR: [{ startedAt: null }, { startedAt: { lt: stale } }] },
    { startedAt: at, attempts: { increment: 1 } },
  );
  return moved === 1;
}

/** The claim a build holds, renewed as it writes. */
function heartbeat<S extends string, Tx>(engine: ExportEngine<S, Tx>, exportId: string, claimedAt: Date) {
  const held = { stamp: claimedAt };
  return {
    stamp: () => held.stamp,
    beat: async () => {
      const next = new Date();
      if (next.getTime() - held.stamp.getTime() < engine.config.limits.beatEveryMs) return;
      const renewed = await engine.write(exportId, { status: 'PREPARING', startedAt: held.stamp }, { startedAt: next });
      if (renewed === 0) throw new LostClaim(`export ${exportId}: the claim was taken or the row is gone`);
      held.stamp = next;
    },
  };
}

const nameOf = (name: TenantExportRowsSection['name'], at: TenantExportContext): string => (typeof name === 'string' ? name : name(at));

/** A rows section's lines: the header, then each page joined, beating after every page. */
async function* linesOf(section: TenantExportRowsSection, at: TenantExportContext): AsyncIterable<string> {
  yield csvHeader(section.header(at));
  for await (const page of section.pages(at)) {
    yield page.map((cells) => csvLine(cells.map(cellText))).join('');
    await at.beat();
  }
}

/** One section into the archive. */
async function writeSection(zip: ZipWriter, section: TenantExportSection, at: TenantExportContext): Promise<void> {
  if (section.kind === 'file') {
    await zip.addFile(nameOf(section.name, at), await section.data(at));
    await at.beat();
    return;
  }
  if (section.kind === 'rows') {
    await zip.addStream(nameOf(section.name, at), linesOf(section, at));
    return;
  }
  // One file at a time, each written and dropped before the next is read.
  for await (const file of section.files(at)) await zip.addFile(file.name, file.data);
  await at.beat();
}

/** Write every section into `zip`, in order. */
export async function writeArchive(zip: ZipWriter, sections: readonly TenantExportSection[], at: TenantExportContext): Promise<void> {
  for (const section of sections) await writeSection(zip, section, at);
}

/** Write the archive to a temp file and store it; the temp directory is gone after, whatever happens. */
async function buildAndStore<S extends string, Tx>(engine: ExportEngine<S, Tx>, key: string, at: TenantExportContext): Promise<number> {
  const directory = await mkdtemp(path.join(tmpdir(), 'tenant-export-'));
  try {
    const file = path.join(directory, 'built.zip');
    const zip = new ZipWriter(fileSink(file));
    const size = await writeArchive(zip, engine.config.sections, at).then(
      () => zip.finish(),
      (error: unknown) => {
        // An aborted build releases its file descriptor (and its deflate stream, in `addStream`) before the throw.
        zip.abort();
        throw error;
      },
    );
    await engine.config.archives.putStream(key, createReadStream(file), size);
    return size;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * A build that could not mark its row READY. Its archive stays only when another build of the same export marked it
 * READY with this very key; a row the purge erased, or one the sweep failed, gets the archive deleted.
 */
async function finishedElsewhere<S extends string, Tx>(engine: ExportEngine<S, Tx>, exportId: string, key: string): Promise<'skipped'> {
  const row = await (await engine.table()).findUnique({ where: { id: exportId } });
  if (row?.status !== 'READY' || row.storageKey !== key) await engine.config.archives.delete(key);
  return 'skipped';
}

/** The build failed: out of tries (or the tenant is gone), it is FAILED, by its holder only, and the person is told. */
async function failed<S extends string, Tx>(
  engine: ExportEngine<S, Tx>,
  row: TenantDataExportRow,
  gone: boolean,
  stamp: Date,
  error: unknown,
): Promise<'failed' | 'skipped'> {
  if (error instanceof LostClaim) return 'skipped';
  engine.lifecycle.onError(error, { act: 'exportBuild', tenantId: row.tenantId });
  if (row.attempts < engine.config.limits.maxAttempts && !gone) return 'failed';
  const marked = await engine.write(row.id, { status: 'PREPARING', startedAt: stamp }, { status: 'FAILED' });
  if (marked === 1) await tellRequester(engine, { ...row, expiresAt: null }, true);
  return 'failed';
}

/** The claimed row, the tenant's status and what the sections are written with. */
async function claimed<S extends string, Tx>(engine: ExportEngine<S, Tx>, exportId: string) {
  const row = await (await engine.table()).findUnique({ where: { id: exportId } });
  if (row === null) return null;
  const record = await engine.tenant.byId(row.tenantId);
  return { row, gone: record === null || record.status === engine.statuses.closed };
}

export async function buildExport<S extends string, Tx>(
  engine: ExportEngine<S, Tx>,
  exportId: string,
  now: Date,
): Promise<TenantExportBuildOutcome> {
  if (!(await claim(engine, exportId, now))) return 'skipped';
  const found = await claimed(engine, exportId);
  if (found === null) return 'skipped';
  const { row, gone } = found;
  const held = heartbeat(engine, exportId, now);
  try {
    // A tenant purged since the press has nothing left to hand out.
    if (gone) throw new Error('the tenant was purged');
    const [timeZone, locale] = await Promise.all([engine.tenant.port.timeZone(row.tenantId), engine.config.archiveLocale(row.tenantId)]);
    const key = engine.config.archives.key(row.tenantId, row.id);
    const size = await buildAndStore(engine, key, { tenantId: row.tenantId, now, timeZone, locale, beat: held.beat });
    const expiresAt = expiryOf(engine, now, await engine.purgeAtOf(row.tenantId));
    // Only the claim's holder marks it READY and tells: a build the sweep took over, or a row the purge erased
    // meanwhile, writes nothing and tells nobody.
    const marked = await engine.write(
      row.id,
      { status: 'PREPARING', startedAt: held.stamp() },
      { status: 'READY', readyAt: new Date(), expiresAt, storageKey: key, sizeBytes: size },
    );
    if (marked === 0) return await finishedElsewhere(engine, row.id, key);
    await tellRequester(engine, { ...row, expiresAt }, false);
    return 'built';
  } catch (error) {
    return failed(engine, row, gone, held.stamp(), error);
  }
}
