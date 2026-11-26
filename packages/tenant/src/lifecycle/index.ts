/**
 * The tenant lifecycle (opt-in): close, reopen, the closing state, the
 * blockers, the sweep and the notices' words. Built by
 * `createApiTenant({ lifecycle })`, or by `createTenantLifecycle` over an
 * existing tenant.
 */
import type { TenantCopyPack } from '../config';
import { closeTenant, reopenTenant } from './close';
import { createContext, type LifecycleTenant } from './context';
import { sweepTenants } from './sweep';
import type { TenantLifecycle, TenantLifecycleConfig, TenantLifecycleCopyPack, TenantNoticePayload } from './types';
import { validateLifecycle, validateLifecycleCopy } from './validate';

export { isTenantGone, purgeAtFor, reminderDue, sameTenantName, type TenantReminder } from './pure';
export {
  TENANT_REFUSAL_STATUS,
  TenantLifecycleRefusal,
  type GateRefusal,
  type TenantLifecycleRefusalKind,
} from './refusal';
export { createTenantGates, type TenantGates, type TenantGatesConfig, type TenantPublicFamily } from './gates';
export { validateGates, validateLifecycle } from './validate';
export type { LifecycleTenant } from './context';
export {
  TENANT_LIFECYCLE_COPY_KEYS,
  type TenantAuditEvent,
  type TenantBlocker,
  type TenantBlockerCount,
  type TenantBlockerKind,
  type TenantCloseEntry,
  type TenantClosingCreate,
  type TenantClosingEvent,
  type TenantClosingMirror,
  type TenantClosingRow,
  type TenantClosingStamp,
  type TenantClosingState,
  type TenantClosingTable,
  type TenantLifecycle,
  type TenantLifecycleConfig,
  type TenantLifecycleCopyPack,
  type TenantNoticePayload,
  type TenantSweepResult,
} from './types';

/** `2026-12-19T…` as the locale writes a day, in `timeZone`. */
function dayOf(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone }).format(new Date(iso));
}

type Words = { title: string; body: string };

type Writer = (copy: TenantCopyPack, extra: TenantLifecycleCopyPack, name: string, day: string, payload: TenantNoticePayload) => Words;

function scheduledWords(copy: TenantCopyPack, extra: TenantLifecycleCopyPack, name: string, day: string, payload: TenantNoticePayload): Words {
  if (payload.by !== 'platform') return { title: copy.noticeScheduledTitle(name), body: copy.noticeScheduledBody(name, day) };
  const reason = payload.reason?.trim() ?? '';
  return {
    title: extra.noticePlatformScheduledTitle(name),
    body: reason === '' ? extra.noticePlatformScheduledBodyNoReason(name, day) : extra.noticePlatformScheduledBody(name, day, reason),
  };
}

/**
 * The lifecycle's notice words alone, for a host whose notification
 * registry renders them apart from the lifecycle wiring (no hooks needed):
 * the tenant's copy packs plus the lifecycle's copy extension, validated
 * here as `createTenantLifecycle` validates it (every key, every locale of
 * the base copy). A locale with no extension reads the default locale's,
 * never the member's sentence in its place.
 */
export function createNoticeWords(
  tenant: Pick<LifecycleTenant<string, unknown>, 'config' | 'copyFor'>,
  config: Pick<TenantLifecycleConfig, 'copy'>,
): TenantLifecycle['noticeWords'] {
  const { notifications } = tenant.config.ids;
  const { statuses } = tenant.config;
  const { locales, defaultLocale } = tenant.config.copy;
  validateLifecycleCopy((config as { copy?: unknown }).copy, Object.keys(locales));
  const extraFor = (tag: string): TenantLifecycleCopyPack =>
    (config.copy.locales[tag] ?? config.copy.locales[defaultLocale]) as TenantLifecycleCopyPack;
  const writers = new Map<string, Writer>([
    [notifications.closingScheduled, scheduledWords],
    [notifications.closingWeek, (copy, _extra, name, day) => ({ title: copy.noticeWeekTitle(name), body: copy.noticeWeekBody(name, day) })],
    [notifications.closingDay, (copy, _extra, name) => ({ title: copy.noticeDayTitle(name), body: copy.noticeDayBody(name) })],
    [
      notifications.reopened,
      (copy, extra, name, _day, payload) =>
        payload.restored !== undefined && payload.restored !== null && payload.restored !== statuses.active
          ? { title: extra.noticeReopenedRestoredTitle(name), body: extra.noticeReopenedRestoredBody(name) }
          : { title: copy.noticeReopenedTitle(name), body: copy.noticeReopenedBody(name) },
    ],
  ]);
  return (typeId, payload, at) => {
    const write = writers.get(typeId);
    if (write === undefined) throw new RangeError(`@12-apps/tenant: "${typeId}" is not one of the lifecycle's notice types.`);
    const tag = at.locale !== null && Object.hasOwn(locales, at.locale) ? at.locale : defaultLocale;
    return write(tenant.copyFor(tag), extraFor(tag), payload.name, dayOf(payload.purgeAt, tag, at.timeZone), payload);
  };
}

/**
 * The lifecycle over `tenant`, validated before it returns. The host wiring
 * it MUST return `name` from its port's `bySlug` and `byId`.
 */
export function createTenantLifecycle<S extends string, Tx>(
  tenant: LifecycleTenant<S, Tx>,
  config: TenantLifecycleConfig<S, Tx>,
): TenantLifecycle<S> {
  validateLifecycle(config, Object.keys(tenant.config.copy.locales), tenant.tree !== undefined);
  const context = createContext(tenant, config);
  return {
    close: (input) => closeTenant(context, input),
    reopen: (input) => reopenTenant(context, input),
    state: async (record) => {
      if (!context.isGone(record.status)) return { status: record.status, requestedAt: null, purgeAt: null };
      const row = await (await context.table()).findUnique({ where: { tenantId: record.id } });
      return {
        status: record.status,
        requestedAt: row?.requestedAt.toISOString() ?? null,
        purgeAt: row?.purgeAt.toISOString() ?? null,
      };
    },
    blockers: (tenantId, now = new Date()) => context.blockersOf(tenantId, now),
    sweep: (now) => sweepTenants(context, now),
    noticeWords: createNoticeWords(tenant, config),
  };
}
