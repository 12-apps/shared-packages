/**
 * The `SavedReportDb` seam, backed by a REAL Postgres.
 *
 * This is the half of the harness that used to be a closure over an array. A
 * closure answers every question the routes ask, which is exactly why it could
 * not answer the one a consumer cares about: does the document survive the
 * request that wrote it. It did not — the browser held the array, so a reload
 * threw the work away and no save ever left the tab.
 *
 * PGlite is a real Postgres, so the table is created by the PACKAGE'S OWN
 * migrations, applied out of the installed tarball exactly as a host's
 * `prisma migrate deploy` would apply them. Nothing here restates the schema:
 * a column the package adds arrives with its migration, and a column it drops
 * takes this file's SQL down with it, loudly.
 *
 * The delegate below is duck-typed against `SavedReportDb`, which the package
 * defines structurally so a host can fill it with Prisma. Prisma is what a
 * real host passes; hand-written SQL is what this harness passes, and the
 * point of the seam is that the routes cannot tell.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type { SavedReportDb } from '@12-apps/report-builder/server';

import { NOW } from './fixtures/report-fixture-window';
import { seedRows, type StoredRow } from './fixtures/report-saved-fixture';

/**
 * The package's migrations, located by PATH inside the installed package.
 *
 * The same idiom `tests/migrations.test.ts` uses, and for the same reason:
 * these are shipped ASSETS rather than module entry points, the package
 * exports no `./package.json`, and `require.resolve` against one throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED today.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/report-builder/prisma/migrations/', import.meta.url),
);

/** Whose reports these are — the actor's `clientId`, and the only tenant here. */
export const HARNESS_CLIENT_ID = 'harness';

/**
 * The SELECT list — every column `summarySelect` asks for.
 *
 * The timestamps are read as EPOCH MILLIS rather than as columns, and that is
 * not a style choice. `created_at` is `timestamp(3)` — no time zone — and a
 * driver parses one through the HOST machine's zone: a row written at 12:00Z
 * reads back as 15:00Z under `TZ=America/Sao_Paulo`. Prisma's convention is
 * that the naive column holds UTC, `EXTRACT(EPOCH …)` reads it that way, and
 * the result is the same instant on every machine. A three-hour drift in
 * `updatedAt` is invisible until a card claims a report was edited in the
 * future.
 */
const SELECT = `id, name, description, spec, status, visibility, visibility_roles,
  default_range, working_copy, created_by,
  EXTRACT(EPOCH FROM created_at) * 1000 AS created_ms,
  EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_ms`;

/** One row as Postgres hands it back: snake_case, timestamps as epoch millis. */
interface DbRow {
  id: string;
  name: string;
  description: string | null;
  spec: unknown;
  status: string;
  visibility: string;
  visibility_roles: unknown;
  default_range: string | null;
  working_copy: unknown;
  created_by: string | null;
  created_ms: string | number;
  updated_ms: string | number;
}

/** The record shape the package's store reads, plus the two later columns. */
type SavedRecord = StoredRow & { defaultRange: string | null; workingCopy: unknown };

/** Postgres → the record shape the package's store reads. */
function toRecord(row: DbRow): SavedRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    spec: row.spec,
    status: row.status,
    visibility: row.visibility,
    visibilityRoles: row.visibility_roles,
    defaultRange: row.default_range,
    workingCopy: row.working_copy,
    createdBy: row.created_by,
    createdAt: new Date(Number(row.created_ms)),
    updatedAt: new Date(Number(row.updated_ms)),
  };
}

/**
 * A unique-name collision, in the shape the package already knows how to read.
 *
 * `isUniqueNameViolation` looks for Prisma's `P2002`; Postgres raises `23505`.
 * Translating it here is what makes "já existe um relatório com esse nome"
 * reach the author as a field error instead of a 500 — the same translation a
 * Prisma-backed host gets for free.
 */
function translate(error: unknown): unknown {
  const raised = error as { code?: string; message?: string } | null;
  const duplicate =
    raised?.code === '23505' || /duplicate key value|unique constraint/i.test(raised?.message ?? '');
  if (!duplicate) return error;
  return Object.assign(new Error('Já existe um relatório com esse nome.'), { code: 'P2002' });
}

