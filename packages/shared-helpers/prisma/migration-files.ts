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

/** The folder holding every committed migration, including symlinked ones. */
const MIGRATIONS_DIR = join(HERE, 'migrations');

/**
 * Every migration directory under `dir`, in timestamp order.
 *
 * `statSync` rather than `Dirent.isDirectory()` on purpose: a package that OWNS
 * part of the schema contributes its migrations as committed SYMLINKS into this
 * folder (Prisma has no cross-package import), and `Dirent.isDirectory()` is
 * FALSE for a symlink. That silently dropped those migrations and left the
 * package's tables missing from every PGlite-backed run — with nothing failing
 * loudly, because the schema was merely incomplete until something queried
 * them. `statSync` follows the link, so an owned migration replays like any
 * other.
 */
export function discoverMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d/.test(name) && statSync(join(dir, name)).isDirectory())
    .sort();
}
