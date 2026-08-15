/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the
   migrations inside the PUBLISHED @12-apps/notifications tarball apply to a real
   Postgres. Every path read is inside the installed package and the database is a
   fresh in-process PGlite per test. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * @12-apps/notifications ships its four models AND their migrations (12-15), and
 * a host applies them — the same contract `rbac-migrations` and
 * `lifecycle-migrations` pin for their tarballs, plus the one property those two
 * do not need: **replay safety per column**.
 *
 * The first adopters already HAVE these tables (the origin host created them by hand
 * before the package existed), so the migration has to be a no-op there and
 * correct on an empty database. `CREATE TABLE IF NOT EXISTS` alone is the trap
 * it must avoid — it skips the whole table, so a host whose table predates a
 * column silently never gets that column and the failure surfaces later as a
 * missing-column error in production.
 */
const notificationsPackage = fileURLToPath(
  new URL('../node_modules/@12-apps/notifications/', import.meta.url),
);
const migrationsDir = join(notificationsPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sqlOf(name: string): string {
  return readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
}

async function applyAll(pg: PGlite): Promise<void> {
  for (const name of migrations()) await pg.exec(sqlOf(name));
}

/** A fresh list per call: a shared array would be state between cases. */
const tables = (): string[] => [
  'notifications',
  'notification_deliveries',
  'notification_preferences',
  'push_subscriptions',
];

async function columnsOf(pg: PGlite, table: string): Promise<string[]> {
  const { rows } = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

describe('@12-apps/notifications — the prisma assets survive publication', () => {
  it('ships its schema partial with all four models', () => {
    const partial = readFileSync(
      join(notificationsPackage, 'prisma/notifications.prisma'),
      'utf-8',
    );
    for (const model of [
      'Notification',
      'NotificationDelivery',
      'NotificationPreference',
      'PushSubscription',
    ]) {
      expect(partial).toMatch(new RegExp(`model\\s+${model}\\s`));
    }
  });

  it('ships at least one non-empty migration', () => {
    const names = migrations();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(sqlOf(name).trim().length).toBeGreaterThan(0);
    }
  });

  it('applies in order onto a fresh Postgres and creates the four tables', async () => {
    const pg = new PGlite();
    try {
      await applyAll(pg);
      const { rows } = await pg.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const present = rows.map((row) => row.table_name);
      for (const table of tables()) expect(present).toContain(table);
    } finally {
      await pg.close();
    }
  });

  it('enforces the library closed sets (channel, status) with CHECKs', async () => {
    const pg = new PGlite();
    try {
      await applyAll(pg);
      await pg.query(
        `INSERT INTO notifications (id, user_id, type, category, title, body, updated_at)
         VALUES ('n1', 'u1', 'order.paid', 'orders', 'T', 'B', NOW())`,
      );
      await expect(
        pg.query(
          `INSERT INTO notification_deliveries (id, notification_id, channel, updated_at)
           VALUES ('d1', 'n1', 'CARRIER_PIGEON', NOW())`,
        ),
      ).rejects.toThrow(/check/i);
      await expect(
        pg.query(
          `INSERT INTO notification_deliveries (id, notification_id, channel, status, updated_at)
           VALUES ('d2', 'n1', 'EMAIL', 'MAYBE', NOW())`,
        ),
      ).rejects.toThrow(/check/i);
      // …and every value the delivery lifecycle actually uses is accepted. The
      // claim's own UPDATE writes SENDING, so a CHECK that predates it does not
      // reject a bad row — it rejects the mechanism that stops a double-send.
      for (const status of ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD']) {
        // Inserted and removed one at a time: the unique (notification, channel)
        // key is doing its job and would refuse the second row otherwise.
        await pg.query(
          `INSERT INTO notification_deliveries (id, notification_id, channel, status, updated_at)
           VALUES ('d-status', 'n1', 'EMAIL', $1, NOW())`,
          [status],
        );
        await pg.query(`DELETE FROM notification_deliveries WHERE id = 'd-status'`);
      }
    } finally {
      await pg.close();
    }
  });

  it('CONVERGES the status CHECK on a host that already has the narrow one', async () => {
    // The first adopters created these tables by hand before the package existed,
    // so they hold a `notification_deliveries_status_check` listing only QUEUED |
    // SENT | FAILED. A `pg_constraint` existence guard — the shape every other
    // constraint here uses — would find it, skip, and leave the claim's own
    // `SENDING` write rejected at runtime by a CHECK older than the claim. So the
    // status CHECK is DROPped and re-added, and this is the case that says so.
    const pg = new PGlite();
    try {
      // Both tables, and a parent row: the migration adds the internal FK, and
      // `ADD CONSTRAINT` validates the rows already there.
      await pg.exec(`
        CREATE TABLE "notifications" (
          "id" TEXT NOT NULL,
          "user_id" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "category" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "body" TEXT NOT NULL,
          CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
        );
        CREATE TABLE "notification_deliveries" (
          "id" TEXT NOT NULL,
          "notification_id" TEXT NOT NULL,
          "channel" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'QUEUED',
          CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "notification_deliveries_status_check"
            CHECK ("status" IN ('QUEUED', 'SENT', 'FAILED'))
        );
      `);
      await pg.query(
        `INSERT INTO notifications (id, user_id, type, category, title, body)
         VALUES ('n-legacy', 'u1', 'order.paid', 'orders', 'T', 'B')`,
      );
      await pg.query(
        `INSERT INTO notification_deliveries (id, notification_id, channel, status)
         VALUES ('legacy', 'n-legacy', 'EMAIL', 'SENT')`,
      );

      await applyAll(pg);

      // The retry ceiling's column arrived, at 0 for the pre-existing row.
      expect(await columnsOf(pg, 'notification_deliveries')).toContain('attempts');
      const { rows } = await pg.query<{ attempts: number }>(
        `SELECT attempts FROM notification_deliveries WHERE id = 'legacy'`,
      );
      expect(Number(rows[0]?.attempts)).toBe(0);

      // And the two new statuses are now accepted where they were not.
      await pg.query(
        `UPDATE notification_deliveries SET status = 'SENDING' WHERE id = 'legacy'`,
      );
      await pg.query(`UPDATE notification_deliveries SET status = 'DEAD' WHERE id = 'legacy'`);
      // Still closed, though — convergence is not the same as opening it up.
      await expect(
        pg.query(`UPDATE notification_deliveries SET status = 'MAYBE' WHERE id = 'legacy'`),
      ).rejects.toThrow(/check/i);
    } finally {
      await pg.close();
    }
  });

  it('moves the sweep index onto (status, updated_at)', async () => {
    // The sweep asks "has this row moved lately", which `created_at` cannot
    // answer. The index moves with the predicate, and the old one is dropped
    // rather than left behind to cost every write.
    const pg = new PGlite();
    try {
      await applyAll(pg);
      const { rows } = await pg.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'notification_deliveries' ORDER BY indexname`,
      );
      const names = rows.map((row) => row.indexname);
      expect(names).toContain('notification_deliveries_status_updated_at_idx');
      expect(names).not.toContain('notification_deliveries_status_created_at_idx');
    } finally {
      await pg.close();
    }
  });

  it('leaves `category` OPEN, because the taxonomy is host vocabulary', async () => {
    // The rbac precedent for `role`: a closed set here would be wrong for every
    // host but the first, and the package takes `categories` as config.
    const pg = new PGlite();
    try {
      await applyAll(pg);
      await pg.query(
        `INSERT INTO notifications (id, user_id, type, category, title, body, updated_at)
         VALUES ('n1', 'u1', 'invoice.due', 'invoices', 'T', 'B', NOW())`,
      );
      const { rows } = await pg.query<{ category: string }>(
        `SELECT category FROM notifications WHERE id = 'n1'`,
      );
      expect(rows[0]?.category).toBe('invoices');
    } finally {
      await pg.close();
    }
  });

  it('makes fan-out idempotent with the unique (notification, channel) key', async () => {
    const pg = new PGlite();
    try {
      await applyAll(pg);
      await pg.query(
        `INSERT INTO notifications (id, user_id, type, category, title, body, updated_at)
         VALUES ('n1', 'u1', 'order.paid', 'orders', 'T', 'B', NOW())`,
      );
      await pg.query(
        `INSERT INTO notification_deliveries (id, notification_id, channel, updated_at)
         VALUES ('d1', 'n1', 'EMAIL', NOW())`,
      );
      await expect(
        pg.query(
          `INSERT INTO notification_deliveries (id, notification_id, channel, updated_at)
           VALUES ('d2', 'n1', 'EMAIL', NOW())`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await pg.close();
    }
  });

  it('cascades deliveries when a notification is purged', async () => {
    const pg = new PGlite();
    try {
      await applyAll(pg);
      await pg.query(
        `INSERT INTO notifications (id, user_id, type, category, title, body, updated_at)
         VALUES ('n1', 'u1', 'order.paid', 'orders', 'T', 'B', NOW())`,
      );
      await pg.query(
        `INSERT INTO notification_deliveries (id, notification_id, channel, updated_at)
         VALUES ('d1', 'n1', 'EMAIL', NOW())`,
      );
      await pg.query(`DELETE FROM notifications WHERE id = 'n1'`);
      const { rows } = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM notification_deliveries`,
      );
      expect(rows[0]?.count).toBe('0');
    } finally {
      await pg.close();
    }
  });

  it('is REPLAYABLE: applying the whole set twice changes nothing and throws nothing', async () => {
    const pg = new PGlite();
    try {
      await applyAll(pg);
      const before = await Promise.all(tables().map((table) => columnsOf(pg, table)));
      await applyAll(pg);
      const after = await Promise.all(tables().map((table) => columnsOf(pg, table)));
      expect(after).toEqual(before);
    } finally {
      await pg.close();
    }
  });

  it('ADDS a missing column to a table that already exists — the per-COLUMN guard', async () => {
    // The failure this pins: an adopting host whose `notifications` table
    // predates `deleted_at`. `CREATE TABLE IF NOT EXISTS` skips the whole table,
    // so without the per-column guards the soft delete would silently never get
    // its column, and every list would 500 on a column that is not there.
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TABLE "notifications" (
          "id" TEXT NOT NULL,
          "user_id" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "category" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "body" TEXT NOT NULL,
          CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
        );
      `);
      // …and it already holds a row, which is why every added NOT NULL column
      // has to carry a DEFAULT.
      await pg.query(
        `INSERT INTO notifications (id, user_id, type, category, title, body)
         VALUES ('legacy', 'u1', 'order.paid', 'orders', 'T', 'B')`,
      );

      await applyAll(pg);

      const columns = await columnsOf(pg, 'notifications');
      for (const column of ['deleted_at', 'read_at', 'link', 'data', 'client_id', 'updated_at']) {
        expect(columns).toContain(column);
      }
      // The pre-existing row survived, and the new NOT NULL columns are filled.
      const { rows } = await pg.query<{ id: string; data: unknown; updated_at: Date }>(
        `SELECT id, data, updated_at FROM notifications WHERE id = 'legacy'`,
      );
      expect(rows[0]?.id).toBe('legacy');
      expect(rows[0]?.updated_at).toBeTruthy();
    } finally {
      await pg.close();
    }
  });
});
