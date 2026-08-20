#!/usr/bin/env node
/* global console, process */
/**
 * Copy @12-apps/feature-flags's Prisma model partial into this package's
 * schema folder — a COPY, never a symlink: `npm pack` follows the same rule
 * as `turbo prune` and Prisma's migration walk, and SILENTLY DROPS symlinked
 * entries from the tarball, so a linked partial ships a published schema
 * folder with the model missing. Same contract as sync-report-builder-schema.mjs.
 *
 *   node scripts/sync-feature-flags-schema.mjs          # repair
 *   node scripts/sync-feature-flags-schema.mjs --check  # CI gate (exit 1 on drift)
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../feature-flags/prisma/feature-flags.prisma');
const TARGET = join(HERE, '../prisma/schema/feature-flags.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[feature-flags-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[feature-flags-schema] in sync.');
} else if (check) {
  console.error(
    '[feature-flags-schema] DRIFT: prisma/schema/feature-flags.prisma does not match the ' +
      '@12-apps/feature-flags partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-feature-flags" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[feature-flags-schema] copied.');
}
