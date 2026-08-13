#!/usr/bin/env node
/* global console, process */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../notifications/prisma/notifications.prisma');
const TARGET = join(HERE, '../prisma/schema/notifications.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[notifications-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[notifications-schema] in sync.');
} else if (check) {
  console.error(
    '[notifications-schema] DRIFT: prisma/schema/notifications.prisma does not ' +
      'match the @12-apps/notifications partial. Run "pnpm --filter ' +
      '@12-apps/prisma prisma:sync-notifications" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[notifications-schema] synced from @12-apps/notifications.');
}
