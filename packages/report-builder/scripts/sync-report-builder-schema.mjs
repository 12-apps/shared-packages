#!/usr/bin/env node
/* global console, process */
/**
 * Link this package's Prisma model PARTIAL into the host's schema folder. Same
 * machinery as packages/payments/backend/scripts/sync-payments-schema.mjs — see
 * that file's header for the full rationale.
 *
 *   node scripts/sync-report-builder-schema.mjs          # create/repair
 *   node scripts/sync-report-builder-schema.mjs --check  # CI gate (exit 1)
 *
 * Only the schema partial. MIGRATIONS ARE NOT HANDLED HERE — the host discovers
 * and copies them structurally, by looking for a `migrations` directory inside
 * every workspace package and every installed `@12-apps/*` package. See
 * packages/shared-helpers/scripts/prisma-plugins.mjs.
 *
 * A partial is one FILE opened by path, so a symlink is read through and the
 * model is never duplicated into the app. A migration is a DIRECTORY that
 * Prisma finds by enumerating the migrations folder with
 * readdir({ withFileTypes: true }), keeping entries whose isDirectory() is
 * true — false for a symlink even when it resolves, so a linked migration is
 * skipped and `migrate deploy` exits 0 having applied nothing.
 *
 * The host package that owns the schema folder MUST also declare this package
 * as a dependency: the link is invisible to the dependency graph, so
 * `turbo prune` would otherwise drop this package from the Docker build context
 * and leave it dangling (see the payments ADOPTING.md §1 and the shared-helpers
 * package.test.ts gate).
 *
 * Another repo adopts the machinery by pointing HOST_SCHEMA_LINK at its own
 * schema folder. Windows checkouts need symlink support (developer mode /
 * `git config core.symlinks true`).
 */
import { lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = '[report-builder-schema]';
const RESYNC = 'pnpm --filter @12-apps/report-builder prisma:sync';

const HERE = dirname(fileURLToPath(import.meta.url));
// Workspace-relative host paths; adopting repos change these two lines.
const HOST_SCHEMA_LINK = join(HERE, '../../prisma/prisma/schema/report-builder.prisma');
const HOST_SCHEMA_TARGET = '../../../report-builder/prisma/report-builder.prisma';

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
