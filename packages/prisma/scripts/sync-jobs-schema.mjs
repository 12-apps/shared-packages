#!/usr/bin/env node
/* global console, process */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../jobs/prisma/jobs.prisma');
const TARGET = join(HERE, '../prisma/schema/jobs.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[jobs-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[jobs-schema] in sync.');
} else if (check) {
  console.error(
    '[jobs-schema] DRIFT: prisma/schema/jobs.prisma does not match the ' +
      '@12-apps/jobs partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-jobs" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[jobs-schema] synced from @12-apps/jobs.');
}
