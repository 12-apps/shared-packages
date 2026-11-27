/**
 * Closing a tenant and reopening it.
 *
 * **Close**, a dangerous act: the host's confirmation first, then the reason
 * and (a member's close) the typed name, then ONE transaction: the
 * conditional status move, the blockers counted AGAIN after it (anything
 * found rolls the move back), the closing row replaced, the mirror, the audit
 * line. After the commit, and never able to undo it: the after-close hook
 * (stamped either way; a failure is audited and the sweep retries it), the
 * cache invalidation and the notice.
 *
 * **Reopen**: ONE transaction: closing → active, the row read AFTER the
 * move (what a reopen and a re-close landing before it left), a second move
 * to the status the close started from when that is another live status, the
 * row deleted, the mirror with THAT row's `requestedAt`, the audit line. Then
 * the invalidation and the notice.
 */
import type { TenantStatusSet } from '../config';
import type { TenantRecord } from '../port';
import type { LifecycleContext } from './context';
import { purgeAtFor, sameTenantName } from './pure';
import type {
  TenantCloseEntry,
  TenantClosingCreate,
  TenantClosingRow,
  TenantClosingState,
  TenantLifecycle,
  TenantNoticePayload,
} from './types';

type CloseInput<S extends string> = Parameters<TenantLifecycle<S>['close']>[0];

export function payloadOf(
  tenant: TenantRecord,
  name: string,
  purgeAt: Date,
  by: TenantCloseEntry | null,
  reason: string | null,
  restored: string | null = null,
): TenantNoticePayload {
  return { tenantId: tenant.id, name, slug: tenant.slug, purgeAt: purgeAt.toISOString(), by, reason, restored };
}

/** Where `close` and `reopen` get their record: the caller, who read it through the port or its own lookup. */
const CALLER_RECORD = 'close/reopen tenant (the caller\'s record, port.bySlug/byId)';

/** The refusal for a tenant the close may not move, by the status the transaction reads. */
async function notClosable<S extends string, Tx>(context: LifecycleContext<S, Tx>, id: string, tx: Tx): Promise<Error> {
  const current = await context.tenant.byId(id, tx);
  return context.refuse(current !== null && context.isGone(current.status) ? 'alreadyClosing' : 'notActive');
}

/** The transaction: the move, the recount, the row, the mirror and the audit line. */
async function closeInTransaction<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  input: CloseInput<S>,
  row: TenantClosingCreate,
): Promise<void> {
  const { tenant, config } = context;
  const { ids } = tenant.config;
  const statuses = tenant.config.statuses as unknown as TenantStatusSet<S>;
  const from: readonly string[] = input.by === 'member' ? [statuses.active] : statuses.closableFrom;
  const id = input.tenant.id;
  await config.db.transaction(async (tx) => {
    if (!from.includes(input.tenant.status)) throw await notClosable(context, id, tx);
    if (!(await tenant.setStatusIf(id, input.tenant.status, statuses.closing, tx))) throw await notClosable(context, id, tx);
    // After the move, in the same transaction: what landed since the page's read is seen here, and rolls the move back.
    const blockers = await context.blockersOf(id, row.requestedAt, tx);
    if (blockers.length > 0) throw context.refuse('closingBlocked', { pending: blockers.length }, blockers.length);
    const table = await context.table(tx);
    // A row an earlier close left (reopened by the platform before a stamp cleared it) is replaced: fresh stamps.
    await table.deleteMany({ where: { tenantId: id } });
    await table.create({ data: row });
    if (config.mirror !== undefined) await config.mirror.replaced(tx, row);
    await config.audit(tx, ids.audit.closeScheduled, {
      act: 'closeScheduled',
      tenantId: id,
      by: input.by,
      reason: row.reason,
      purgeAt: row.purgeAt,
      priorStatus: input.tenant.status,
    });
  });
}

/** The after-close hook, stamped either way; a failure is audited with its stamp, in one transaction. */
export async function runAfterClose<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  tenant: TenantRecord<S>,
  now: Date,
): Promise<boolean> {
  const { config } = context;
  try {
    const node = (await context.tenant.tree?.nodeOf?.(tenant.id)) ?? null;
    await config.afterClose({ tenant, node, now });
  } catch (error) {
    config.onError(error, { act: 'afterClose', tenantId: tenant.id });
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    await context.quietly('afterCloseFailed', tenant.id, () =>
      config.db.transaction(async (tx) => {
        await (await context.table(tx)).updateMany({
          where: { tenantId: tenant.id, afterCloseDoneAt: null },
          data: { afterCloseFailedAt: now },
        });
        if (config.mirror !== undefined) await config.mirror.event(tx, tenant.id, { kind: 'afterClose', ok: false, at: now });
        await config.audit(tx, context.tenant.config.ids.audit.afterCloseFailed, {
          act: 'afterCloseFailed',
          tenantId: tenant.id,
          error: message,
        });
      }),
    );
    return false;
  }
  // The hook went through; a missed stamp only means the sweep runs it again, which the host's hook must tolerate.
  await context.quietly('afterCloseStamp', tenant.id, () =>
    context.stamp(tenant.id, 'afterCloseDoneAt', now, { kind: 'afterClose', ok: true, at: now }),
  );
  return true;
}

