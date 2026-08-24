#!/usr/bin/env tsx
/**
 * Assemble `prisma/schema` from the INSTALLED tarballs.
 *
 * This is the adoption step every real host performs, done here against
 * `node_modules` instead of the workspace. `@12-apps/prisma` does the same job
 * with sixteen hand-written `scripts/sync-<pkg>-schema.mjs` files reaching
 * across the repo at `../../rbac/prisma/rbac.prisma`; one generic pass over the
 * installed scope replaces all sixteen and, unlike them, cannot go stale when a
 * seventeenth package starts shipping models — a package that ships a partial is
 * adopted here the moment it is installed.
 *
 * ## The copies are generated, not committed
 *
 * `harness/backend/package.json` is itself generated (the `@12-apps` deps are
 * `file:` tarballs whose names carry the version), so what is installed changes
 * on every release. A committed copy of a partial would be a second source of
 * truth that drifts from the tarball the tests run against — and drift in the
 * direction that matters: Prisma would generate a client for models the database
 * does not have. `.gitignore` keeps everything here except `schema.prisma` out
 * of the tree, and this script is a prerequisite of `generate`, so the folder is
 * never half-assembled.
 *
 * That is the OPPOSITE call from `@12-apps/prisma`, which commits its copies and
 * gates them with `--check`. Both are right for their host: a product repo wants
 * the schema reviewable in the diff, and a consumer harness wants it to be
 * whatever the tarball says today.
 *
 * ## Both halves, or a failure
 *
 * A package under `prisma/` must ship models AND migrations. Either alone is a
 * packaging bug only a consumer can see: models with no migrations generates a
 * client for tables nothing creates, and migrations with no models creates
 * tables no client can read. Both fail here, by name, rather than much later as
 * "relation does not exist" or a missing delegate.
 *
 *   npm run prisma:sync             # assemble
 *   npm run prisma:sync -- --list   # report only, write nothing
 */
/* eslint-disable no-console -- a CLI: a human runs this and reads the output in
   a terminal, and its failures ARE its output. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { BACKEND_DIR, schemaPackages, type SchemaPackage } from './packages';

const SCHEMA_DIR = join(BACKEND_DIR, 'prisma', 'schema');
/** The host's own file — the one thing in this folder the sync must never touch. */
const HOST_ROOT = 'schema.prisma';

/**
 * Where a package's partial lands, named after the PACKAGE rather than the file.
 *
 * Two packages are free to call their partial the same thing (nothing stops a
 * `models.prisma` in each), and Prisma reads a schema folder flat — so a
 * source-basename target would let one package's models silently replace
 * another's. Naming by package makes that collision impossible, and makes the
 * folder listing say which package every model came from.
 */
function targetFor(pkg: SchemaPackage, partial: string): string {
  const stem = basename(partial, '.prisma');
  return pkg.partials.length === 1 ? `${pkg.name}.prisma` : `${pkg.name}.${stem}.prisma`;
}

/** Everything the sync owns — i.e. everything in the folder but the host root. */
function generatedFiles(): string[] {
  if (!existsSync(SCHEMA_DIR)) return [];
  return readdirSync(SCHEMA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== HOST_ROOT)
    .map((entry) => entry.name);
}

function main(): void {
  const listOnly = process.argv.includes('--list');
  const packages = schemaPackages();

  if (packages.length === 0) {
    console.error('[prisma-sync] no installed @12-apps package ships a prisma/ directory.');
    process.exit(1);
  }

  const incomplete = packages.filter(
    (pkg) => pkg.partials.length === 0 || pkg.migrations.length === 0,
  );
  if (incomplete.length > 0) {
    for (const pkg of incomplete) {
      const missing = pkg.partials.length === 0 ? 'model partial (*.prisma)' : 'migrations/';
      console.error(
        `[prisma-sync] ${pkg.packageName} ships a prisma/ directory with no ${missing}. ` +
          "Check that package's `files` field publishes the whole prisma/ folder.",
      );
    }
    process.exit(1);
  }

  if (listOnly) {
    for (const pkg of packages) {
      console.log(
        `${pkg.packageName.padEnd(30)} ${String(pkg.partials.length).padStart(2)} partial(s)  ` +
          `${String(pkg.migrations.length).padStart(2)} migration(s)`,
      );
    }
    return;
  }

  mkdirSync(SCHEMA_DIR, { recursive: true });
  // Clear first: a package that STOPS shipping models has to disappear from the
  // folder, or Prisma keeps generating delegates for tables no migration builds.
  for (const stale of generatedFiles()) rmSync(join(SCHEMA_DIR, stale));

  const manifest = packages.flatMap((pkg) =>
    pkg.partials.map((partial) => {
      const target = targetFor(pkg, partial);
      copyFileSync(partial, join(SCHEMA_DIR, target));
      return { package: pkg.packageName, file: target, migrations: pkg.migrations.length };
    }),
  );

  // A machine-readable record of what this run assembled: what
  // `tests/prisma-schema.test.ts` asserts against, and what tells a human
  // staring at a folder of generated files which package each came from.
  writeFileSync(
    join(BACKEND_DIR, 'prisma', 'assembled.json'),
    `${JSON.stringify({ packages: manifest }, null, 2)}\n`,
  );

  console.log(
    `[prisma-sync] assembled ${manifest.length} partial(s) from ${packages.length} package(s) ` +
      'into prisma/schema.',
  );
}

main();
