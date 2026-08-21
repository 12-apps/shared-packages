#!/usr/bin/env node
/* global console, process */
/**
 * Copy this package's Prisma model PARTIAL into the host's schema folder.
 *
 *   node scripts/sync-discounts-schema.mjs [--check] [<host-schema-dir>]
 *
 * The partial is COPIED, never symlinked (the
 * prisma-partials-are-copied-never-symlinked doctrine): `turbo prune` copies
 * only what the dependency graph reaches, so a committed symlink dangles the
 * moment the owning package is not a declared workspace dependency — and a
 * SYMLINKED MIGRATION is silently skipped by Prisma (`readdir` +
 * `isDirectory()` is false for a link), so a green deploy applies no schema.
 *
 * Only the schema partial. MIGRATIONS ARE NOT HANDLED HERE — a host discovers
 * and copies them structurally, by looking for a `prisma/migrations` directory
 * inside every installed `@12-apps/*` package.
 *
 * The host package that owns the schema folder MUST also declare this package
 * as a dependency, so the source of the copy is present in every build context.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = '[discounts-schema]';
const RESYNC = 'pnpm --filter @12-apps/discounts prisma:sync';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../prisma/discounts.prisma');

const args = process.argv.slice(2).filter((arg) => arg !== '--check');
const check = process.argv.includes('--check');
const hostSchemaDir =
  args[0] ?? process.env.DISCOUNTS_HOST_SCHEMA_DIR ?? join(HERE, '../../prisma/prisma/schema');
const TARGET = join(hostSchemaDir, 'discounts.prisma');

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log(`${LABEL} in sync.`);
} else if (check) {
  console.error(
    `${LABEL} DRIFT: ${TARGET} does not match the @12-apps/discounts partial. ` +
      `Run "${RESYNC}" and commit the result.`,
  );
  process.exit(1);
} else {
  mkdirSync(hostSchemaDir, { recursive: true });
  copyFileSync(SOURCE, TARGET);
  console.log(`${LABEL} copied ${SOURCE} -> ${TARGET}.`);
}
