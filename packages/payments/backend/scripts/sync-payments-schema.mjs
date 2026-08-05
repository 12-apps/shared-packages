#!/usr/bin/env node
/* global console, process */
/**
 * Link this package's Prisma model PARTIAL into the host's schema folder.
 *
 *   node scripts/sync-payments-schema.mjs          # create/repair the link
 *   node scripts/sync-payments-schema.mjs --check  # CI gate (exit 1 if wrong)
 *
 * Only the schema partial. MIGRATIONS ARE NOT HANDLED HERE — the host discovers
 * and copies them structurally, by looking for a `migrations` directory inside
 * every workspace package and every installed `@12-apps/*` package, rather than
 * relying on each package to declare and run a sync of its own. See
 * packages/shared-helpers/scripts/prisma-plugins.mjs.
 *
 * The split follows what the two things actually are:
 *
 *   the PARTIAL      one FILE, with a package-specific name, opened by path.
 *                    The read follows a symlink, so the link is invisible and
 *                    no payment model is ever duplicated into the app. That
 *                    ownership property is the reason this script exists, and
 *                    it is why the partial stays a link.
 *
 *   the MIGRATIONS   DIRECTORIES, with no package-specific naming, that Prisma
 *                    finds by ENUMERATING the migrations folder with
 *                    readdir({ withFileTypes: true }) and keeping entries whose
 *                    isDirectory() is true. Those dirents come from lstat,
 *                    which does not follow links, so a symlinked migration
 *                    reports isDirectory() false even when it resolves — and is
 *                    skipped. `migrate deploy` then finds nothing pending,
 *                    prints "No pending migrations to apply" and exits 0, so
 *                    the deploy goes green having changed no schema. Five
 *                    migrations sat unapplied in production behind that hole.
 *                    Hence: copied, by the host, never linked.
 *
 * The host package that owns the schema folder MUST also declare this package
 * as a dependency: the link is invisible to the dependency graph, so
 * `turbo prune` would otherwise drop this package from the Docker build context
 * and leave it dangling (see ADOPTING.md §1).
 *
 * Another repo adopts the machinery by pointing HOST_SCHEMA_LINK at its own
 * schema folder. Windows checkouts need symlink support (developer mode /
 * `git config core.symlinks true`).
 */
import { lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = '[payments-schema]';
const RESYNC = 'pnpm --filter @12-apps/payments-backend prisma:sync';

const HERE = dirname(fileURLToPath(import.meta.url));
// Workspace-relative host paths; adopting repos change these two lines.
const HOST_SCHEMA_LINK = join(HERE, '../../../prisma/prisma/schema/payments.prisma');
const HOST_SCHEMA_TARGET = '../../../payments/backend/prisma/payments.prisma';

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
