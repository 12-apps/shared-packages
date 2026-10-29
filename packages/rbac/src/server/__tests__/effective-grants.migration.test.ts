import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';

import {
  readEffectiveGrants,
  type EffectiveGrantData,
  type EffectiveGrantRow,
  type RbacEffectiveGrantDelegate,
} from '../effective-grants';
import type { RbacSubjectGrants } from '../grants';

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations, test-flakiness/no-test-isolation, test-flakiness/no-long-text-match --
   The committed SQL and a real database ARE the subject: this applies the
   package's own migrations to an in-process PGlite created inside each case and
   closed at its end, and asserts what the triggers do to rbac_effective_grants.
   Mocking the file read would test a fixture instead of the bytes a host's
   `migrate deploy` runs. */

/**
 * The effective-grants triggers, on real Postgres (FUT-3985): every write that
 * can change a person's grants marks their row stale, bumps its version and
 * notifies `rbac_changed` after the commit — and a write that cannot, does not.
 * The version is what refuses a recompute that a change overtook.
 */

const migrationsDir = fileURLToPath(new URL('../../../prisma/migrations', import.meta.url));
const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const NEW_MIGRATION = '20261029120000_rbac_effective_grants';

const sqlOf = (name: string): string => readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');

async function migrated(until?: string): Promise<PGlite> {
  const db = new PGlite();
  for (const name of migrationNames) {
    if (until !== undefined && name >= until) break;
    await db.exec(sqlOf(name));
  }
  return db;
}

interface Marked {
  user_id: string;
  scope: string;
  stale: boolean;
  version: number;
}

const rowsOf = async (db: PGlite): Promise<Marked[]> =>
  (
    await db.query<Marked>(
      'SELECT user_id, scope, stale, version FROM rbac_effective_grants ORDER BY user_id, scope',
    )
  ).rows;

/** Mark every row current, as a recompute would, so the next write shows. */
const settle = (db: PGlite) => db.exec('UPDATE rbac_effective_grants SET stale = false');

async function listening(db: PGlite): Promise<string[]> {
  const heard: string[] = [];
  await db.listen('rbac_changed', (payload) => heard.push(payload));
  return heard;
}

/** Wait until `payload` was heard: every notification sent before it was too. */
const heardUpTo = (heard: string[], payload: string) =>
  vi.waitFor(() => expect(heard).toContain(payload));

/** A write that notifies `marker`: the barrier after which nothing else is in flight. */
const notifyMarker = (db: PGlite, marker: string) =>
  db.exec(`INSERT INTO role_assignments (id, user_id, role_name, scope, updated_at) VALUES ('${marker}', '${marker}', 'X', 'GLOBAL', NOW())`);

async function seedMember(db: PGlite, user: string, store: string, role: string): Promise<void> {
  await db.exec(`
    INSERT INTO roles (id, client_id, name, permissions, is_template, kind, updated_at)
      VALUES ('${store}-${role}', '${store}', '${role}', '["config:write"]', false, 'CUSTOM', NOW())
      ON CONFLICT DO NOTHING;
    INSERT INTO memberships (id, user_id, client_id, role, updated_at)
      VALUES ('m-${user}-${store}', '${user}', '${store}', '${role}', NOW());
    INSERT INTO membership_roles (id, membership_id, role_id)
      VALUES ('mr-${user}-${store}', 'm-${user}-${store}', '${store}-${role}');
  `);
}

