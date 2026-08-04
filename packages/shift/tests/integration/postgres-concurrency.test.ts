import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Client, type DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.SHIFT_POSTGRES_TEST_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../prisma/migrations');

async function connect(searchPath?: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  if (searchPath) await client.query(`SET search_path TO "${searchPath}"`);
  return client;
}

async function applyMigrations(admin: Client): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    await admin.query(await readFile(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
  }
}

/** The host tables the package stores by value, plus every plugin migration. */
async function provision(schema: string): Promise<Client> {
  const admin = await connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`
    CREATE TABLE "clients" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "users" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "resource_assignments" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL,
      "client_id" TEXT NOT NULL,
      "resource_type" TEXT NOT NULL,
      "resource_id" TEXT NOT NULL,
      "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "valid_to" TIMESTAMP(3)
    );
  `);
  await applyMigrations(admin);
  await admin.query(`
    INSERT INTO "clients" ("id") VALUES ('tenant-a');
    INSERT INTO "users" ("id") VALUES ('cook-a'), ('cook-b');
  `);
  return admin;
}

async function waitUntilBlocked(observer: Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ wait_event_type: string | null }>(`
      SELECT wait_event_type
        FROM pg_stat_activity
       WHERE application_name = 'shift-concurrency-racer'
    `);
    if (result.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise<void>((resolveWait) => setImmediate(resolveWait));
  }
  throw new Error('Second shift insert never blocked on the unique-index race.');
}

const TENANT = 'tenant-a';
const RESOURCE_TYPE = 'kitchen';
const RESOURCE_ID = 'grill';

/**
 * `ShiftTransaction.lockExclusiveResource`, as the Prisma host adapter issues
 * it: `pg_advisory_xact_lock` keyed by (tenant, resource), parameterised
 * exactly like the adapter rather than pasted in as literals — otherwise this
 * suite proves that hand-written SQL races correctly, not that the shipped
 * adapter does.
 */
async function lockExclusiveResource(client: Client): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [`shift-exclusive:${TENANT}`, `${RESOURCE_TYPE}:${RESOURCE_ID}`],
  );
}

/**
 * `ShiftTransaction.isResourceActive`: active = NOT YET RELEASED. `valid_from`
 * is deliberately absent — a claim that begins later still occupies the
 * resource.
 */
