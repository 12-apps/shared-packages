/**
 * The account half of the notification db seam (12-15): the two tables that
 * belong to a PERSON rather than to a notification — their explicit channel
 * choices, and the browsers they registered for web push.
 *
 * Split out of `notifications-db.ts` for size only; the delegates are the same
 * duck-typed fill of the package's CLOSED argument shapes, over the same PGlite.
 */
import { randomUUID } from 'node:crypto';

import type {
  NotificationPreferenceDelegate,
  NotificationPreferenceRow,
  PushSubscriptionDelegate,
  PushSubscriptionRow,
} from '@12-apps/notifications/server';

import { Params, type SqlRunner } from './rbac-db-shared';

interface PreferenceSqlRow {
  id: string;
  user_id: string;
  category: string;
  channels: unknown;
}

const preferenceRow = (row: PreferenceSqlRow): NotificationPreferenceRow => ({
  id: row.id,
  userId: row.user_id,
  category: row.category,
  channels: row.channels,
});

export function preferenceDelegate(sql: SqlRunner): NotificationPreferenceDelegate {
  return {
    async findMany({ where }) {
      const params = new Params();
      const { rows } = await sql.query<PreferenceSqlRow>(
        `SELECT * FROM notification_preferences WHERE user_id = ${params.add(where.userId)}`,
        params.values,
      );
      return rows.map(preferenceRow);
    },
    async findUnique({ where }) {
      const { userId, category } = where.userId_category;
      const params = new Params();
      const { rows } = await sql.query<PreferenceSqlRow>(
        `SELECT * FROM notification_preferences
         WHERE user_id = ${params.add(userId)} AND category = ${params.add(category)}`,
        params.values,
      );
      const row = rows[0];
      return row ? preferenceRow(row) : null;
    },
    async upsert({ where, create, update }) {
      const { userId, category } = where.userId_category;
      const params = new Params();
      const { rows } = await sql.query<PreferenceSqlRow>(
        `INSERT INTO notification_preferences (id, user_id, category, channels, updated_at)
         VALUES (${params.add(randomUUID())}, ${params.add(userId)}, ${params.add(category)},
                 ${params.add(JSON.stringify(create.channels))}::jsonb, NOW())
         ON CONFLICT (user_id, category) DO UPDATE
           SET channels = ${params.add(JSON.stringify(update.channels))}::jsonb,
               updated_at = NOW()
         RETURNING *`,
        params.values,
      );
      return preferenceRow(rows[0] as PreferenceSqlRow);
    },
  };
}

interface SubscriptionSqlRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
}

const subscriptionRow = (row: SubscriptionSqlRow): PushSubscriptionRow => ({
  id: row.id,
  userId: row.user_id,
  endpoint: row.endpoint,
  p256dh: row.p256dh,
  auth: row.auth,
  userAgent: row.user_agent,
});

export function subscriptionDelegate(sql: SqlRunner): PushSubscriptionDelegate {
  return {
    async count({ where }) {
      const params = new Params();
      const { rows } = await sql.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM push_subscriptions
         WHERE user_id = ${params.add(where.userId)}`,
        params.values,
      );
      return Number(rows[0]?.count ?? 0);
    },
    async findMany({ where }) {
      const params = new Params();
      const { rows } = await sql.query<SubscriptionSqlRow>(
        `SELECT * FROM push_subscriptions WHERE user_id = ${params.add(where.userId)}
         ORDER BY created_at, id`,
        params.values,
      );
      return rows.map(subscriptionRow);
    },
    async upsert({ where, create, update }) {
      const params = new Params();
      const { rows } = await sql.query<SubscriptionSqlRow>(
        `INSERT INTO push_subscriptions
           (id, user_id, endpoint, p256dh, auth, user_agent, updated_at)
         VALUES (${params.add(randomUUID())}, ${params.add(create.userId)},
                 ${params.add(where.endpoint)}, ${params.add(create.p256dh)},
                 ${params.add(create.auth)}, ${params.add(create.userAgent)}, NOW())
         ON CONFLICT (endpoint) DO UPDATE
           SET user_id = ${params.add(update.userId)},
               p256dh = ${params.add(update.p256dh)},
               auth = ${params.add(update.auth)},
               user_agent = ${params.add(update.userAgent)},
               updated_at = NOW()
         RETURNING *`,
        params.values,
      );
      return subscriptionRow(rows[0] as SubscriptionSqlRow);
    },
    async delete({ where }) {
      const params = new Params();
      const { rows } = await sql.query<SubscriptionSqlRow>(
        `DELETE FROM push_subscriptions WHERE id = ${params.add(where.id)} RETURNING *`,
        params.values,
      );
      const row = rows[0];
      if (!row) throw new Error(`no push subscription ${where.id}`);
      return subscriptionRow(row);
    },
    async deleteMany({ where }) {
      const params = new Params();
      const { affectedRows } = await sql.query(
        `DELETE FROM push_subscriptions
         WHERE user_id = ${params.add(where.userId)} AND endpoint = ${params.add(where.endpoint)}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}
