/**
 * The `ResearchHttpStore` seam, backed by a REAL Postgres (PGlite).
 *
 * The same arrangement `rbac-db.ts`, `discounts-db.ts` and `shift-db.ts` give
 * their surfaces, on the five tables `@12-apps/product-research` ships —
 * created by the PACKAGE'S OWN eight migrations, applied out of the installed
 * tarball, so nothing here restates the schema.
 *
 * ## Why the views come back as the HOST shapes them
 *
 * Four of these methods are typed `Promise<unknown>`, and that is the contract
 * rather than a gap: the package's own comment says "views come back exactly as
 * the host's clients read them; the package never reshapes rows". So a store is
 * free to answer whatever its clients already expect, and this one answers a
 * small, explicit shape — which is what makes the endpoint suite able to assert
 * that the package passed it through untouched.
 *
 * ## Credentials are stored ENCRYPTED and read back scrubbed
 *
 * `requireSource` promises "the target source with its stored (already
 * scrubbed) config", so the store — not the package — is where the secret stops
 * travelling. This one keeps the ciphertext and the hint in the row's `config`
 * and strips the ciphertext on the way out, which is the shape a real adopter
 * has and the reason `ResearchCredentialCodec` is a host seam at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import type { ResearchHttpStore } from '@12-apps/product-research/http';

import { manualGroup, requestsGroup } from './research-db-entries';
import { credentialsGroup, integrationsGroup, sourcesGroup } from './research-db-sources';
import type { SqlRunner } from './research-db-rows';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/product-research/prisma/migrations/', import.meta.url),
);

/**
 * Apply the published migrations, in name order — as a host deploy would.
 *
 * All eight, and the order is load-bearing beyond the usual: three of them
 * REVISE a decision an earlier one made (the integration singleton, the
 * soft-delete name index, the nullable shipping), so a host that applied a
 * prefix would get a schema that looks complete and refuses ordinary writes.
 * `tests/product-research-migrations.test.ts` pins each of those boundaries.
 */
export async function applyResearchMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/**
 * The seam a host fills with Prisma, filled here with SQL over PGlite.
 *
 * Composed from four groups rather than written as one object: the seam itself
 * is grouped that way, the groups address different tables, and one factory
 * holding all eighteen methods says nothing about which is which.
 */
export function researchStore(pg: PGlite): ResearchHttpStore {
  const sql = pg as unknown as SqlRunner;
  return {
    requests: requestsGroup(sql),
    integrations: integrationsGroup(sql),
    sources: sourcesGroup(sql),
    credentials: credentialsGroup(sql),
    manual: manualGroup(sql),
  };
}
