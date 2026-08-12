#!/usr/bin/env node
/* global console, process */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../rbac/prisma/rbac.prisma');
const TARGET = join(HERE, '../prisma/schema/rbac.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[rbac-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[rbac-schema] in sync.');
} else if (check) {
  console.error(
    '[rbac-schema] DRIFT: prisma/schema/rbac.prisma does not match the ' +
      '@12-apps/rbac partial. Run "pnpm --filter @12-apps/shared-helpers ' +
      'prisma:sync-rbac" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[rbac-schema] synced from @12-apps/rbac.');
}
