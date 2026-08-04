#!/usr/bin/env node
/* global console, process */
/**
 * CLI over prisma-plugins.mjs — copy every plugin-owned migration into this
 * package's migrations folder.
 *
 *   node scripts/sync-prisma-plugins.mjs          # copy (idempotent)
 *   node scripts/sync-prisma-plugins.mjs --check  # CI drift gate (exit 1)
 *
 * `build` and `prisma:generate` run this in --check mode: they VERIFY the
 * committed state and never repair it. That distinction is the whole point.
 * Both are wired as `pre-test-command` / `pre-build-command` in CI, so a
 * MUTATING sync there would prune stale copies and rewrite the manifest BEFORE
 * the tests read them — the gate would assert against a repaired tree and pass
 * no matter what was committed, letting drift merge and surface at deploy time.
 * A check that passes for the wrong reason is the same failure shape as the
 * symlink bug it exists to catch.
 *
 * Repair is therefore explicit: `pnpm --filter @12-apps/shared-helpers
 * prisma:sync-plugins`. Add a migration to a plugin and the build fails telling
 * you to run that, instead of silently fixing the tree underneath you.
 *
 * (The Dockerfile's own `prisma generate` step is dead code — its guard tests
 * for `prisma/schema.prisma`, a single file that stopped existing when this
 * package moved to `prisma/schema/`. Generation happens through `turbo build`.)
 *
 * See prisma-plugins.mjs for how sources are discovered and why migrations are
 * copied rather than symlinked.
 */
import { syncPluginMigrations } from './prisma-plugins.mjs';

const check = process.argv.includes('--check');

let problems;
try {
  problems = syncPluginMigrations({ check });
} catch (error) {
  // Collision between two plugins claiming one migration name — a repo-shape
  // error no amount of re-syncing fixes, so report it plainly and stop.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (problems > 0) process.exit(1);
console.log(`[prisma-plugins] ${check ? 'in sync.' : 'done.'}`);