/** The table's delegate over SQL — what a host's Prisma client does for it. */
function sqlTable(db: PGlite): RbacEffectiveGrantDelegate {
  const values = (data: EffectiveGrantData) => [
    data.membershipRole,
    data.membershipActive,
    JSON.stringify(data.assignments),
    JSON.stringify(data.resources),
    data.computedAt.toISOString(),
  ];
  return {
    async findMany({ where }) {
      const { rows } = await db.query<EffectiveGrantRow>(
        `SELECT scope, membership_role AS "membershipRole", membership_active AS "membershipActive",
                assignments, resources, stale, version
           FROM rbac_effective_grants WHERE user_id = $1`,
        [where.userId],
      );
      return rows;
    },
    async updateMany({ where, data }) {
      const result = await db.query(
        `UPDATE rbac_effective_grants
            SET membership_role = $4, membership_active = $5, assignments = $6::jsonb,
                resources = $7::jsonb, computed_at = $8, stale = false
          WHERE user_id = $1 AND scope = $2 AND version = $3`,
        [where.userId, where.scope, where.version, ...values(data)],
      );
      return { count: result.affectedRows ?? 0 };
    },
    async createMany({ data }) {
      const inserted: number[] = [];
      for (const entry of data) {
        const result = await db.query(
          `INSERT INTO rbac_effective_grants
             (user_id, scope, membership_role, membership_active, assignments, resources, computed_at, stale)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, false)
           ON CONFLICT DO NOTHING`,
          [entry.userId, entry.scope, ...values(entry)],
        );
        inserted.push(result.affectedRows ?? 0);
      }
      return { count: inserted.reduce((sum, rows) => sum + rows, 0) };
    },
    async deleteMany({ where }) {
      const result = await db.query(
        'DELETE FROM rbac_effective_grants WHERE user_id = $1 AND scope = $2 AND version = $3',
        [where.userId, where.scope, where.version],
      );
      return { count: result.affectedRows ?? 0 };
    },
  };
}

describe('the migration', () => {
  it('backfills a stale row for every person and scope holding anything', async () => {
    const db = await migrated(NEW_MIGRATION);
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      await db.exec(`
        INSERT INTO role_assignments (id, user_id, role_name, scope, updated_at)
          VALUES ('ra-1', 'bia', 'SUPPORT', 'GLOBAL', NOW());
        INSERT INTO resource_assignments (id, user_id, client_id, resource_type, resource_id)
          VALUES ('live', 'caio', 'store-b', 'tables', 't-1');
        INSERT INTO resource_assignments (id, user_id, client_id, resource_type, resource_id, valid_to)
          VALUES ('ended', 'davi', 'store-b', 'tables', 't-2', NOW() - INTERVAL '1 day');
      `);
      await db.exec(sqlOf(NEW_MIGRATION));
      expect(await rowsOf(db)).toEqual([
        { user_id: 'ana', scope: 'store-a', stale: true, version: 0 },
        { user_id: 'bia', scope: 'GLOBAL', stale: true, version: 0 },
        { user_id: 'caio', scope: 'store-b', stale: true, version: 0 },
      ]);
    } finally {
      await db.close();
    }
  });

  it('applies twice without failing', async () => {
    const db = await migrated();
    try {
      await expect(db.exec(sqlOf(NEW_MIGRATION))).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });
});

