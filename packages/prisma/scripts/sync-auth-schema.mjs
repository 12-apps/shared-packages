#!/usr/bin/env node
/* global console, process */
/**
 * Copy @12-apps/report-builder's Prisma model partial into this package's schema
 * folder — a COPY, never a symlink: `npm pack` follows the same rule as
 * `turbo prune` and Prisma's migration walk, and SILENTLY DROPS symlinked
 * entries from the tarball, so a linked partial ships a published schema
 * folder with the model missing. Same contract as sync-shift-schema.mjs.
 *
 *   node scripts/sync-auth-schema.mjs          # repair
 *   node scripts/sync-auth-schema.mjs --check  # CI gate (exit 1 on drift)
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../auth/prisma/auth.prisma');
const TARGET = join(HERE, '../prisma/schema/auth.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[auth-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[auth-schema] in sync.');
} else if (check) {
  console.error(
    '[auth-schema] DRIFT: prisma/schema/auth.prisma does not match the ' +
      '@12-apps/auth partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-auth" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[auth-schema] synced from @12-apps/auth.');
}
