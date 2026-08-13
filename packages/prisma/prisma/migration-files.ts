import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Which committed migrations exist, and in what order to replay them.
 *
 * Its own module — with NO side effects — so both the provisioning script and
 * its test can use it. (`pglite-setup.ts` provisions a database on import.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The folder holding every committed migration, host-owned and plugin alike. */
const MIGRATIONS_DIR = join(HERE, 'migrations');

/**
 * Every migration directory under `dir`, in timestamp order.
 *
 * A package that OWNS part of the schema contributes its migrations here as
 * committed COPIES (Prisma has no cross-package import), and `package.test.ts`
 * gates that nothing under `prisma/` is a symlink.
 *
 * `statSync` rather than `Dirent.isDirectory()` even so, because the two differ
 * exactly where it hurt: these migrations USED to arrive as symlinks, and
 * `Dirent.isDirectory()` is FALSE for a symlink even when it resolves. That
 * silently dropped them and left the package's tables missing from every
 * PGlite-backed run — nothing failed loudly, because the schema was merely
 * incomplete until something queried them. `statSync` follows a link, so should
 * one ever reappear here this replay includes it rather than skipping it.
 */
export function discoverMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d/.test(name) && statSync(join(dir, name)).isDirectory())
    .sort();
}
