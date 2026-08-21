#!/usr/bin/env node
/* global console, process */
/**
 * Copy `@12-apps/discounts`'s model partial into this host's schema folder (FUT-244).
 *
 * The host-side twin of the owner's own `scripts/sync-discounts-schema.mjs`: same
 * copy, addressed from here so `build` / `prisma:generate` can run it in
 * `--check` mode without knowing where the owner lives. COPIED, never symlinked
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
const SOURCE = join(HERE, '../../discounts/prisma/discounts.prisma');
const TARGET = join(HERE, '../prisma/schema/discounts.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[discounts-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[discounts-schema] in sync.');
} else if (check) {
  console.error(
    '[discounts-schema] DRIFT: prisma/schema/discounts.prisma does not match the ' +
      '@12-apps/discounts partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-discounts" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[discounts-schema] synced from @12-apps/discounts.');
}
