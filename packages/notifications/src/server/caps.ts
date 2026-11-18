import type { NotificationChannel, NotificationLogger } from '../types';

import type { SendCounterDelegate, SendCounterKey } from './consent-db';
import type { NotificationsDbProvider } from './db';
import { PAID_CHANNELS, type PaidChannel } from './consent-text';

/**
 * Paid-message caps: per PERSON per DAY and per TENANT per MONTH,
 * each delivery on a capped channel counting one message, counted when the
 * delivery row is CREATED.
 *
 * ## The count is one statement
 *
 * A counter row per (scope, subject, period) is made to exist, then moved with
 * ONE conditional update whose `where` carries `count < cap`. The database
 * decides the winner, so N parallel emits at cap-1 let exactly one through —
 * a read of the count followed by a write would let all N through, each
 * having seen room. On Postgres the row lock makes the second UPDATE
 * re-evaluate `count < cap` against the first one's committed value.
 *
 * ## A refusal costs nothing
 *
 * The person is counted first; when the tenant then refuses, the person's
 * count is given back, so a message refused by one scope never consumes the
 * other. At a cap only the capped channel is dropped: the free channels the
 * person already has on, and the inbox, remain — and nothing is turned on.
 *
 * ## The tenant is told once
 *
 * `onTenantCapReached(tenantId, 'YYYY-MM')` fires when the tenant's cap FIRST
 * refuses a message of the period (not when the count reaches it — reaching is
 * not yet a lost message), through a conditional write of `notified_at`, so
 * exactly once per (tenant, period) under concurrency. A throwing hook is
 * logged and never fails the emit.
 *
 * ## The values are the host's
 *
 * Resolvers, so a host reads its own settings per emit. A resolver that throws
 * (or a zone the runtime does not know) degrades the emit to its FREE channels
 * — the `channelPolicy` doctrine: a paid message is never sent uncounted.
 */

/** The person-per-day default, when the host passes no resolver. */
export const DEFAULT_PER_RECIPIENT_DAILY_CAP = 10;

/** The tenant-per-month default, when the host passes no resolver. */
export const DEFAULT_PER_TENANT_MONTHLY_CAP = 500;

export interface NotificationCapsConfig {
  /** The capped channels. Default: SMS and WhatsApp. */
  channels?: readonly PaidChannel[];
  /** Paid messages one person may get a day. Default {@link DEFAULT_PER_RECIPIENT_DAILY_CAP}. */
  perRecipientDaily?: () => number | Promise<number>;
  /** Paid messages one tenant's people may get a month. Default {@link DEFAULT_PER_TENANT_MONTHLY_CAP}. */
  perTenantMonthly?: (tenantId: string) => number | Promise<number>;
  /** The IANA zone a person's day is counted in. Required: no market is assumed. */
  timeZone: string;
  /** The zone a tenant's month is counted in. Absent = `timeZone`. */
  timeZoneOf?: (tenantId: string) => string | Promise<string>;
  /** Told once per (tenant, `YYYY-MM`), when the tenant cap first refuses a message. */
  onTenantCapReached?: (tenantId: string, period: string) => void | Promise<void>;
}

export interface CapsGate {
  /** One emit's channels, the capped ones past a cap dropped (order kept). */
  apply(
    userId: string,
    tenantId: string | null,
    channels: NotificationChannel[],
  ): Promise<NotificationChannel[]>;
  /** Count one confirmation message toward the person's day. */
  admitConfirmation(userId: string): Promise<boolean>;
  /** Give back what {@link admitConfirmation} took, when nothing was sent. */
  refundConfirmation(userId: string): Promise<void>;
}

interface Limits {
  personCap: number;
  day: string;
  tenant: { id: string; cap: number; month: string } | null;
}

/** The calendar parts of `at` in `zone` (throws on an unknown zone). */
function partsIn(zone: string, at: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return { year: part('year'), month: part('month'), day: part('day') };
}

const dayIn = (zone: string, at: Date): string => {
  const { year, month, day } = partsIn(zone, at);
  return `${year}-${month}-${day}`;
};

const monthIn = (zone: string, at: Date): string => {
  const { year, month } = partsIn(zone, at);
  return `${year}-${month}`;
};

