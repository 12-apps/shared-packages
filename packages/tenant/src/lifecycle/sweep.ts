/**
 * The sweep: every pass reads the closing rows not yet purged, oldest purge
 * first, at most `sweepBatch`, and for each one:
 *
 * - deletes it when the tenant is neither closing nor closed (a stale row of
 *   a tenant reopened behind the package's back: by a host release that
 *   wrote only its older table, say), conditionally on its `requestedAt`,
 *   with the mirror, in one transaction; a stale row never takes a slot of
 *   the batch, so the next page is read and no due tenant waits behind it;
 * - retries the after-close hook while it has not gone through;
 * - once due, runs the host's purge, and stamps `purgedAt` on `purged` and on
 *   `already` (which heals a crash between the host's purge and the stamp);
 *   with the package's engine (`lifecycle.purge`) the engine stamps it
 *   itself, and the pass ends with the engine's image pass;
 * - before that, while closing, sends the reminder due: re-read right before
 *   the send, stamped only once the notice was RECORDED, conditionally, so a
 *   failed send is retried and two passes cannot both send.
 *
 * One tenant's failure goes to `onError` and never stops the others.
 */
import type { TenantRecord } from '../port';
import { runAfterClose, payloadOf } from './close';
import type { LifecycleContext } from './context';
import { reminderDue, type TenantReminder } from './pure';
import type { TenantClosingRow, TenantLifecyclePurge, TenantSweepResult } from './types';

const sentOf = (row: TenantClosingRow) => ({ week: row.remindedWeekAt !== null, day: row.remindedDayAt !== null });

async function remind<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  row: TenantClosingRow,
  now: Date,
  result: TenantSweepResult,
): Promise<void> {
  const { config } = context;
  const { statuses, ids } = context.tenant.config;
  if (reminderDue(row.purgeAt, sentOf(row), now, config.reminderDays) === null) return;
  // Re-read right before the send: a reopen, or another pass's stamp, may have landed.
  const fresh = await (await context.table()).findUnique({ where: { tenantId: row.tenantId } });
  const tenant = await context.tenant.byId(row.tenantId);
  if (fresh === null || fresh.purgedAt !== null || tenant === null || tenant.status !== statuses.closing) return;
  const due: TenantReminder | null = reminderDue(fresh.purgeAt, sentOf(fresh), now, config.reminderDays);
  if (due === null) return;
  const type = due === 'week' ? ids.notifications.closingWeek : ids.notifications.closingDay;
  const told = await config.notify(type, payloadOf(tenant, context.nameOf(tenant, 'port.byId'), fresh.purgeAt, null, null));
  if (!told) return;
  const field = due === 'week' ? 'remindedWeekAt' : 'remindedDayAt';
  result.reminded[due] += await context.stamp(row.tenantId, field, now, { kind: 'reminded', which: due, at: now });
}

async function sweepOne<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  row: TenantClosingRow,
  tenant: TenantRecord<S>,
  now: Date,
  result: TenantSweepResult,
): Promise<void> {
  if (row.afterCloseDoneAt === null && (await runAfterClose(context, tenant, now))) result.afterCloseRetried += 1;
  if (row.purgeAt.getTime() <= now.getTime()) {
    const { purge, onPurgeDue } = context.config;
    if (purge !== undefined) {
      // The engine stamped `purgedAt` itself, in the transaction that erased: nothing to stamp here.
      if ((await purge.run(row.tenantId, { now })) === 'purged') result.purged += 1;
      return;
    }
    // Validated: one of the two is given.
    const outcome = await (onPurgeDue as NonNullable<typeof onPurgeDue>)(row.tenantId, { now });
    if (outcome === 'skipped') return;
    if (outcome === 'purged') result.purged += 1;
    await context.stamp(row.tenantId, 'purgedAt', now, { kind: 'purged', at: now });
    return;
  }
  if (tenant.status === context.tenant.config.statuses.closing) await remind(context, row, now, result);
}

/** Delete a stale row (its tenant is live again) while it is still the row read, with the mirror, in one transaction. */
async function dropStale<S extends string, Tx>(context: LifecycleContext<S, Tx>, row: TenantClosingRow): Promise<void> {
  await context.config.db.transaction(async (tx) => {
    const { count } = await (await context.table(tx)).deleteMany({
      where: { tenantId: row.tenantId, requestedAt: row.requestedAt, purgedAt: null },
    });
    if (count > 0 && context.config.mirror !== undefined) await context.config.mirror.deleted(tx, row.tenantId, row.requestedAt);
  });
}

/** One row: dropped when stale (answers false), else swept (answers true: it took a slot of the batch). */
async function visit<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  row: TenantClosingRow,
  now: Date,
  result: TenantSweepResult,
): Promise<boolean> {
  try {
    const tenant = await context.tenant.byId(row.tenantId);
    if (tenant === null || !context.isGone(tenant.status)) {
      await dropStale(context, row);
      return false;
    }
    // Each tenant is its own purge and its own recorded notice: one at a time, by design.
    await sweepOne(context, row, tenant, now, result);
  } catch (error) {
    context.config.onError(error, { act: 'sweep', tenantId: row.tenantId });
  }
  return true;
}

/** One page, in order, until `room` live tenants were swept. Answers how many were. */
async function sweepPage<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  page: readonly TenantClosingRow[],
  room: number,
  now: Date,
  result: TenantSweepResult,
): Promise<number> {
  let swept = 0;
  for (const row of page) {
    if (swept >= room) break;
    if (await visit(context, row, now, result)) swept += 1;
  }
  return swept;
}

/** The engine's image pass: every purged tenant still owing objects. A failure goes to `onError`. */
async function sweepOwedImages<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  purge: TenantLifecyclePurge,
  now: Date,
  result: TenantSweepResult,
): Promise<void> {
  result.imagesErased = 0;
  try {
    result.imagesErased = (await purge.sweepImages(now)).emptied;
  } catch (error) {
    // No tenant: the pass's own lookup failed (each tenant's failure is reported, with its id, by the pass).
    context.config.onError(error, { act: 'purgeImagesLookup', tenantId: '' });
  }
}

/**
 * Pages of `sweepBatch` rows, oldest purge first, by keyset; at most
 * `sweepBatch` live tenants are swept per pass, and a stale row (dropped)
 * does not count, so the pass reads on until the batch is full or no row is left.
 */
export async function sweepTenants<S extends string, Tx>(context: LifecycleContext<S, Tx>, now: Date): Promise<TenantSweepResult> {
  const { config } = context;
  const table = await context.table();
  const result: TenantSweepResult = { reminded: { week: 0, day: 0 }, purged: 0, afterCloseRetried: 0 };
  let swept = 0;
  let after: TenantClosingRow | null = null;
  while (swept < config.sweepBatch) {
    const page: TenantClosingRow[] = await table.findMany({
      where:
        after === null
          ? { purgedAt: null }
          : { purgedAt: null, OR: [{ purgeAt: { gt: after.purgeAt } }, { purgeAt: after.purgeAt, tenantId: { gt: after.tenantId } }] },
      orderBy: [{ purgeAt: 'asc' }, { tenantId: 'asc' }],
      take: config.sweepBatch,
    });
    swept += await sweepPage(context, page, config.sweepBatch - swept, now, result);
    if (page.length < config.sweepBatch) break;
    after = page[page.length - 1] ?? null;
  }
  if (config.purge !== undefined) await sweepOwedImages(context, config.purge, now, result);
  return result;
}
