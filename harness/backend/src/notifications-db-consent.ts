/**
 * The paid-channel half of the notification db seam: per-number consent and
 * the paid-message counters, as hand-written SQL over PGlite.
 *
 * Split out of `notifications-db.ts` for size only. These are the delegates
 * whose SQL carries the concurrency contracts — the increment-below-cap, the
 * once-per-period notice, the counted code tries, the resend slot — so every
 * conditional write is ONE statement whose WHERE is its precondition, never a
 * read followed by a write.
 */
import { randomUUID } from 'node:crypto';

import type {
  ChannelConsentDelegate,
  ChannelConsentRow,
  ChannelConsentUpdateData,
  ChannelConsentWhere,
  SendCounterDelegate,
  SendCounterKey,
} from '@12-apps/notifications/server';

import { Params, stringPredicate, type SqlRunner } from './rbac-db-shared';

interface ConsentSqlRow {
  id: string;
  user_id: string;
  channel: string;
  destination: string;
  status: ChannelConsentRow['status'];
  method: ChannelConsentRow['method'];
  code_hash: string | null;
  code_expires_at: Date | null;
  code_attempts: number;
  send_count: number;
  send_window_started_at: Date | null;
  last_sent_at: Date | null;
  confirmed_at: Date | null;
  opted_out_at: Date | null;
  consent_text: string | null;
  consent_external_id: string | null;
  consent_at: Date | null;
  asked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const consentRow = (row: ConsentSqlRow): ChannelConsentRow => ({
  id: row.id,
  userId: row.user_id,
  channel: row.channel,
  destination: row.destination,
  status: row.status,
  method: row.method,
  codeHash: row.code_hash,
  codeExpiresAt: row.code_expires_at,
  codeAttempts: Number(row.code_attempts),
  sendCount: Number(row.send_count),
  sendWindowStartedAt: row.send_window_started_at,
  lastSentAt: row.last_sent_at,
  confirmedAt: row.confirmed_at,
  optedOutAt: row.opted_out_at,
  consentText: row.consent_text,
  consentExternalId: row.consent_external_id,
  consentAt: row.consent_at,
  askedAt: row.asked_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** `null` or a bound on a nullable timestamp column. */
function timePredicate(
  column: string,
  value: null | { lte: Date } | { gt: Date },
  params: Params,
): string {
  if (value === null) return `${column} IS NULL`;
  return 'lte' in value
    ? `${column} <= ${params.add(value.lte)}`
    : `${column} > ${params.add(value.gt)}`;
}

/** The equality and bound filters — one optional condition each. */
function plainConditions(where: ChannelConsentWhere, params: Params): (string | null)[] {
  const optional = (value: unknown, build: () => string): string | null =>
    value === undefined ? null : build();
  return [
    optional(where.id, () => stringPredicate('id', where.id as string | { in: string[] }, params)),
    optional(where.userId, () => `user_id = ${params.add(where.userId)}`),
    optional(where.channel, () => stringPredicate('channel', where.channel as string | { in: string[] }, params)),
    optional(where.destination, () => `destination = ${params.add(where.destination)}`),
    optional(where.status, () => stringPredicate('status', where.status as string | { in: string[] }, params)),
    optional(where.codeHash, () => `code_hash = ${params.add(where.codeHash)}`),
    optional(where.codeAttempts, () => `code_attempts < ${params.add(where.codeAttempts?.lt)}`),
    optional(where.sendCount, () => `send_count < ${params.add(where.sendCount?.lt)}`),
  ];
}

function consentWhere(where: ChannelConsentWhere, params: Params): string {
  const conditions = [
    ...plainConditions(where, params),
    where.lastSentAt !== undefined ? timePredicate('last_sent_at', where.lastSentAt, params) : null,
    where.sendWindowStartedAt !== undefined
      ? timePredicate('send_window_started_at', where.sendWindowStartedAt, params)
      : null,
    where.askedAt === null ? 'asked_at IS NULL' : null,
  ].filter((condition): condition is string => condition !== null);
  return conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
}

const COLUMNS: Record<string, string> = {
  destination: 'destination',
  status: 'status',
  method: 'method',
  codeHash: 'code_hash',
  codeExpiresAt: 'code_expires_at',
  sendWindowStartedAt: 'send_window_started_at',
  lastSentAt: 'last_sent_at',
  confirmedAt: 'confirmed_at',
  optedOutAt: 'opted_out_at',
  consentText: 'consent_text',
  consentExternalId: 'consent_external_id',
  consentAt: 'consent_at',
  askedAt: 'asked_at',
};

/** `n` sets the column; `{ increment }` adds to it in the same statement. */
function counterAssignment(column: string, value: number | { increment: number }, params: Params): string {
  return typeof value === 'number'
    ? `${column} = ${params.add(value)}`
    : `${column} = ${column} + ${params.add(value.increment)}`;
}

function consentSet(data: ChannelConsentUpdateData, params: Params): string {
  const { codeAttempts, sendCount, ...plain } = data;
  const assignments = Object.entries(plain).map(([key, value]) => {
    const column = COLUMNS[key];
    if (!column) throw new Error(`notification consent: no column for ${key}`);
    return `${column} = ${params.add(value)}`;
  });
  if (codeAttempts !== undefined) assignments.push(counterAssignment('code_attempts', codeAttempts, params));
  if (sendCount !== undefined) assignments.push(counterAssignment('send_count', sendCount, params));
  assignments.push('updated_at = NOW()');
  return assignments.join(', ');
}

export function consentDelegate(sql: SqlRunner): ChannelConsentDelegate {
  return {
    async findUnique({ where }) {
      const params = new Params();
      const { userId, channel } = where.userId_channel;
      const { rows } = await sql.query<ConsentSqlRow>(
        `SELECT * FROM notification_channel_consents
         WHERE user_id = ${params.add(userId)} AND channel = ${params.add(channel)}`,
        params.values,
      );
      const row = rows[0];
      return row ? consentRow(row) : null;
    },
    async findMany({ where, orderBy, take }) {
      const params = new Params();
      const clause = consentWhere(where, params);
      const order = orderBy ? ' ORDER BY created_at ASC, id' : ' ORDER BY id';
      const limit = take === undefined ? '' : ` LIMIT ${params.add(take)}`;
      const { rows } = await sql.query<ConsentSqlRow>(
        `SELECT * FROM notification_channel_consents WHERE ${clause}${order}${limit}`,
        params.values,
      );
      return rows.map(consentRow);
    },
    async createMany({ data }) {
      if (data.length === 0) return { count: 0 };
      const params = new Params();
      const values = data
        .map(
          (entry) =>
            `(${params.add(randomUUID())}, ${params.add(entry.userId)}, ${params.add(entry.channel)}, ` +
            `${params.add(entry.destination)}, ${params.add(entry.status)}, ${params.add(entry.method)})`,
        )
        .join(', ');
      const { affectedRows } = await sql.query(
        `INSERT INTO notification_channel_consents (id, user_id, channel, destination, status, method)
         VALUES ${values} ON CONFLICT (user_id, channel) DO NOTHING`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const assignments = consentSet(data, params);
      const clause = consentWhere(where, params);
      const { affectedRows } = await sql.query(
        `UPDATE notification_channel_consents SET ${assignments} WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
    async deleteMany({ where }) {
      const params = new Params();
      const { affectedRows } = await sql.query(
        `DELETE FROM notification_channel_consents WHERE ${consentWhere(where, params)}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

function counterKey(key: SendCounterKey, params: Params): string {
  return (
    `scope = ${params.add(key.scope)} AND subject_id = ${params.add(key.subjectId)} ` +
    `AND period = ${params.add(key.period)}`
  );
}

type CounterUpdate = Parameters<SendCounterDelegate['updateMany']>[0];

function counterSet(data: CounterUpdate['data'], params: Params): string {
  const assignments: string[] = [];
  if (data.count && 'increment' in data.count) assignments.push(`count = count + ${params.add(data.count.increment)}`);
  if (data.count && 'decrement' in data.count) assignments.push(`count = count - ${params.add(data.count.decrement)}`);
  if (data.notifiedAt) assignments.push(`notified_at = ${params.add(data.notifiedAt)}`);
  assignments.push('updated_at = NOW()');
  return assignments.join(', ');
}

/**
 * The key, plus the precondition. Postgres re-evaluates `count < cap` against
 * the row a concurrent UPDATE committed, so the cap cannot be passed.
 */
function counterConditions(where: CounterUpdate['where'], params: Params): string {
  const conditions = [counterKey(where, params)];
  if (where.count && 'lt' in where.count) conditions.push(`count < ${params.add(where.count.lt)}`);
  if (where.count && 'gt' in where.count) conditions.push(`count > ${params.add(where.count.gt)}`);
  if (where.notifiedAt === null) conditions.push('notified_at IS NULL');
  return conditions.join(' AND ');
}

export function counterDelegate(sql: SqlRunner): SendCounterDelegate {
  return {
    async createMany({ data }) {
      if (data.length === 0) return { count: 0 };
      const params = new Params();
      const values = data
        .map((key) => `(${params.add(key.scope)}, ${params.add(key.subjectId)}, ${params.add(key.period)})`)
        .join(', ');
      const { affectedRows } = await sql.query(
        `INSERT INTO notification_send_counters (scope, subject_id, period) VALUES ${values}
         ON CONFLICT (scope, subject_id, period) DO NOTHING`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const assignments = counterSet(data, params);
      const conditions = counterConditions(where, params);
      const { affectedRows } = await sql.query(
        `UPDATE notification_send_counters SET ${assignments} WHERE ${conditions}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}
