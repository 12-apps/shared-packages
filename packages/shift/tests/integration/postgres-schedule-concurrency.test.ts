import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  ShiftScheduleError,
  createShiftScheduleService,
  type ShiftScheduleDb,
  type ShiftSlot,
} from '../../src/index';

const databaseUrl = process.env.SHIFT_POSTGRES_TEST_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../prisma/migrations');
const RACER = 'shift-schedule-racer';

async function connect(schema: string, applicationName?: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl, application_name: applicationName });
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);
  return client;
}

async function provision(schema: string): Promise<Client> {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`
    CREATE TABLE "resource_assignments" (
      "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "client_id" TEXT NOT NULL,
      "resource_type" TEXT NOT NULL, "resource_id" TEXT NOT NULL,
      "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "valid_to" TIMESTAMP(3)
    );
  `);
  const dirs = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    await admin.query(await readFile(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
  }
  return admin;
}

interface SlotRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
}

/**
 * The writes `scheduleSlot` makes, over one pg connection per transaction, with
 * `lockUserSchedule` as the host adapter issues it: a transaction-scoped
 * advisory lock keyed by (tenant, user). `onAudit` lets a test hold the
 * transaction open after its insert.
 */
function pgScheduleDb(schema: string, options: { applicationName?: string; onAudit?: () => Promise<void> } = {}) {
  const db: Pick<ShiftScheduleDb, 'transaction'> = {
    async transaction(work) {
      const client = await connect(schema, options.applicationName);
      try {
        await client.query('BEGIN');
        const result = await work({
          lockUserSchedule: async (clientId, userId) => {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
              `shift-schedule:${clientId}`,
              userId,
            ]);
          },
          listLiveOverlapping: async (clientId, userId, from, to) => {
            const rows = await client.query<SlotRow>(
              `SELECT "id", "starts_at", "ends_at" FROM "shift_slots"
                WHERE "client_id" = $1 AND "user_id" = $2 AND "canceled_at" IS NULL
                  AND "starts_at" < $4 AND $3 < "ends_at"`,
              [clientId, userId, from, to],
            );
            return rows.rows.map((row) => ({ id: row.id, startsAt: row.starts_at, endsAt: row.ends_at }) as ShiftSlot);
          },
          getSlot: async () => null,
          createSlots: async (slots) => {
            for (const slot of slots) {
              await client.query(
                `INSERT INTO "shift_slots"
                   ("id", "client_id", "user_id", "kind", "starts_at", "ends_at", "series_id", "created_by_user_id")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [slot.id, slot.clientId, slot.userId, slot.kind, slot.startsAt, slot.endsAt, slot.seriesId, slot.createdByUserId],
              );
            }
          },
          cancelSlots: async () => [],
          listSeriesFrom: async () => [],
          writeAudit: async () => {
            await options.onAudit?.();
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.end();
      }
    },
  };
  return createShiftScheduleService(
    { ...db, listSlots: async () => [], listUpcoming: async () => [] },
    { kinds: ['ward'] as const },
  );
}

async function waitUntilBlocked(observer: Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ wait_event_type: string | null }>(
      `SELECT wait_event_type FROM pg_stat_activity WHERE application_name = $1`,
      [RACER],
    );
    if (result.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise<void>((resolveWait) => setImmediate(resolveWait));
  }
  throw new Error('The second writer never waited on the schedule lock.');
}

describePostgres('shift schedule real PostgreSQL concurrency', () => {
  it('makes a concurrent writer of the same worker wait, then refuses its overlap', async () => {
    const schema = `shift_schedule_${randomUUID().replaceAll('-', '_')}`;
    const admin = await provision(schema);
    const observer = await connect(schema);
    const gate = { open: (): void => undefined };
    const held = new Promise<void>((release) => {
      gate.open = release;
    });
    const inserted = { signal: (): void => undefined };
    const winnerInserted = new Promise<void>((signal) => {
      inserted.signal = signal;
    });
    try {
      const start = new Date(Date.now() + 86_400_000);
      const input = {
        clientId: 'clinic-a',
        userId: 'nurse-1',
        kind: 'ward' as const,
        actorUserId: 'head-1',
        startsAt: start,
        endsAt: new Date(start.getTime() + 4 * 3_600_000),
      };
      const winner = pgScheduleDb(schema, {
        onAudit: async () => {
          inserted.signal();
          await held;
        },
      }).scheduleSlot(input);
      await winnerInserted;
      const racer = pgScheduleDb(schema, { applicationName: RACER })
        .scheduleSlot({ ...input, startsAt: new Date(start.getTime() + 3_600_000) })
        .then(
          () => null,
          (error: unknown) => error,
        );
      await waitUntilBlocked(observer);
      gate.open();
      await winner;
      const error = await racer;
      expect(error).toBeInstanceOf(ShiftScheduleError);
      expect((error as ShiftScheduleError).code).toBe('SLOT_OVERLAP');
      const count = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM "shift_slots"`);
      expect(count.rows[0]?.n).toBe(1);
    } finally {
      await observer.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