describe('the triggers mark and notify', () => {
  it('a new membership, its role link and its deactivation', async () => {
    const db = await migrated();
    try {
      const heard = await listening(db);
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      expect(await rowsOf(db)).toEqual([{ user_id: 'ana', scope: 'store-a', stale: true, version: expect.any(Number) }]);
      await settle(db);
      const before = (await rowsOf(db))[0]!.version;

      await db.exec(`UPDATE memberships SET active = false WHERE id = 'm-ana-store-a'`);
      expect(await rowsOf(db)).toEqual([{ user_id: 'ana', scope: 'store-a', stale: true, version: before + 1 }]);
      await heardUpTo(heard, 'ana');
    } finally {
      await db.close();
    }
  });

  it('a removed membership and an ended resource assignment', async () => {
    const db = await migrated();
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      await db.exec(`
        INSERT INTO resource_assignments (id, user_id, client_id, resource_type, resource_id)
          VALUES ('ra', 'bia', 'store-a', 'sectors', 'terraço');
      `);
      await settle(db);
      await db.exec(`DELETE FROM memberships WHERE id = 'm-ana-store-a'`);
      await db.exec(`UPDATE resource_assignments SET valid_to = NOW() WHERE id = 'ra'`);
      expect((await rowsOf(db)).map((row) => [row.user_id, row.stale])).toEqual([
        ['ana', true],
        ['bia', true],
      ]);
    } finally {
      await db.close();
    }
  });

  it("a role's permissions, for everyone at its store and nobody elsewhere", async () => {
    const db = await migrated();
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      await seedMember(db, 'bia', 'store-a', 'CAIXA');
      await seedMember(db, 'caio', 'store-b', 'GERENTE');
      await settle(db);
      const heard = await listening(db);
      await db.exec(`UPDATE roles SET permissions = '[]' WHERE id = 'store-a-GERENTE'`);
      expect((await rowsOf(db)).map((row) => [row.user_id, row.stale])).toEqual([
        ['ana', true],
        ['bia', true],
        ['caio', false],
      ]);
      await notifyMarker(db, 'marker');
      await heardUpTo(heard, 'marker');
      expect(heard.filter((payload) => payload !== 'marker').sort()).toEqual(['ana', 'bia']);
    } finally {
      await db.close();
    }
  });

  it('a template role, for everyone, with the `*` payload', async () => {
    const db = await migrated();
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      await settle(db);
      const heard = await listening(db);
      await db.exec(`INSERT INTO roles (id, client_id, name, permissions, updated_at) VALUES ('tpl', NULL, 'SUPPORT', '*', NOW())`);
      expect((await rowsOf(db)).every((row) => row.stale)).toBe(true);
      await heardUpTo(heard, '*');
      expect(heard).toEqual(['*']);
    } finally {
      await db.close();
    }
  });

  it('a direct role assignment, at its own scope', async () => {
    const db = await migrated();
    try {
      await db.exec(`INSERT INTO role_assignments (id, user_id, role_name, scope, updated_at) VALUES ('g', 'ana', 'SUPPORT', 'org:north', NOW())`);
      expect(await rowsOf(db)).toEqual([{ user_id: 'ana', scope: 'org:north', stale: true, version: 0 }]);
    } finally {
      await db.close();
    }
  });

  it('a TRUNCATE, for everyone', async () => {
    const db = await migrated();
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      await settle(db);
      const heard = await listening(db);
      await db.exec('TRUNCATE membership_roles');
      expect((await rowsOf(db))[0]?.stale).toBe(true);
      await heardUpTo(heard, '*');
      expect(heard).toEqual(['*']);
    } finally {
      await db.close();
    }
  });
});

describe('the triggers leave alone', () => {
  it("a membership's timestamp and a role's published version", async () => {
    const db = await migrated();
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      await settle(db);
      const heard = await listening(db);
      await db.exec(`
        UPDATE memberships SET updated_at = NOW() + INTERVAL '1 minute' WHERE id = 'm-ana-store-a';
        UPDATE roles SET published_version = published_version + 1, description = 'x' WHERE id = 'store-a-GERENTE';
      `);
      expect(await rowsOf(db)).toEqual([{ user_id: 'ana', scope: 'store-a', stale: false, version: expect.any(Number) }]);
      await notifyMarker(db, 'marker');
      await heardUpTo(heard, 'marker');
      expect(heard).toEqual(['marker']);
    } finally {
      await db.close();
    }
  });
});

describe('a recompute over the real table', () => {
  const grants: RbacSubjectGrants = {
    assignments: [{ role: 'GERENTE', scope: 'store-a', permissions: ['config:write'] }],
    resources: [
      { resourceType: 'tables', resourceId: 't-1', clientId: 'store-a', validFrom: '2026-10-29T12:00:00.000Z', validTo: null },
    ],
    memberships: [{ clientId: 'store-a', role: 'GERENTE', active: true }],
  };

  it('writes the row back current, and the next read is that one statement', async () => {
    const db = await migrated();
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      const resolves = { count: 0 };
      const options = {
        table: async () => sqlTable(db),
        resolve: async () => {
          resolves.count += 1;
          return grants;
        },
      };
      expect(await readEffectiveGrants(options, 'ana')).toEqual(grants);
      expect(await readEffectiveGrants(options, 'ana')).toEqual(grants);
      expect(resolves.count).toBe(1);
      expect((await rowsOf(db))[0]?.stale).toBe(false);
    } finally {
      await db.close();
    }
  });

  it('leaves the row stale when a trigger marked it during the recompute', async () => {
    const db = await migrated();
    try {
      await seedMember(db, 'ana', 'store-a', 'GERENTE');
      const options = {
        table: async () => sqlTable(db),
        resolve: async () => {
          await db.exec(`UPDATE memberships SET role = 'CAIXA' WHERE id = 'm-ana-store-a'`);
          return grants;
        },
      };
      await readEffectiveGrants(options, 'ana');
      expect((await rowsOf(db))[0]?.stale).toBe(true);
    } finally {
      await db.close();
    }
  });
});
