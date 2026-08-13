#!/usr/bin/env node
/* global console, process */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../realtime/prisma/realtime.prisma');
const TARGET = join(HERE, '../prisma/schema/realtime.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[realtime-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[realtime-schema] in sync.');
} else if (check) {
  console.error(
    '[realtime-schema] DRIFT: prisma/schema/realtime.prisma does not match the ' +
      '@12-apps/realtime partial. Run "pnpm --filter @repo/prisma ' +
      'prisma:sync-realtime" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[realtime-schema] synced from @12-apps/realtime.');
}
