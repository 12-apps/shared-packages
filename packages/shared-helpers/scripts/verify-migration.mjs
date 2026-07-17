/* global process, console */
/**
 * Verify that the committed Prisma migrations + seed apply cleanly, against a
 * REAL throwaway PGlite database — the check the mocked unit tests can't do.
 *
 * Creates a unique temp dataDir, replays every migration + the seed into it
 * (via prisma/pglite-setup.ts), then ALWAYS removes the temp dir in a `finally`.
 * The database's whole lifecycle — create and delete — is owned here, so there
 * is never a stray scratch db to clean up by hand.
 *
 *   pnpm --filter @12-apps/shared-helpers exec node scripts/verify-migration.mjs
 *
 * Exit code 0 = migrations + seed applied cleanly; non-zero = something failed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = mkdtempSync(join(tmpdir(), "pglite-verify-"));

try {
  console.error(`[verify] provisioning throwaway PGlite db at ${dataDir} ...`);
  execFileSync("pnpm", ["exec", "tsx", "prisma/pglite-setup.ts"], {
    cwd: packageRoot,
    stdio: "inherit",
    env: { ...process.env, PGLITE_DATA_DIR: dataDir },
  });
  console.error("[verify] migrations + seed applied cleanly ✓");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
  console.error(`[verify] removed ${dataDir}`);
}
