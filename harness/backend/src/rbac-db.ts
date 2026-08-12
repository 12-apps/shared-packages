/**
 * The `RbacDb` seam, backed by a REAL Postgres (12-13).
 *
 * The same arrangement `saved-report-db.ts` gives the reports surface, on
 * five tables instead of one: PGlite is a real Postgres, the tables are
 * created by the PACKAGE'S OWN migrations applied out of the installed
 * tarball, and the delegates (in `rbac-db-roles.ts` / `rbac-db-team.ts`) are
 * duck-typed against `RbacDb` — which the package defines structurally so a
 * host can fill it with Prisma. Prisma is what a real host passes;
 * hand-written SQL is what this harness passes, and the point of the seam is
 * that the routes cannot tell.
 *
 * The package documents its argument shapes as CLOSED sets
 * (`@12-apps/rbac/server`, `db.ts`), which is what makes a finite translation
 * like this possible at all. Anything outside those shapes throws in the
 * delegates rather than guessing — a new query shape upstream should fail
 * this harness loudly, not silently return everything.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type { RbacDb, RbacDbClient } from '@12-apps/rbac/server';

import { roleDelegate } from './rbac-db-roles';
import {
  membershipDelegate,
  membershipRoleDelegate,
  resourceAssignmentDelegate,
  roleAssignmentDelegate,
} from './rbac-db-team';
import type { SqlRunner } from './rbac-db-shared';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/rbac/prisma/migrations/', import.meta.url),
);

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyRbacMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

function clientOver(sql: SqlRunner): RbacDbClient {
  return {
    role: roleDelegate(sql),
    membership: membershipDelegate(sql),
    membershipRole: membershipRoleDelegate(sql),
    roleAssignment: roleAssignmentDelegate(sql),
    resourceAssignment: resourceAssignmentDelegate(sql),
  };
}

/** The seam a host fills with Prisma, filled here with SQL over PGlite. */
export function rbacDb(pg: PGlite): RbacDb {
  return {
    ...clientOver(pg as unknown as SqlRunner),
    $transaction: (fn) =>
      pg.transaction((tx) => fn(clientOver(tx as unknown as SqlRunner))),
  };
}
