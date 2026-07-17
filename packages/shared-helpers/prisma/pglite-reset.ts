/**
 * Reset the local PGlite dev database in one command.
 *
 * Committed migrations are plain `CREATE TABLE` (no `IF NOT EXISTS`), so the
 * provisioner ({@link ./pglite-setup}) can only run against a fresh dataDir. This
 * wraps "delete + re-provision" so you never hand-delete `.dev-db` to pick up a
 * new migration — it removes the dataDir, then replays every migration + the
 * idempotent seed.
 *
 *   pnpm --filter @repo/shared-helpers db:pglite:reset
 *   PGLITE_DATA_DIR=/abs/path pnpm --filter @repo/shared-helpers db:pglite:reset
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(HERE, '../../..');
const dataDir = resolve(process.env.PGLITE_DATA_DIR ?? `${repoRoot}/.dev-db`);

console.error(`[db:reset] removing ${dataDir} ...`);
rmSync(dataDir, { recursive: true, force: true });

console.error(`[db:reset] re-provisioning ${dataDir} ...`);
execFileSync('tsx', [join(HERE, 'pglite-setup.ts')], {
  stdio: 'inherit',
  env: { ...process.env, PGLITE_DATA_DIR: dataDir },
});
console.error('[db:reset] done.');
