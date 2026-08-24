/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the
   migrations inside the PUBLISHED @12-apps/product-research tarball apply to a
   real Postgres. Every path read is inside the installed package and the
   database is a fresh in-process PGlite per case. */
/* eslint-disable test-flakiness/no-test-isolation -- the handle these cases use
   is a per-case LOCAL: `withDb` opens a PGlite, hands it to one case and closes
   it in a `finally`, so no two cases can ever see the same database. That is
   the isolation the rule asks for; its heuristic cannot follow a handle through
   a callback parameter. Holding it in a module-scoped `let` instead — what the
   rule's message suggests — is what these cases must NOT do, since several of
   them apply a DIFFERENT PREFIX of the folder on purpose. */
/**
 * `@12-apps/product-research` ships five models and EIGHT migrations, and no
 * harness had ever applied any of them.
 *
 * Eight is what makes this suite worth writing rather than copying. Where
 * `rbac-migrations.test.ts` pins a single migration that creates its tables,
 * this folder is a HISTORY: three of the eight change a decision the first one
 * made, and each of those is only observable by applying a PREFIX of the folder
 * and then the migration that revises it. A suite that applied all eight and
 * looked at the result would see the end state and could not tell whether the
 * step that produced it did anything at all.
 *
 * The standout is the integration singleton (`20260729090000`), which is a DATA
 * migration before it is a schema one: it deletes duplicate integration rows
 * and only then creates the unique index that would have refused them. Applied
 * to an empty database — the only way every other suite here applies anything —
 * the DELETE is a no-op and the case proves nothing. So this one seeds the
 * duplicates first, which is the state a real adopter's database was in.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const researchPackage = fileURLToPath(
  new URL('../node_modules/@12-apps/product-research/', import.meta.url),
);
const migrationsDir = join(researchPackage, 'prisma/migrations');

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

/**
 * A database of its own, per case, carrying the first `upTo` migrations.
 *
 * `upTo` is the whole point: a case that wants to see what a revision DID has
 * to stand in the world before it. Omitted means the full folder.
 */
async function withDb(
  work: (db: PGlite) => Promise<void>,
  upTo: number = Number.MAX_SAFE_INTEGER,
): Promise<void> {
  const db = new PGlite();
  await db.waitReady;
  try {
    for (const name of migrations().slice(0, upTo)) await db.exec(sqlOf(name));
    await work(db);
  } finally {
    await db.close();
  }
}

/** The index of a migration in the folder, by the distinctive part of its name. */
function indexOf(fragment: string): number {
  const at = migrations().findIndex((name) => name.includes(fragment));
  expect(at, `no migration named …${fragment}…`).toBeGreaterThanOrEqual(0);
  return at;
}

/** One price source, from fields — every case varies one or two. */
function insertSource(
  db: PGlite,
  row: { id: string; client_id?: string; type?: string; name?: string; created_at?: string },
): Promise<unknown> {
  const fields = { client_id: 'c1', type: 'SERP', name: row.id, ...row };
  const created = fields.created_at ? `'${fields.created_at}'` : 'now()';
  return db.query(
    `INSERT INTO price_sources (id, client_id, type, name, created_at, updated_at)
     VALUES ('${fields.id}', '${fields.client_id}', '${fields.type}', '${fields.name}',
             ${created}, now())`,
  );
}

