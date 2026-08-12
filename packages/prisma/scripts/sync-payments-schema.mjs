#!/usr/bin/env node
/* global console, process */
/**
 * Copy @12-apps/payments-backend's Prisma model partial into this package's schema
 * folder — a COPY, never a symlink: `npm pack` follows the same rule as
 * `turbo prune` and Prisma's migration walk, and SILENTLY DROPS symlinked
 * entries from the tarball, so a linked partial ships a published schema
 * folder with the model missing. Same contract as sync-shift-schema.mjs.
 *
 *   node scripts/sync-payments-schema.mjs          # repair
 *   node scripts/sync-payments-schema.mjs --check  # CI gate (exit 1 on drift)
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../payments/backend/prisma/payments.prisma');
const TARGET = join(HERE, '../prisma/schema/payments.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[payments-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[payments-schema] in sync.');
} else if (check) {
  console.error(
    '[payments-schema] DRIFT: prisma/schema/payments.prisma does not match the ' +
      '@12-apps/payments-backend partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-payments" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[payments-schema] synced from @12-apps/payments-backend.');
}