export async function closeTenant<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  given: CloseInput<S>,
): Promise<TenantClosingState<S>> {
  // A snapshot: the status the close starts from is the one the caller read, whatever happens to its object.
  const input = { ...given, tenant: { ...given.tenant } };
  const { config } = context;
  const { ids } = context.tenant.config;
  const statuses = context.tenant.config.statuses as unknown as TenantStatusSet<S>;
  const id = input.tenant.id;
  await config.confirmDangerousAct(input.request, { tenantId: id, by: input.by });
  const reason = input.reason.trim();
  if (reason.length < config.minReasonLength) throw context.refuse('reasonTooShort');
  const name = context.nameOf(input.tenant, CALLER_RECORD);
  if (input.by === 'member' && !sameTenantName(input.typedName ?? '', name, config.nameLocale)) {
    throw context.refuse('nameMismatch');
  }
  const now = input.now ?? new Date();
  const purgeAt = purgeAtFor(now, config.graceDays);
  const row: TenantClosingCreate = {
    tenantId: id,
    requestedAt: now,
    requestedById: input.by === 'member' ? input.actorUserId : null,
    reason,
    priorStatus: input.tenant.status,
    purgeAt,
  };
  await closeInTransaction(context, input, row);
  await runAfterClose(context, input.tenant, now);
  await context.quietly('invalidate', id, () => config.invalidate(id));
  await context.quietly('notify', id, () =>
    config.notify(
      ids.notifications.closingScheduled,
      payloadOf(input.tenant, name, purgeAt, input.by, input.by === 'platform' ? reason : null),
    ),
  );
  return { status: statuses.closing, requestedAt: now.toISOString(), purgeAt: purgeAt.toISOString() };
}

/** The status a reopen restores from a closing row: the close's prior status when it is a live one, else active. */
function restoredStatus<S extends string, Tx>(context: LifecycleContext<S, Tx>, prior: string | null | undefined): S {
  const statuses = context.tenant.config.statuses as unknown as TenantStatusSet<S>;
  return (
    prior !== null && prior !== undefined && (statuses.all as readonly string[]).includes(prior) && !context.isGone(prior)
      ? prior
      : statuses.active
  ) as S;
}

/**
 * The reopen's transaction: closing → active FIRST, then the row read (after
 * the move, so a reopen and a re-close landing before it are both seen), a
 * second move only when the close started from another live status (a
 * platform close of a suspended tenant), the delete, the mirror with THAT
 * row's `requestedAt`, the audit line. The row is read for the refusal only
 * when the move failed. A member's reopen costs what it did before.
 */
async function reopenInTransaction<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  input: { tenant: TenantRecord<S>; by: TenantCloseEntry },
  tx: Tx,
): Promise<{ row: TenantClosingRow | null; target: S }> {
  const statuses = context.tenant.config.statuses as unknown as TenantStatusSet<S>;
  const id = input.tenant.id;
  const table = await context.table(tx);
  if (!(await context.tenant.setStatusIf(id, statuses.closing, statuses.active, tx))) {
    const row = await table.findUnique({ where: { tenantId: id } });
    throw context.refuse(row?.purgedAt ? 'purged' : 'notClosing');
  }
  const current = await table.findUnique({ where: { tenantId: id } });
  const restored = restoredStatus(context, current?.priorStatus);
  if (restored !== statuses.active) await context.tenant.setStatusIf(id, statuses.active, restored, tx);
  await table.deleteMany({ where: { tenantId: id } });
  await recordReopen(context, input, current, restored, tx);
  return { row: current, target: restored };
}

/** The mirror (handed the deleted row's own `requestedAt`) and the audit line, on `tx`. */
async function recordReopen<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  input: { tenant: TenantRecord<S>; by: TenantCloseEntry },
  current: TenantClosingRow | null,
  restored: S,
  tx: Tx,
): Promise<void> {
  const { config } = context;
  const id = input.tenant.id;
  if (config.mirror !== undefined) await config.mirror.deleted(tx, id, current?.requestedAt);
  await config.audit(tx, context.tenant.config.ids.audit.closeReopened, {
    act: 'closeReopened',
    tenantId: id,
    by: input.by,
    purgeAt: current?.purgeAt ?? null,
    restored,
  });
}

export async function reopenTenant<S extends string, Tx>(
  context: LifecycleContext<S, Tx>,
  input: { tenant: TenantRecord<S>; by: TenantCloseEntry },
): Promise<TenantClosingState<S>> {
  const { config } = context;
  const { ids } = context.tenant.config;
  const id = input.tenant.id;
  const name = context.nameOf(input.tenant, CALLER_RECORD);
  const { row, target } = await config.db.transaction((tx) => reopenInTransaction(context, input, tx));
  await context.quietly('invalidate', id, () => config.invalidate(id));
  await context.quietly('notify', id, () =>
    config.notify(ids.notifications.reopened, payloadOf(input.tenant, name, row?.purgeAt ?? new Date(), null, null, target)),
  );
  return { status: target, requestedAt: null, purgeAt: null };
}
