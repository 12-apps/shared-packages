#!/usr/bin/env node
/* global console, process */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../mcp/prisma/mcp.prisma');
const TARGET = join(HERE, '../prisma/schema/mcp.prisma');
const check = process.argv.includes('--check');

if (!existsSync(SOURCE)) {
  console.error(`[mcp-schema] source partial not found: ${SOURCE}`);
  process.exit(1);
}

const source = readFileSync(SOURCE, 'utf8');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (source === target) {
  console.log('[mcp-schema] in sync.');
} else if (check) {
  console.error(
    '[mcp-schema] DRIFT: prisma/schema/mcp.prisma does not match the ' +
      '@12-apps/mcp partial. Run "pnpm --filter @12-apps/prisma ' +
      'prisma:sync-mcp" and commit the result.',
  );
  process.exit(1);
} else {
  copyFileSync(SOURCE, TARGET);
  console.log('[mcp-schema] synced from @12-apps/mcp.');
}
