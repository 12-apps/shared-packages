/**
 * The `NotificationsDb` seam, backed by a REAL Postgres (12-15).
 *
 * The same arrangement `rbac-db.ts` and `lifecycle-db.ts` give their surfaces,
 * on the four notification tables: PGlite is a real Postgres, the tables are
 * created by the PACKAGE'S OWN migrations applied out of the installed tarball,
 * and the delegates below are duck-typed against `NotificationsDb` — which the
 * package defines structurally so a host can fill it with Prisma. Prisma is what
 * a real host passes; hand-written SQL is what this harness passes, and the point
 * of the seam is that the stores cannot tell.
 *
 * The package documents its argument shapes as CLOSED sets
 * (`@12-apps/notifications/server`, `db.ts`) — anything outside them throws here
 * rather than guessing.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type {
  NotificationDelegate,
  NotificationDeliveryDelegate,
  NotificationDeliveryRow,
  NotificationDeliveryWhere,
  NotificationsDb,
  NotificationsDbClient,
  NotificationWhere,
  NotificationWhereBranch,
} from '@12-apps/notifications/server';
import type { NotificationRow } from '@12-apps/notifications';

import { preferenceDelegate, subscriptionDelegate } from './notifications-db-account';
import { Params, type SqlRunner } from './rbac-db-shared';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/notifications/prisma/migrations/', import.meta.url),
);

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyNotificationMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

interface NotificationSqlRow {
  id: string;
  user_id: string;
  client_id: string | null;
  type: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  data: unknown;
  read_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

const notificationRow = (row: NotificationSqlRow): NotificationRow => ({
  id: row.id,
  userId: row.user_id,
  clientId: row.client_id,
  type: row.type,
  category: row.category,
  title: row.title,
  body: row.body,
  link: row.link,
  data: row.data,
  readAt: row.read_at,
  deletedAt: row.deleted_at,
  createdAt: row.created_at,
});

/**
 * One filter BRANCH, translated — recursively, and that is what changed.
 *
 * This used to identify the page boundary by its POSITION (`const [older,
 * sameInstant] = where.OR`). There is a second disjunction now — the store
 * scope — so position says nothing: an `AND` key was dropped silently, and a
 * non-keyset `OR` would have read `older.createdAt.lt` off a branch that has no
 * `createdAt` at all.
 *
 * The keyset still becomes a row-value comparison rather than an OFFSET, for
 * the reason it always did: `cursor` + `skip: 1` is applied AFTER the filter,
 * so this suite's SQL had to diverge from Prisma to avoid skipping a row once
 * the anchor stopped matching. It is recognised by SHAPE now instead of by
 * index, which is the only part that moved.
 */
function branchWhere(where: NotificationWhereBranch, params: Params): string {
  const conditions: string[] = [];
  if (where.userId !== undefined) conditions.push(`user_id = ${params.add(where.userId)}`);
  if (where.readAt === null) conditions.push('read_at IS NULL');
  if (where.clientId === null) conditions.push('client_id IS NULL');
  else if (where.clientId !== undefined) {
    conditions.push(`client_id = ${params.add(where.clientId)}`);
  }
  if (typeof where.id === 'string') conditions.push(`id = ${params.add(where.id)}`);
  else if (where.id !== undefined) {
    if ('in' in where.id) {
      if (where.id.in.length === 0) return 'FALSE';
      conditions.push(`id IN (${where.id.in.map((value) => params.add(value)).join(', ')})`);
    } else {
      conditions.push(`id < ${params.add(where.id.lt)}`);
    }
  }
  if (where.createdAt instanceof Date) {
    conditions.push(`created_at = ${params.add(where.createdAt)}`);
  } else if (where.createdAt !== undefined) {
    conditions.push(`created_at < ${params.add(where.createdAt.lt)}`);
  }
  for (const branch of where.AND ?? []) conditions.push(`(${branchWhere(branch, params)})`);
  if (where.OR !== undefined) {
    const arms = where.OR.map((branch) => `(${branchWhere(branch, params)})`);
    conditions.push(arms.length > 0 ? `(${arms.join(' OR ')})` : 'FALSE');
  }
  return conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
}

/** The inbox filter, translated. `deleted_at IS NULL` is on every read. */
function notificationWhere(where: NotificationWhere, params: Params): string {
  return `deleted_at IS NULL AND (${branchWhere(where, params)})`;
}

