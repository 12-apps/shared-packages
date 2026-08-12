#!/usr/bin/env node
/* global console, process */
/**
 * Link this package's Prisma model PARTIAL into the host's schema folder. Same
 * machinery as packages/report-builder/scripts/sync-report-builder-schema.mjs
 * — see packages/payments/backend/scripts/sync-payments-schema.mjs for the
 * full rationale.
 *
 *   node scripts/sync-entitlements-schema.mjs          # create/repair
 *   node scripts/sync-entitlements-schema.mjs --check  # CI gate (exit 1)
 *
 * Only the schema partial. MIGRATIONS ARE NOT HANDLED HERE — the host
 * discovers and copies them structurally, by looking for a `migrations`
 * directory inside every workspace package and every installed `@12-apps/*`
 * package. See packages/shared-helpers/scripts/prisma-plugins.mjs.
 *
 * The host package that owns the schema folder MUST also declare this package
 * as a dependency: the link is invisible to the dependency graph, so
 * `turbo prune` would otherwise drop this package from the Docker build
 * context and leave it dangling (gated by shared-helpers' package.test.ts).
 *
 * Another repo adopts the machinery by pointing HOST_SCHEMA_LINK at its own
 * schema folder — a host that copies instead of linking (future-pay does)
 * keeps its own copy script and the same file name.
 */
import { lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = '[entitlements-schema]';
const RESYNC = 'pnpm --filter @12-apps/entitlements prisma:sync';

const HERE = dirname(fileURLToPath(import.meta.url));
// Workspace-relative host paths; adopting repos change these two lines.
const HOST_SCHEMA_LINK = join(HERE, '../../shared-helpers/prisma/schema/entitlements.prisma');
const HOST_SCHEMA_TARGET = '../../../entitlements/prisma/entitlements.prisma';

function safeLstat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

const check = process.argv.includes('--check');
const stat = safeLstat(HOST_SCHEMA_LINK);
const current = stat?.isSymbolicLink() ? readlinkSync(HOST_SCHEMA_LINK) : null;

if (current !== HOST_SCHEMA_TARGET) {
  if (check) {
    console.error(`${LABEL} ${HOST_SCHEMA_LINK} is not a symlink to ${HOST_SCHEMA_TARGET}`);
    console.error(`${LABEL} run "${RESYNC}" and commit the result.`);
    process.exit(1);
  }
  if (stat) rmSync(HOST_SCHEMA_LINK, { recursive: true, force: true });
  symlinkSync(HOST_SCHEMA_TARGET, HOST_SCHEMA_LINK);
  console.log(`${LABEL} linked ${HOST_SCHEMA_LINK} → ${HOST_SCHEMA_TARGET}`);
}

console.log(check ? `${LABEL} in sync.` : `${LABEL} done.`);