/** Every table the public schema holds, in name order. */
async function tableNames(db: PGlite): Promise<string[]> {
  const result = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

describe('the prisma assets survive publication', () => {
  it('ships a partial naming all five models', () => {
    const partial = readFileSync(join(researchPackage, 'prisma/product-research.prisma'), 'utf-8');
    for (const model of [
      'PriceSource',
      'ResearchRequest',
      'ResearchRun',
      'SupplierOffer',
      'ManualPriceEntry',
    ]) {
      expect(partial).toMatch(new RegExp(`model\\s+${model}\\s`));
    }
    expect(migrations()).toHaveLength(8);
  });

  it('applies the whole folder, in order, to a real Postgres', async () => {
    await withDb(async (db) => {
      const tables = await tableNames(db);
      for (const table of [
        'price_sources',
        'research_requests',
        'research_runs',
        'supplier_offers',
        'manual_price_entries',
      ]) {
        expect(tables).toContain(table);
      }
    });
  });
});

describe('the integration singleton, and the rows it had to delete first', () => {
  /**
   * The case the empty database cannot make.
   *
   * `20260729090000` is a DATA migration before it is a schema one: it deletes
   * duplicate integration rows, THEN creates the unique index that would have
   * refused them. Applied to an empty database the DELETE is a no-op — so the
   * only way to see it work is to be the adopter it was written for, with the
   * duplicates already in the table.
   *
   * Which row survives is also a decision, and it is the OLDEST: the merchant's
   * first connection is the one their credentials are on.
   */
  it('keeps the oldest of a client duplicate integrations and drops the rest', async () => {
    const singleton = indexOf('integration_source_singleton');
    await withDb(async (db) => {
      await insertSource(db, { id: 'serp-old', created_at: '2026-01-01T00:00:00Z' });
      await insertSource(db, { id: 'serp-new', created_at: '2026-06-01T00:00:00Z' });
      // A second client's row must survive untouched — the constraint is per
      // tenant, and a DELETE that reached across tenants would be silent.
      await insertSource(db, { id: 'serp-other', client_id: 'c2' });
      // A non-integration type is not a singleton at all: a merchant may have
      // many manual catalogues.
      await insertSource(db, { id: 'cat-1', type: 'MANUAL' });
      await insertSource(db, { id: 'cat-2', type: 'MANUAL' });

      await db.exec(sqlOf(migrations()[singleton] as string));

      const { rows } = await db.query<{ id: string }>('SELECT id FROM price_sources ORDER BY id');
      expect(rows.map((row) => row.id)).toEqual(['cat-1', 'cat-2', 'serp-old', 'serp-other']);
    }, singleton);
  });

  it('refuses a second integration of the same type afterwards', async () => {
    await withDb(async (db) => {
      await insertSource(db, { id: 's1', type: 'AMAZON' });
      await expect(insertSource(db, { id: 's2', type: 'AMAZON' })).rejects.toThrow(
        /price_sources_client_id_integration_type_key|unique/i,
      );

      // The same type in another tenant is a different connection.
      await expect(
        insertSource(db, { id: 's3', type: 'AMAZON', client_id: 'c2' }),
      ).resolves.toBeDefined();

      // And a type outside the integration set is still free to repeat.
      await insertSource(db, { id: 'm1', type: 'MANUAL' });
      await expect(insertSource(db, { id: 'm2', type: 'MANUAL' })).resolves.toBeDefined();
    });
  });
});

describe('what the later migrations revise', () => {
  /**
   * `20260729120000` makes the name unique only among LIVE rows.
   *
   * Before it, a source's name was taken forever: archiving one and creating a
   * replacement with the same name was refused, which is what an operator does
   * after a mistyped connection. Seen by applying the folder up to that
   * migration, archiving, and reusing the name.
   */
  it('frees a source name once the row is archived', async () => {
    await withDb(async (db) => {
      await insertSource(db, { id: 'a', type: 'MANUAL', name: 'Fornecedor Central' });
      await expect(
        insertSource(db, { id: 'b', type: 'MANUAL', name: 'Fornecedor Central' }),
      ).rejects.toThrow(/unique/i);

      await db.query(`UPDATE price_sources SET archived_at = now() WHERE id = 'a'`);
      await expect(
        insertSource(db, { id: 'b', type: 'MANUAL', name: 'Fornecedor Central' }),
      ).resolves.toBeDefined();
    });
  });

  /**
   * `20260729140000` backfills `term_normalized`, and the backfill is the part
   * worth pinning: it runs over rows that ALREADY EXIST, so a host adopting it
   * gets its history searchable or does not.
   */
  it('backfills the normalized term over rows written before the column existed', async () => {
    const normalize = indexOf('research_term_normalized');
    await withDb(async (db) => {
      await db.query(
        `INSERT INTO research_requests (id, client_id, term, quantity)
         VALUES ('r1', 'c1', '  Café  Torrado & Moído  ', 1)`,
      );

      await db.exec(sqlOf(migrations()[normalize] as string));

      const { rows } = await db.query<{ term_normalized: string }>(
        `SELECT term_normalized FROM research_requests WHERE id = 'r1'`,
      );
      // Accents folded, punctuation outside `,.` collapsed to a space, trimmed.
      // A shopper typing "cafe torrado" has to find what an operator saved as
      // "Café Torrado", which is the whole reason the column exists.
      expect(rows[0]?.term_normalized).toBe('cafe torrado moido');
    }, normalize);
  });

  /**
   * `20260731000000` drops NOT NULL and the default from `shipping_cents`.
   *
   * NULL and 0 stop meaning the same thing: unknown shipping is not free
   * shipping, and an offer ranked as if it were would undercut every honest
   * one. Only visible as a DIFFERENCE between the two states of the column, so
   * this case stands on each side of the migration in turn.
   */
  it('lets an offer say its shipping is unknown rather than free', async () => {
    const unknown = indexOf('offer_shipping_unknown');

    await withDb(async (db) => {
      await seedRun(db);
      // Before: the column refuses NULL, so "unknown" had to be written as 0 —
      // which is a claim about the price rather than an absence of one.
      await expect(insertOffer(db, 'o1', 'NULL')).rejects.toThrow(/null/i);
      await expect(insertOffer(db, 'o2', '0')).resolves.toBeDefined();
    }, unknown);

    await withDb(async (db) => {
      await seedRun(db);
      await expect(insertOffer(db, 'o3', 'NULL')).resolves.toBeDefined();
    });
  });

  it('defaults an offer to inside the delivery area', async () => {
    await withDb(async (db) => {
      await seedRun(db);
      await insertOffer(db, 'o4', '0');
      const { rows } = await db.query<{ outside_delivery_area: boolean }>(
        `SELECT outside_delivery_area FROM supplier_offers WHERE id = 'o4'`,
      );
      // FALSE rather than NULL: an offer whose reach nobody stated is offered,
      // and a host that wanted "unknown" would have to say so in a column of
      // its own.
      expect(rows[0]?.outside_delivery_area).toBe(false);
    });
  });
});

/**
 * One offer with a stated `shipping_cents`, passed as SQL so a case can hand it
 * `NULL` — which is the whole subject of the migration above, and something a
 * bound parameter would turn back into a value.
 *
 * `source_id` is left NULL: the offers here are about their own columns, and a
 * price source would be a second row to keep in step for no assertion's sake.
 */
function insertOffer(db: PGlite, id: string, shippingCents: string): Promise<unknown> {
  return db.query(
    `INSERT INTO supplier_offers (id, client_id, run_id, source_type, supplier_name, title,
                                  price_cents, shipping_cents, unit_price_cents, total_cents,
                                  relevance_score, rank, created_at)
     VALUES ('${id}', 'c1', 'run-1', 'MANUAL', 'Fornecedor', 'Café', 1000, ${shippingCents},
             1000, 1000, 0.5, 1, now())`,
  );
}

/** The request + run an offer hangs off, since offers carry both ids. */
async function seedRun(db: PGlite): Promise<void> {
  await db.query(
    `INSERT INTO research_requests (id, client_id, term, quantity)
     VALUES ('req-1', 'c1', 'cafe', 1)`,
  );
  await db.query(
    `INSERT INTO research_runs (id, client_id, request_id, status, created_at, updated_at)
     VALUES ('run-1', 'c1', 'req-1', 'COMPLETED', now(), now())`,
  );
}
