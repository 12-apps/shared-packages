#!/usr/bin/env node
/* global process */
/**
 * Copy this package's Prisma model PARTIAL into the host's schema folder.
 *
 *   node scripts/sync-auth-schema.mjs [--check] [<host-schema-dir>]
 *
 * The partial is COPIED, never symlinked (the entity-lifecycle doctrine, and
 * the prisma-partials-are-copied-never-symlinked memory): `turbo prune` copies
 * only what the dependency graph reaches, so a committed symlink dangles the
 * moment the owning package is not a declared workspace dependency; `npm pack`
 * SILENTLY DROPS symlinked entries from the tarball, so a linked partial ships
 * a published schema folder with the model missing; and a SYMLINKED MIGRATION
 * is silently skipped by Prisma (`readdir` + `isDirectory()` is false for a
 * link), so a green deploy applies no schema. This script used to CREATE the
 * link and its `--check` used to demand one — following its own failure message
 * reintroduced all three (#153).
 *
 * Only the schema partial. MIGRATIONS ARE NOT HANDLED HERE — the host
 * discovers and copies them structurally, by looking for a `prisma/migrations`
 * directory inside every installed `@12-apps/*` package (see
 * packages/prisma/scripts/sync-prisma-plugins.mjs).
 *
 * The host package that owns the schema folder MUST also declare this package
 * as a dependency, so the source of the copy is present in every build
 * context.
 *
 * Default host path follows the origin host layout
 * (`packages/prisma/prisma/schema/`); another repo passes its own schema
 * folder as the positional argument, or sets AUTH_HOST_SCHEMA_DIR.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = '[auth-schema]';
const RESYNC = 'pnpm --filter @12-apps/auth prisma:sync';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../prisma/auth.prisma');

const args = process.argv.slice(2).filter((arg) => arg !== '--check');
const check = process.argv.includes('--check');
const hostSchemaDir =
  args[0] ??
  process.env.AUTH_HOST_SCHEMA_DIR ??
  join(HERE, '../../prisma/prisma/schema');
const TARGET = join(hostSchemaDir, 'auth.prisma');

const source = readFileSync(SOURCE, 'utf8');
// `lstat` first: a leftover symlink from the pre-#153 script must be REPLACED,
// not read through. Reading through it would report "in sync" for a link whose
// bytes match — and a link is exactly what `npm pack` drops.
const stat = existsSync(TARGET) ? lstatSync(TARGET) : null;
const isPlainCopy = stat !== null && stat.isFile() && !stat.isSymbolicLink();
const target = isPlainCopy ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log(`${LABEL} in sync.`);
} else if (check) {
  console.error(
    `${LABEL} DRIFT: ${TARGET} is not a byte-identical COPY of the ` +
      `@12-apps/auth partial. Run "${RESYNC}" and commit the result.`,
  );
  process.exit(1);
} else {
  mkdirSync(hostSchemaDir, { recursive: true });
  // Unconditional: a DANGLING symlink reports existsSync=false, and copying
  // through a live one would land the bytes at the link's target instead.
  rmSync(TARGET, { force: true });
  copyFileSync(SOURCE, TARGET);
  console.log(`${LABEL} copied ${SOURCE} -> ${TARGET}.`);
}