/** JSON columns travel as text and are cast at the placeholder. */
function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** The document columns a write may set, and how each value reaches Postgres. */
const WRITABLE: Record<string, { column: string; cast: string; encode: (v: unknown) => unknown }> = {
  name: { column: 'name', cast: '', encode: (v) => v },
  description: { column: 'description', cast: '', encode: (v) => v ?? null },
  spec: { column: 'spec', cast: '::jsonb', encode: json },
  status: { column: 'status', cast: '', encode: (v) => v },
  visibility: { column: 'visibility', cast: '', encode: (v) => v },
  visibilityRoles: { column: 'visibility_roles', cast: '::jsonb', encode: json },
  defaultRange: { column: 'default_range', cast: '', encode: (v) => v ?? null },
  workingCopy: { column: 'working_copy', cast: '::jsonb', encode: json },
};

/** A `$n`-numbered parameter list, and the only way to add one. */
type Bind = (value: unknown, cast?: string) => string;

/**
 * A statement being built: its bound parameters, and a way to add one.
 *
 * The placeholder number IS the parameter's position, so the two can only stay
 * in step if one call produces both.
 */
function binder(): { params: unknown[]; bind: Bind } {
  const params: unknown[] = [];
  return {
    params,
    bind(value, cast = '') {
      params.push(value);
      return `$${params.length}${cast}`;
    },
  };
}

/** The `column`/`$n` pairs for exactly the document fields a write named. */
function documentFields(
  data: Record<string, unknown>,
  bind: Bind,
): Array<{ column: string; placeholder: string }> {
  return Object.entries(data).flatMap(([field, value]) => {
    const spec = WRITABLE[field];
    if (!spec) return [];
    return [{ column: spec.column, placeholder: bind(spec.encode(value), spec.cast) }];
  });
}

