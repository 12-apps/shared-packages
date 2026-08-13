#!/usr/bin/env node
/* global console, process */
/**
 * Copy `@12-apps/audit`'s model partial into this host's schema folder (12-14).
 *
 * The host-side twin of the owner's own `scripts/sync-audit-schema.mjs`: same
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
const SOURCE = join(HERE, '../../audit/prisma/audit.prisma');
const TARGET = join(HERE, '../prisma/schema/audit.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[audit-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[audit-schema] in sync.');
} else if (check) {
  console.error(
    '[audit-schema] DRIFT: prisma/schema/audit.prisma does not match the ' +
      '@12-apps/audit partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-audit" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[audit-schema] synced from @12-apps/audit.');
}
