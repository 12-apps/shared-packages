#!/usr/bin/env node
/* global console, process */
/**
 * Copy this package's Prisma model PARTIAL into the host's schema folder.
 *
 *   node scripts/sync-entitlements-schema.mjs          # create/repair
 *   node scripts/sync-entitlements-schema.mjs --check  # CI gate (exit 1)
 *
 * A COPY, never a symlink. Symlinks lose three different ways, all silent:
 * Prisma's migration walk `lstat`s and skips them, `turbo prune` drops an
 * owner the graph does not reach and leaves them dangling — and `npm pack`
 * drops symlinked entries from the tarball entirely, so a published schema
 * folder simply ships without the model. The last one is why the in-repo
 * host (`packages/prisma`) holds copies too, kept honest by the `--check`
 * mode its build runs.
 *
 * Only the schema partial. MIGRATIONS ARE NOT HANDLED HERE — the host
 * discovers and copies them structurally, by looking for a `migrations`
 * directory inside every workspace package and every installed `@12-apps/*`
 * package. See packages/prisma/scripts/prisma-plugins.mjs.
 *
 * The host package that owns the schema folder MUST also declare this package
 * as a dependency: the copy is invisible to the dependency graph, so
 * `turbo prune` would otherwise drop this package from the Docker build
 * context and this script would exit 1 on a missing source (gated by
 * @12-apps/prisma's package.test.ts).
 *
 * Another repo adopts the machinery by pointing HOST_SCHEMA_TARGET at its own
 * schema folder.
 */
import { copyFileSync, existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = '[entitlements-schema]';
const RESYNC = 'pnpm --filter @12-apps/entitlements prisma:sync';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../prisma/entitlements.prisma');
// Workspace-relative host path; adopting repos change this line.
const HOST_SCHEMA_TARGET = join(HERE, '../../prisma/prisma/schema/entitlements.prisma');

const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`${LABEL} source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
// `lstat` first: a leftover symlink must be replaced, not read through — a
// linked copy that happens to resolve still vanishes from `npm pack`.
const stat = existsSync(HOST_SCHEMA_TARGET) ? lstatSync(HOST_SCHEMA_TARGET) : null;
const isPlainCopy = stat !== null && stat.isFile() && !stat.isSymbolicLink();
const target = isPlainCopy ? readFileSync(HOST_SCHEMA_TARGET, 'utf8') : null;

if (source === target) {
  console.log(`${LABEL} in sync.`);
} else if (check) {
  console.error(
    `${LABEL} DRIFT: ${HOST_SCHEMA_TARGET} is not a byte-identical COPY of the ` +
      `@12-apps/entitlements partial. Run "${RESYNC}" and commit the result.`,
  );
  process.exit(1);
} else {
  // Unconditional: a DANGLING symlink reports existsSync=false, and copying
  // through it would land the bytes at the link's target instead of here.
  rmSync(HOST_SCHEMA_TARGET, { force: true });
  copyFileSync(SOURCE, HOST_SCHEMA_TARGET);
  console.log(`${LABEL} copied ${SOURCE} → ${HOST_SCHEMA_TARGET}`);
}