/** A fresh id for a created document — `r1`…`r7` are the fixture's own. */
function newId(): string {
  return `rel-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Every seeded document, in one statement.
 *
 * One statement rather than seven so a reset is ATOMIC: a spec reading the
 * list while another one resets sees the fixture before or after, never four
 * of its seven cards.
 */
async function insertSeed(pg: PGlite, rows: StoredRow[]): Promise<void> {
  const { params, bind } = binder();
  const tuples = rows.map((row) =>
    [
      bind(row.id),
      bind(HARNESS_CLIENT_ID),
      bind(row.name),
      bind(row.description),
      bind(json(row.spec), '::jsonb'),
      bind(row.status),
      bind(row.visibility),
      bind(json(row.visibilityRoles), '::jsonb'),
      bind(row.createdBy),
      bind(row.createdAt.toISOString(), '::timestamp'),
      bind(row.updatedAt.toISOString(), '::timestamp'),
    ].join(', '),
  );
  await pg.query(
    `INSERT INTO saved_reports
       (id, client_id, name, description, spec, status, visibility, visibility_roles,
        created_by, created_at, updated_at)
     VALUES ${tuples.map((tuple) => `(${tuple})`).join(', ')}`,
    params,
  );
}

/**
 * Back to the fixture, exactly.
 *
 * With real persistence a case that archives `r1` leaves it archived for the
 * next one, so the suite would pass once and then fail forever — the failure
 * mode the in-browser backend hid by rebuilding its array on every page load.
 * This is the replacement for that, and it is deliberately a whole-table
 * rewrite rather than a diff: a document a spec CREATED is not in the fixture,
 * so nothing short of emptying the table describes "the state the suite starts
 * from".
 */
export async function reseed(pg: PGlite): Promise<void> {
  const rows = seedRows();
  await pg.transaction(async (tx) => {
    await tx.query('DELETE FROM saved_reports');
    await insertSeed(tx as unknown as PGlite, rows);
  });
}

/**
 * A migrated, seeded database.
 *
 * In memory, not on disk. A `dataDir` would survive a server restart, which
 * sounds like the more honest persistence right up until the suite inherits
 * yesterday's archived `r1` — and what is being proven here is that a document
 * survives the REQUEST and the reload, which an in-process Postgres proves
 * without becoming a state file nobody remembers to delete.
 */
export async function openReportsDb(): Promise<PGlite> {
  const pg = new PGlite();
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // Zero would leave every query below failing on a missing table, reported as
  // "relation saved_reports does not exist" rather than as the packaging
  // mistake it is.
  if (names.length === 0) throw new Error(`No report-builder migrations at ${MIGRATIONS_DIR}`);
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
  await reseed(pg);
  return pg;
}

/** `INSERT` one document and hand back the row Postgres actually wrote. */
async function insertDocument(
  pg: PGlite,
  stamp: string,
  data: Record<string, unknown>,
): Promise<SavedRecord> {
  const { params, bind } = binder();
  const columns = [
    { column: 'id', placeholder: bind(newId()) },
    { column: 'client_id', placeholder: bind(data.clientId) },
    { column: 'created_by', placeholder: bind(data.createdBy ?? null) },
    { column: 'created_at', placeholder: bind(stamp, '::timestamp') },
    { column: 'updated_at', placeholder: bind(stamp, '::timestamp') },
    ...documentFields(data, bind),
  ];
  const { rows } = await pg.query<DbRow>(
    `INSERT INTO saved_reports (${columns.map((c) => c.column).join(', ')})
     VALUES (${columns.map((c) => c.placeholder).join(', ')})
     RETURNING ${SELECT}`,
    params,
  );
  // RETURNING hands back the row just written; an insert that matched nothing
  // is not a state Postgres can reach.
  return toRecord(rows[0] as DbRow);
}

/**
 * The delegate, tenant-scoped in every `where` the way the package's store
 * writes them: a foreign id matches 0 rows and is a no-op, never a leak.
 *
 * `createdAt`/`updatedAt` are stamped from the FROZEN clock rather than
 * `now()`, for the same reason the router is handed one: a report saved during
 * a run must not be dated by the wall clock, or the card's "há 2 min" reads
 * against a different today than every window on the screen beside it.
 */
export function savedReportDb(pg: PGlite): SavedReportDb {
  const stamp = NOW.toISOString();

  return {
    savedReport: {
      async findMany({ where }: { where: { clientId: string } }) {
        const { rows } = await pg.query<DbRow>(
          `SELECT ${SELECT} FROM saved_reports WHERE client_id = $1 ORDER BY name ASC`,
          [where.clientId],
        );
        return rows.map(toRecord);
      },

      async findFirst({ where }: { where: { id?: string; clientId: string } }) {
        const { rows } = await pg.query<DbRow>(
          `SELECT ${SELECT} FROM saved_reports WHERE client_id = $1 AND id = $2 LIMIT 1`,
          [where.clientId, where.id ?? ''],
        );
        const row = rows[0];
        return row ? toRecord(row) : null;
      },

      async create({ data }: { data: Record<string, unknown> }) {
        try {
          return await insertDocument(pg, stamp, data);
        } catch (error) {
          throw translate(error);
        }
      },

      async updateMany({
        where,
        data,
      }: {
        where: { id?: string; clientId: string };
        data: Record<string, unknown>;
      }) {
        const { params, bind } = binder();
        const sets = documentFields(data, bind).map((c) => `${c.column} = ${c.placeholder}`);
        const touched = `updated_at = ${bind(stamp, '::timestamp')}`;
        const scope = `client_id = ${bind(where.clientId)} AND id = ${bind(where.id ?? '')}`;
        try {
          const result = await pg.query(
            `UPDATE saved_reports SET ${[...sets, touched].join(', ')} WHERE ${scope}`,
            params,
          );
          return { count: result.affectedRows ?? 0 };
        } catch (error) {
          throw translate(error);
        }
      },

      async deleteMany({ where }: { where: { id?: string; clientId: string } }) {
        const result = await pg.query('DELETE FROM saved_reports WHERE client_id = $1 AND id = $2', [
          where.clientId,
          where.id ?? '',
        ]);
        return { count: result.affectedRows ?? 0 };
      },
    },
  } as unknown as SavedReportDb;
}
