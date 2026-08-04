#!/usr/bin/env node
/* global console, process */
/**
 * Sync the @12-apps/product-research Prisma model partial into this package's
 * multi-file schema folder — same plug-and-play seam as
 * sync-lifecycle-schema.mjs: the package OWNS the four research tables
 * (packages/product-research/prisma/product-research.prisma) and hosts pull
 * them in verbatim, so another project adopts the engine by running the same
 * copy step against its own schema folder.
 *
 *   node scripts/sync-research-schema.mjs          # copy (idempotent)
 *   node scripts/sync-research-schema.mjs --check  # CI drift gate (exit 1)
 *
 * Wired as the pre-step of `prisma:generate` / `build`, and the copy is
 * committed so tooling that reads the schema folder directly never sees a
 * missing file. The package's migrations travel separately through
 * sync-prisma-plugins.mjs (structural discovery).
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../product-research/prisma/product-research.prisma');
const TARGET = join(HERE, '../prisma/schema/product-research.prisma');

if (!existsSync(SOURCE)) {
  console.error(`[research-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const check = process.argv.includes('--check');
const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[research-schema] in sync.');
} else if (check) {
  console.error(
    '[research-schema] DRIFT: prisma/schema/product-research.prisma does not match ' +
      'the @12-apps/product-research partial. Run "pnpm --filter @12-apps/shared-helpers ' +
      'prisma:sync-research" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[research-schema] synced from @12-apps/product-research.');
}
