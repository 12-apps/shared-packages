#!/usr/bin/env node
/* global console, process */
/**
 * Copy `@12-apps/marketplace`'s model partial into this host's schema folder (FUT-4762).
 *
 * The owner declares the partial through its `db` wiring capability (mirrored in
 * its package.json); this copy is addressed from here so `build` /
 * `prisma:generate` can run it in `--check` mode, as every other partial is. COPIED, never symlinked
 * — a symlinked partial dangles under `turbo prune` the moment the owner stops
 * being a declared dependency, and a symlinked MIGRATION is silently skipped by
 * Prisma (see scripts/prisma-plugins.mjs for that one).
 *
 * The migrations are NOT handled here: they are discovered structurally by
 * scripts/sync-prisma-plugins.mjs, which finds any package with a
 * `prisma/migrations` directory.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../marketplace/prisma/marketplace.prisma');
const TARGET = join(HERE, '../prisma/schema/marketplace.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[marketplace-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[marketplace-schema] in sync.');
} else if (check) {
  console.error(
    '[marketplace-schema] DRIFT: prisma/schema/marketplace.prisma does not match the ' +
      '@12-apps/marketplace partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-marketplace" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[marketplace-schema] synced from @12-apps/marketplace.');
}
