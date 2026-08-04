#!/usr/bin/env node
/* global console, process */
/**
 * Sync the @12-apps/entity-lifecycle Prisma model partial into this package's
 * multi-file schema folder — the plug-and-play seam: the package OWNS the four
 * lifecycle models (packages/entity-lifecycle/prisma/entity-lifecycle.prisma)
 * and hosts pull them in verbatim, so another project adopts the machinery by
 * running the same copy step against its own schema folder.
 *
 *   node scripts/sync-lifecycle-schema.mjs          # copy (idempotent)
 *   node scripts/sync-lifecycle-schema.mjs --check  # CI drift gate (exit 1)
 *
 * Wired as the pre-step of `prisma:generate` / `build`, and the copy is
 * committed so tooling that reads the schema folder directly never sees a
 * missing file.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Workspace-relative source; when lifted into another repo, resolve the file
// from the installed package instead (require.resolve or node_modules path).
const SOURCE = join(HERE, '../../entity-lifecycle/prisma/entity-lifecycle.prisma');
const TARGET = join(HERE, '../prisma/schema/entity-lifecycle.prisma');

if (!existsSync(SOURCE)) {
  console.error(`[lifecycle-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const check = process.argv.includes('--check');
const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[lifecycle-schema] in sync.');
} else if (check) {
  console.error(
    '[lifecycle-schema] DRIFT: prisma/schema/entity-lifecycle.prisma does not match ' +
      'the @12-apps/entity-lifecycle partial. Run "pnpm --filter @12-apps/shared-helpers ' +
      'prisma:sync-lifecycle" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[lifecycle-schema] synced from @12-apps/entity-lifecycle.');
}