/** A cap is a non-negative whole number; anything else is a resolver bug. */
function capOf(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid cap ${String(value)}`);
  return Math.floor(value);
}

/** What every counting step reads. */
interface CapsContext {
  db: NotificationsDbProvider;
  config: NotificationCapsConfig;
  logger: NotificationLogger;
}

async function counters(ctx: CapsContext): Promise<SendCounterDelegate> {
  const delegate = (await ctx.db()).notificationSendCounter;
  if (!delegate) {
    throw new Error(
      '@12-apps/notifications: `caps` needs the `notificationSendCounter` delegate on the db seam.',
    );
  }
  return delegate;
}

async function limitsFor(ctx: CapsContext, tenantId: string | null, now: Date): Promise<Limits> {
  const { config } = ctx;
  const personCap = capOf(await (config.perRecipientDaily?.() ?? DEFAULT_PER_RECIPIENT_DAILY_CAP));
  const day = dayIn(config.timeZone, now);
  if (tenantId === null) return { personCap, day, tenant: null };
  const cap = capOf(await (config.perTenantMonthly?.(tenantId) ?? DEFAULT_PER_TENANT_MONTHLY_CAP));
  const zone = (await config.timeZoneOf?.(tenantId)) ?? config.timeZone;
  return { personCap, day, tenant: { id: tenantId, cap, month: monthIn(zone, now) } };
}

/** The limits of this emit, or `null` when a resolver failed (degrade to free). */
async function resolveLimits(ctx: CapsContext, tenantId: string | null): Promise<Limits | null> {
  try {
    return await limitsFor(ctx, tenantId, new Date());
  } catch (error) {
    ctx.logger.error('[notifications] a cap resolver failed; degrading to the free channels:', error);
    return null;
  }
}

/** The atomic increment-below-cap: two statements, the second decides. */
async function take(store: SendCounterDelegate, key: SendCounterKey, cap: number): Promise<boolean> {
  await store.createMany({ data: [key], skipDuplicates: true });
  const moved = await store.updateMany({
    where: { ...key, count: { lt: cap } },
    data: { count: { increment: 1 } },
  });
  return moved.count === 1;
}

async function giveBack(store: SendCounterDelegate, key: SendCounterKey): Promise<void> {
  await store.updateMany({ where: { ...key, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

/** The once-per-period notice: whoever writes `notified_at` first tells the host. */
async function tellTenantOnce(ctx: CapsContext, store: SendCounterDelegate, key: SendCounterKey): Promise<void> {
  const hook = ctx.config.onTenantCapReached;
  if (!hook) return;
  const first = await store.updateMany({
    where: { ...key, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  if (first.count !== 1) return;
  try {
    await hook(key.subjectId, key.period);
  } catch (error) {
    ctx.logger.error(`[notifications] onTenantCapReached failed for ${key.subjectId}:`, error);
  }
}

/** One paid message: the person's day, then the tenant's month (refunding the person). */
async function admit(
  ctx: CapsContext,
  store: SendCounterDelegate,
  userId: string,
  limits: Limits,
): Promise<boolean> {
  const person: SendCounterKey = { scope: 'recipient', subjectId: userId, period: limits.day };
  if (!(await take(store, person, limits.personCap))) return false;
  if (!limits.tenant) return true;
  const tenant: SendCounterKey = { scope: 'tenant', subjectId: limits.tenant.id, period: limits.tenant.month };
  if (await take(store, tenant, limits.tenant.cap)) return true;
  await giveBack(store, person);
  await tellTenantOnce(ctx, store, tenant);
  return false;
}

/**
 * A `caps` config on a db seam with no `notificationSendCounter` delegate would
 * drop every paid channel of every emit. Said once, loudly — on the gate's
 * first use, never at mount: a mount touches no database, so importing a host
 * module that mounts notifications does no I/O.
 */
async function checkCountersSeam(db: NotificationsDbProvider, logger: NotificationLogger): Promise<void> {
  try {
    if (!(await db()).notificationSendCounter) {
      logger.error(
        '@12-apps/notifications: `caps` needs the `notificationSendCounter` delegate on the db seam; ' +
          'until it is there every paid channel degrades to the free ones.',
      );
    }
  } catch {
    // A seam that cannot answer is reported by the use that needs it.
  }
}

export function createCapsGate(
  db: NotificationsDbProvider,
  config: NotificationCapsConfig,
  logger: NotificationLogger,
): CapsGate {
  const ctx: CapsContext = { db, config, logger };
  const capped = new Set<NotificationChannel>(config.channels ?? PAID_CHANNELS);
  let seamChecked: Promise<void> | null = null;
  const checkSeamOnce = (): Promise<void> => (seamChecked ??= checkCountersSeam(db, logger));

  return {
    async apply(userId, tenantId, channels) {
      await checkSeamOnce();
      const paid = channels.filter((channel) => capped.has(channel));
      if (paid.length === 0) return channels;
      const free = (): NotificationChannel[] => channels.filter((channel) => !capped.has(channel));
      const limits = await resolveLimits(ctx, tenantId);
      if (!limits) return free();
      const refused = new Set<NotificationChannel>();
      try {
        const store = await counters(ctx);
        // Sequential: each paid delivery is one message, and a channel admitted
        // later must see the count the earlier one left.
        for (const channel of paid) {
          if (!(await admit(ctx, store, userId, limits))) refused.add(channel);
        }
      } catch (error) {
        // A counter that cannot be read or moved (a DB error, a seam without
        // the delegate) degrades like a failing resolver: the paid channels go,
        // never uncounted, and the inbox row and the free channels are still
        // written — a cap must never cost a person the record of the event.
        ctx.logger.error('[notifications] the send counter failed; degrading to the free channels:', error);
        return free();
      }
      return channels.filter((channel) => !refused.has(channel));
    },

    async admitConfirmation(userId) {
      await checkSeamOnce();
      const limits = await resolveLimits(ctx, null);
      if (!limits) return false;
      return admit(ctx, await counters(ctx), userId, limits);
    },

    async refundConfirmation(userId) {
      await checkSeamOnce();
      const day = dayIn(config.timeZone, new Date());
      await giveBack(await counters(ctx), { scope: 'recipient', subjectId: userId, period: day });
    },
  };
}
