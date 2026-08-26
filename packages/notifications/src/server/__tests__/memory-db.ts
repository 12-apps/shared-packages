/* eslint-disable test-flakiness/no-global-state-mutation, test-flakiness/no-random-data --
   this file IS the database of the unit suites: rows are mutable storage by
   design (an UPDATE mutates the stored row exactly as a table would), and
   `new Date()` stamps rows the way a column default does — no assertion ever
   reads a wall-clock value. */
import type { DeliveryStatus } from '../../types';
import type { NotificationRow } from '../../wire';
import type {
  NotificationDeliveryRow,
  NotificationDeliveryWhere,
  NotificationPreferenceRow,
  NotificationsDb,
  NotificationsDbClient,
  NotificationWhere,
  PushSubscriptionRow,
} from '../db';

/**
 * An in-memory {@link NotificationsDb} for the unit suites.
 *
 * It exists to pin the LOGIC — routing, gating, the delivery lifecycle, the
 * fold — without a database in the loop. The same contracts are then re-run
 * against a REAL Postgres in `harness/backend`, out of the published tarball,
 * because an in-memory double can agree with a wrong SQL translation.
 */

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${(sequence += 1)}`;

export interface MemoryDb extends NotificationsDb {
  rows: {
    notifications: NotificationRow[];
    deliveries: NotificationDeliveryRow[];
    preferences: NotificationPreferenceRow[];
    subscriptions: PushSubscriptionRow[];
  };
}

/**
 * A row as a READ returns it: a snapshot, never the stored object.
 *
 * Handing back the live object is the subtlest way a fake can disagree with a
 * database, and it disagrees precisely where the claim lives: code that reads a
 * row, then issues an UPDATE, then consults the value it read would see the
 * UPDATE's own effect through the alias. A real `SELECT` cannot do that, so the
 * fake must not either — the retry ceiling counted one attempt too many under
 * exactly this aliasing.
 */
const snapshot = <T extends object>(row: T): T => ({ ...row });

/** `(createdAt, id) < (anchor.createdAt, anchor.id)` — the keyset half. */
function afterAnchor(row: NotificationRow, or: NonNullable<NotificationWhere['OR']>): boolean {
  const [older, sameInstant] = or;
  if (row.createdAt.getTime() < older.createdAt.lt.getTime()) return true;
  return (
    row.createdAt.getTime() === sameInstant.createdAt.getTime() &&
    row.id < sameInstant.id.lt
  );
}

function live(rows: NotificationRow[], where: NotificationWhere): NotificationRow[] {
  return rows.filter((row) => {
    if (row.deletedAt !== null) return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.readAt === null && row.readAt !== null) return false;
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (where.id !== undefined && typeof where.id !== 'string' && !where.id.in.includes(row.id)) {
      return false;
    }
    if (where.OR !== undefined && !afterAnchor(row, where.OR)) return false;
    return true;
  });
}

/**
 * One delivery `where`, evaluated exactly as the SQL would.
 *
 * It matters that this is TOTAL over the shape rather than "the clauses the
 * caller happens to pass": the version this replaced ignored `status` in
 * `updateMany` entirely, which made the double unable to distinguish a guarded
 * requeue from an unguarded one — so the whole class of claim bug was invisible
 * to every unit test by construction.
 */
function matchesDelivery(row: NotificationDeliveryRow, where: NotificationDeliveryWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.notificationId !== undefined && row.notificationId !== where.notificationId) {
    return false;
  }
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  if (where.status !== undefined && typeof where.status !== 'string') {
    if (!where.status.in.includes(row.status as DeliveryStatus)) return false;
  }
  if (where.updatedAt !== undefined && row.updatedAt.getTime() >= where.updatedAt.lt.getTime()) {
    return false;
  }
  return true;
}

export function createMemoryDb(): MemoryDb {
  const notifications: NotificationRow[] = [];
  const deliveries: NotificationDeliveryRow[] = [];
  const preferences: NotificationPreferenceRow[] = [];
  const subscriptions: PushSubscriptionRow[] = [];

  const client: NotificationsDbClient = {
    notification: {
      create({ data }) {
        const now = new Date();
        const row: NotificationRow = {
          id: nextId('n'),
          ...data,
          readAt: null,
          deletedAt: null,
          // Monotonic within a test: real Postgres ties are broken by `id`, and
          // a same-millisecond clock would make page order arbitrary here.
          createdAt: new Date(now.getTime() + notifications.length),
        };
        notifications.push(row);
        return Promise.resolve(row);
      },
      findUnique({ where }) {
        return Promise.resolve(notifications.find((row) => row.id === where.id) ?? null);
      },
      findMany({ where, take }) {
        // The keyset lives in `where` now, so paging here is a filter plus a
        // sort — the same two operations the SQL does, and with no index
        // arithmetic that could disagree with either real implementation.
        const ordered = [...live(notifications, where)].sort((a, b) => {
          const byDate = b.createdAt.getTime() - a.createdAt.getTime();
          return byDate !== 0 ? byDate : (a.id < b.id ? 1 : -1);
        });
        return Promise.resolve(ordered.slice(0, take));
      },
      count({ where }) {
        return Promise.resolve(live(notifications, where).length);
      },
      updateMany({ where, data }) {
        const matched = live(notifications, where);
        for (const row of matched) Object.assign(row, data);
        return Promise.resolve({ count: matched.length });
      },
    },

    notificationDelivery: {
      createMany({ data }) {
        let count = 0;
        for (const entry of data) {
          const clash = deliveries.some(
            (row) => row.notificationId === entry.notificationId && row.channel === entry.channel,
          );
          if (clash) continue;
          const now = new Date();
          deliveries.push({
            id: nextId('d'),
            notificationId: entry.notificationId,
            channel: entry.channel,
            status: 'QUEUED',
            error: null,
            attempts: 0,
            sentAt: null,
            createdAt: now,
            updatedAt: now,
          });
          count += 1;
        }
        return Promise.resolve({ count });
      },
      findMany({ where, orderBy, take }) {
        const matched = deliveries.filter((row) => matchesDelivery(row, where));
        if (orderBy) matched.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        const page = take === undefined ? matched : matched.slice(0, take);
        return Promise.resolve(page.map(snapshot));
      },
      update({ where, data }) {
        const row = deliveries.find((entry) => entry.id === where.id);
        if (!row) throw new Error(`no delivery ${where.id}`);
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(snapshot(row));
      },
      // ATOMIC, and that is the point: the predicate is evaluated and the rows
      // are written with no `await` in between, so an interleaved second caller
      // sees the finished result exactly as it would see a committed UPDATE.
      // A claim is only a claim if this cannot be split.
      updateMany({ where, data }) {
        const { attempts, ...rest } = data;
        const matched = deliveries.filter((row) => matchesDelivery(row, where));
        for (const row of matched) {
          Object.assign(row, rest, { updatedAt: new Date() });
          if (attempts) row.attempts += attempts.increment;
        }
        return Promise.resolve({ count: matched.length });
      },
    },

    notificationPreference: {
      findMany({ where }) {
        return Promise.resolve(preferences.filter((row) => row.userId === where.userId));
      },
      findUnique({ where }) {
        const { userId, category } = where.userId_category;
        return Promise.resolve(
          preferences.find((row) => row.userId === userId && row.category === category) ?? null,
        );
      },
      upsert({ where, create, update }) {
        const { userId, category } = where.userId_category;
        const existing = preferences.find(
          (row) => row.userId === userId && row.category === category,
        );
        if (existing) {
          existing.channels = update.channels;
          return Promise.resolve(existing);
        }
        const row: NotificationPreferenceRow = { id: nextId('p'), ...create };
        preferences.push(row);
        return Promise.resolve(row);
      },
    },

    pushSubscription: {
      count({ where }) {
        return Promise.resolve(
          subscriptions.filter((row) => row.userId === where.userId).length,
        );
      },
      findMany({ where }) {
        return Promise.resolve(subscriptions.filter((row) => row.userId === where.userId));
      },
      findUnique({ where }) {
        return Promise.resolve(
          subscriptions.find((row) => row.endpoint === where.endpoint) ?? null,
        );
      },
      upsert({ where, create, update }) {
        const existing = subscriptions.find((row) => row.endpoint === where.endpoint);
        if (existing) {
          Object.assign(existing, update);
          return Promise.resolve(existing);
        }
        const row: PushSubscriptionRow = { id: nextId('s'), ...create };
        subscriptions.push(row);
        return Promise.resolve(row);
      },
      delete({ where }) {
        const index = subscriptions.findIndex((row) => row.id === where.id);
        if (index < 0) throw new Error(`no subscription ${where.id}`);
        return Promise.resolve(subscriptions.splice(index, 1)[0] as PushSubscriptionRow);
      },
      deleteMany({ where }) {
        const keep = subscriptions.filter(
          (row) => !(row.userId === where.userId && row.endpoint === where.endpoint),
        );
        const count = subscriptions.length - keep.length;
        subscriptions.splice(0, subscriptions.length, ...keep);
        return Promise.resolve({ count });
      },
    },
  };

  return {
    ...client,
    // No isolation to model: the suites assert committed state, and a rollback
    // path a fake invents would be a rollback nothing tests.
    $transaction: (fn) => fn(client),
    rows: { notifications, deliveries, preferences, subscriptions },
  };
}

/** A contact directory over a fixed table (the host's identity seam). */
export function memoryContacts(
  people: Record<string, { email: string | null; phone: string | null; locale?: string | null }>,
): {
  getContact: (
    userId: string,
  ) => Promise<{ email: string | null; phone: string | null; locale?: string | null } | null>;
} {
  return { getContact: (userId) => Promise.resolve(people[userId] ?? null) };
}