async function isResourceActive(client: Client, at: Date): Promise<boolean> {
  const active = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM "resource_assignments"
      WHERE "client_id" = $1
        AND "resource_type" = $2
        AND "resource_id" = $3
        AND ("valid_to" IS NULL OR "valid_to" > $4)`,
    [TENANT, RESOURCE_TYPE, RESOURCE_ID, at],
  );
  return active.rows[0]?.count !== '0';
}

/**
 * `assertOpenAllowed`'s exclusive branch, at the service's own instant:
 * `max(startedAt, now)`, so a backdated open cannot judge occupancy at a moment
 * when the incumbent had not claimed the station yet.
 */
async function exclusivePrecheck(client: Client, startedAt?: Date): Promise<boolean> {
  await lockExclusiveResource(client);
  const now = new Date();
  const at = startedAt && startedAt > now ? startedAt : now;
  return !(await isResourceActive(client, at));
}

async function claim(client: Client, user: string, suffix: string): Promise<void> {
  await client.query(
    `INSERT INTO "resource_assignments"
       ("id", "user_id", "client_id", "resource_type", "resource_id")
     VALUES ($1, $2, $3, $4, $5)`,
    [`assignment-${suffix}`, user, TENANT, RESOURCE_TYPE, RESOURCE_ID],
  );
  await client.query(
    `INSERT INTO "shifts"
       ("id", "client_id", "user_id", "kind",
        "resource_assignment_id", "resource_type", "resource_id")
     VALUES ($1, $2, $3, 'kitchen', $4, $5, $6)`,
    [`shift-${suffix}`, TENANT, user, `assignment-${suffix}`, RESOURCE_TYPE, RESOURCE_ID],
  );
}

describePostgres('shift real PostgreSQL concurrency', () => {
  it('lets exactly one concurrent open shift commit', async () => {
    const schema = `shift_${randomUUID().replaceAll('-', '_')}`;
    const admin = await provision(schema);
    const winner = await connect(schema);
    const racer = await connect(schema);
    const observer = await connect();
    try {
      await racer.query(`SET application_name = 'shift-concurrency-racer'`);
      await winner.query('BEGIN');
      await racer.query('BEGIN');
      await winner.query(`
        INSERT INTO "shifts" ("id", "client_id", "user_id", "kind")
        VALUES ('winner', 'tenant-a', 'cook-a', 'kitchen')
      `);

      const racingInsert = racer
        .query(
          `
          INSERT INTO "shifts" ("id", "client_id", "user_id", "kind")
          VALUES ('racer', 'tenant-a', 'cook-a', 'kitchen')
        `,
        )
        .then(
          () => null,
          (error: DatabaseError) => error,
        );
      await waitUntilBlocked(observer);
      await winner.query('COMMIT');

      const error = await racingInsert;
      expect(error).toMatchObject({
        code: '23505',
        constraint: 'shifts_open_client_user_key',
      });
      await racer.query('ROLLBACK');
      const count = await admin.query<{ count: string }>(
        `SELECT count(*) FROM "shifts" WHERE "ended_at" IS NULL`,
      );
      expect(count.rows[0]?.count).toBe('1');
    } finally {
      await Promise.all([winner.end(), racer.end(), observer.end()]);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('serializes exclusive resource claims across concurrent openers', async () => {
    const schema = `shift_${randomUUID().replaceAll('-', '_')}`;
    const admin = await provision(schema);
    const winner = await connect(schema);
    const racer = await connect(schema);
    const observer = await connect();

    try {
      await racer.query(`SET application_name = 'shift-concurrency-racer'`);
      await winner.query('BEGIN');
      expect(await exclusivePrecheck(winner)).toBe(true);
      await claim(winner, 'cook-a', 'a');

      const racingClaim = (async (): Promise<'taken' | 'opened'> => {
        await racer.query('BEGIN');
        // Backdated a day: before this fix that moved the occupancy question
        // to an instant where the winner's claim did not exist yet, and BOTH
        // racers committed a claim on the same exclusive station.
        const free = await exclusivePrecheck(racer, new Date(Date.now() - 86_400_000));
        if (!free) {
          await racer.query('ROLLBACK');
          return 'taken';
        }
        await claim(racer, 'cook-b', 'b');
        await racer.query('COMMIT');
        return 'opened';
      })();

      await waitUntilBlocked(observer);
      await winner.query('COMMIT');
      expect(await racingClaim).toBe('taken');

      const shifts = await admin.query<{ count: string }>(
        `SELECT count(*) FROM "shifts" WHERE "ended_at" IS NULL`,
      );
      const assignments = await admin.query<{ count: string }>(
        `SELECT count(*) FROM "resource_assignments" WHERE "valid_to" IS NULL`,
      );
      expect(shifts.rows[0]?.count).toBe('1');
      expect(assignments.rows[0]?.count).toBe('1');
    } finally {
      await Promise.all([winner.end(), racer.end(), observer.end()]);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('treats a not-yet-started exclusive claim as occupying the resource', async () => {
    const schema = `shift_${randomUUID().replaceAll('-', '_')}`;
    const admin = await provision(schema);
    const opener = await connect(schema);
    try {
      // A claim scheduled to begin in an hour, never released.
      await admin.query(
        `INSERT INTO "resource_assignments"
           ("id", "user_id", "client_id", "resource_type", "resource_id", "valid_from")
         VALUES ('assignment-future', 'cook-a', $1, $2, $3, NOW() + INTERVAL '1 hour')`,
        [TENANT, RESOURCE_TYPE, RESOURCE_ID],
      );

      await opener.query('BEGIN');
      expect(await exclusivePrecheck(opener)).toBe(false);
      await opener.query('ROLLBACK');
    } finally {
      await opener.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