function notificationDelegate(sql: SqlRunner): NotificationDelegate {
  return {
    async create({ data }) {
      const params = new Params();
      const { rows } = await sql.query<NotificationSqlRow>(
        `INSERT INTO notifications
           (id, user_id, client_id, type, category, title, body, link, data, updated_at)
         VALUES (${params.add(randomUUID())}, ${params.add(data.userId)},
                 ${params.add(data.clientId)}, ${params.add(data.type)},
                 ${params.add(data.category)}, ${params.add(data.title)},
                 ${params.add(data.body)}, ${params.add(data.link)},
                 ${params.add(JSON.stringify(data.data))}::jsonb, NOW())
         RETURNING *`,
        params.values,
      );
      return notificationRow(rows[0] as NotificationSqlRow);
    },
    async findUnique({ where }) {
      const params = new Params();
      const { rows } = await sql.query<NotificationSqlRow>(
        `SELECT * FROM notifications WHERE id = ${params.add(where.id)}`,
        params.values,
      );
      const row = rows[0];
      return row ? notificationRow(row) : null;
    },
    async findMany({ where, take }) {
      const params = new Params();
      const clause = notificationWhere(where, params);
      const { rows } = await sql.query<NotificationSqlRow>(
        `SELECT * FROM notifications WHERE ${clause}
         ORDER BY created_at DESC, id DESC LIMIT ${params.add(take)}`,
        params.values,
      );
      return rows.map(notificationRow);
    },
    async count({ where }) {
      const params = new Params();
      const { rows } = await sql.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM notifications WHERE ${notificationWhere(where, params)}`,
        params.values,
      );
      return Number(rows[0]?.count ?? 0);
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const assignment =
        'readAt' in data
          ? `read_at = ${params.add(data.readAt)}`
          : `deleted_at = ${params.add(data.deletedAt)}`;
      const clause = notificationWhere(where, params);
      const { affectedRows } = await sql.query(
        `UPDATE notifications SET ${assignment}, updated_at = NOW() WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

interface DeliverySqlRow {
  id: string;
  notification_id: string;
  channel: string;
  status: string;
  error: string | null;
  attempts: number;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const deliveryRow = (row: DeliverySqlRow): NotificationDeliveryRow => ({
  id: row.id,
  notificationId: row.notification_id,
  channel: row.channel,
  status: row.status,
  error: row.error,
  attempts: Number(row.attempts),
  sentAt: row.sent_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function deliveryWhere(where: NotificationDeliveryWhere, params: Params): string {
  const conditions: string[] = [];
  if (where.id !== undefined) conditions.push(`id = ${params.add(where.id)}`);
  if (where.notificationId !== undefined) {
    conditions.push(`notification_id = ${params.add(where.notificationId)}`);
  }
  if (typeof where.status === 'string') {
    conditions.push(`status = ${params.add(where.status)}`);
  } else if (where.status !== undefined) {
    if (where.status.in.length === 0) return 'FALSE';
    conditions.push(
      `status IN (${where.status.in.map((value) => params.add(value)).join(', ')})`,
    );
  }
  if (where.updatedAt !== undefined) {
    conditions.push(`updated_at < ${params.add(where.updatedAt.lt)}`);
  }
  return conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
}

function deliveryDelegate(sql: SqlRunner): NotificationDeliveryDelegate {
  return {
    async createMany({ data }) {
      if (data.length === 0) return { count: 0 };
      const params = new Params();
      const values = data
        .map(
          (entry) =>
            `(${params.add(randomUUID())}, ${params.add(entry.notificationId)}, ` +
            `${params.add(entry.channel)}, NOW())`,
        )
        .join(', ');
      // `skipDuplicates` is the unique (notification, channel) key doing its job.
      const { affectedRows } = await sql.query(
        `INSERT INTO notification_deliveries (id, notification_id, channel, updated_at)
         VALUES ${values}
         ON CONFLICT (notification_id, channel) DO NOTHING`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
    async findMany({ where, orderBy, take }) {
      const params = new Params();
      const clause = deliveryWhere(where, params);
      const order = orderBy ? 'updated_at ASC, id' : 'created_at, id';
      const limit = take === undefined ? '' : ` LIMIT ${params.add(take)}`;
      const { rows } = await sql.query<DeliverySqlRow>(
        `SELECT * FROM notification_deliveries WHERE ${clause}
         ORDER BY ${order}${limit}`,
        params.values,
      );
      return rows.map(deliveryRow);
    },
    async update({ where, data }) {
      const params = new Params();
      const assignments = [`status = ${params.add(data.status)}`];
      if ('sentAt' in data) assignments.push(`sent_at = ${params.add(data.sentAt ?? null)}`);
      if ('error' in data) assignments.push(`error = ${params.add(data.error ?? null)}`);
      const { rows } = await sql.query<DeliverySqlRow>(
        `UPDATE notification_deliveries SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = ${params.add(where.id)} RETURNING *`,
        params.values,
      );
      const row = rows[0];
      if (!row) throw new Error(`no delivery ${where.id}`);
      return deliveryRow(row);
    },
    // The CLAIM, over real SQL: one statement whose WHERE carries the
    // precondition, so `affectedRows` is the answer to "did I win it". Two
    // callers racing the same row cannot both get 1 — the second re-evaluates
    // the predicate against the row the first committed.
    async updateMany({ where, data }) {
      const params = new Params();
      const assignments = [`status = ${params.add(data.status)}`];
      if (data.attempts) {
        assignments.push(`attempts = attempts + ${params.add(data.attempts.increment)}`);
      }
      const clause = deliveryWhere(where, params);
      const { affectedRows } = await sql.query(
        `UPDATE notification_deliveries SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

function clientOver(sql: SqlRunner): NotificationsDbClient {
  return {
    notification: notificationDelegate(sql),
    notificationDelivery: deliveryDelegate(sql),
    notificationPreference: preferenceDelegate(sql),
    pushSubscription: subscriptionDelegate(sql),
  };
}

/** The seam a host fills with Prisma, filled here with SQL over PGlite. */
export function notificationsDb(pg: PGlite): NotificationsDb {
  return {
    ...clientOver(pg as unknown as SqlRunner),
    $transaction: (fn) => pg.transaction((tx) => fn(clientOver(tx as unknown as SqlRunner))),
  };
}
