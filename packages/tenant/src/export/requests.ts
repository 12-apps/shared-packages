/**
 * The request and the download, behind the host's session check.
 *
 * **The request** inserts a PREPARING row and its audit line (who, when) in
 * ONE transaction, then queues the build. The partial unique index allows one
 * PREPARING row per tenant, so a second press while one builds answers the
 * running one: no second job, no second line.
 *
 * **The download** hands out a READY archive of this tenant within its days
 * (404 for none or one not built, 410 once expired or gone from storage), and
 * audits who took it: one line, on the download alone. Never a bearer link:
 * the session and the close permission are asked first, so a forwarded
 * e-mail opens nothing. On a bucket the answer is the archive port's
 * presigned `302`; on local disk, the file, streamed.
 */
import { randomUUID } from 'node:crypto';

import type { ExportEngine } from './engine';
import type { TenantDataExportCreate, TenantExportActor, TenantExportState } from './types';

const DAY_MS = 24 * 60 * 60_000;

/** The session check, then the tenant itself: a closed tenant hands nothing out. */
async function admit<S extends string, Tx>(engine: ExportEngine<S, Tx>, request: Request, slug: string): Promise<TenantExportActor> {
  const actor = await engine.config.authorize(request, { slug, permission: engine.tenant.config.ids.permissions.close });
  const record = await engine.tenant.byId(actor.tenantId);
  if (record?.status === engine.statuses.closed) throw engine.refuse('closed');
  return actor;
}

/** One insert and its audit line, with the mirror. */
async function insert<S extends string, Tx>(engine: ExportEngine<S, Tx>, row: TenantDataExportCreate): Promise<void> {
  const { db, mirror, audit } = engine.config;
  await db.transaction(async (tx) => {
    await (await engine.table(tx)).create({ data: row });
    if (mirror !== undefined) await mirror.created(tx, row);
    await audit(tx, engine.tenant.config.ids.audit.exportRequested, { act: 'exportRequested', tenantId: row.tenantId, exportId: row.id });
  });
}

/** Insert, or answer the export already running. A running one that finished between the insert and the read is asked again once. */
async function insertOrRunning<S extends string, Tx>(
  engine: ExportEngine<S, Tx>,
  tenantId: string,
  actorUserId: string,
  now: Date,
  retried: boolean,
): Promise<TenantExportState & { fresh: boolean }> {
  const id = randomUUID();
  try {
    await insert(engine, { id, tenantId, requestedById: actorUserId, status: 'PREPARING', requestedAt: now });
    return { id, status: 'PREPARING', requestedAt: now.toISOString(), fresh: true };
  } catch (error) {
    if (!engine.config.db.isUniqueViolation(error)) throw error;
    const running = await (await engine.table()).findFirst({ where: { tenantId, status: 'PREPARING' } });
    if (running === null && !retried) return insertOrRunning(engine, tenantId, actorUserId, now, true);
    if (running === null) throw error;
    return { id: running.id, status: 'PREPARING', requestedAt: running.requestedAt.toISOString(), fresh: false };
  }
}

export async function requestExport<S extends string, Tx>(
  engine: ExportEngine<S, Tx>,
  input: { request: Request; slug: string; now?: Date },
): Promise<TenantExportState> {
  const { tenantId, actorUserId } = await admit(engine, input.request, input.slug);
  if (actorUserId === null) throw engine.refuse('exportNeedsPerson');
  const state = await insertOrRunning(engine, tenantId, actorUserId, input.now ?? new Date(), false);
  if (state.fresh) await engine.config.enqueueBuild(state.id, { source: 'request' });
  return { id: state.id, status: state.status, requestedAt: state.requestedAt };
}

/** When the link stops working: `linkDays`, never after the tenant's purge. */
export function expiryOf<S extends string, Tx>(engine: ExportEngine<S, Tx>, now: Date, purgeAt: Date | null): Date {
  const week = new Date(now.getTime() + engine.config.limits.linkDays * DAY_MS);
  return purgeAt !== null && purgeAt.getTime() < week.getTime() ? purgeAt : week;
}

/** The downloaded file's name, in the tenant's archive language, for the UTC day of `now`. */
export async function archiveFilename<S extends string, Tx>(engine: ExportEngine<S, Tx>, tenantId: string, now: Date): Promise<string> {
  const tag = await engine.config.archiveLocale(tenantId);
  const { locales } = engine.config.copy;
  const pack = Object.hasOwn(locales, tag) ? locales[tag] : locales[engine.tenant.config.copy.defaultLocale];
  if (pack === undefined) throw new RangeError(`@12-apps/tenant: archiveLocale answered "${tag}", which export.copy does not hold.`);
  return pack.archiveFilename(now.toISOString().slice(0, 10));
}

const NO_STORE = { 'cache-control': 'no-store' };

export async function downloadExport<S extends string, Tx>(
  engine: ExportEngine<S, Tx>,
  input: { request: Request; slug: string; exportId: string; now?: Date },
): Promise<Response> {
  const { tenantId } = await admit(engine, input.request, input.slug);
  const now = input.now ?? new Date();
  const row = await (await engine.table()).findFirst({ where: { id: input.exportId, tenantId } });
  if (row === null || row.status !== 'READY' || row.storageKey === null) throw engine.refuse('exportNotFound');
  if (row.deletedAt !== null || row.expiresAt === null || row.expiresAt.getTime() <= now.getTime()) throw engine.refuse('exportExpired');
  const filename = await archiveFilename(engine, tenantId, now);
  const opened = await engine.config.archives.presign(row.storageKey, filename);
  if (opened.kind === 'missing') throw engine.refuse('exportExpired');
  // Who took the tenant's data out, and when: the act that carries it off is recorded, not only the ask.
  await engine.config.db.transaction((tx) =>
    engine.config.audit(tx, engine.tenant.config.ids.audit.exportDownloaded, { act: 'exportDownloaded', tenantId, exportId: row.id }),
  );
  if (opened.kind === 'redirect') return new Response(null, { status: 302, headers: { location: opened.url, ...NO_STORE } });
  return new Response(opened.body, {
    status: 200,
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${filename}"`, ...NO_STORE },
  });
}
