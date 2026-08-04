/* global console */
/**
 * Find and sync PLUGIN-OWNED Prisma migrations into this package's migrations
 * folder.
 *
 * Discovery is STRUCTURAL, not declarative. An earlier version looked for
 * packages declaring a `prisma:sync` script, which only ever finds workspace
 * packages that remembered to declare one — a published dependency has no
 * scripts we run, and a new local package silently contributes nothing. So this
 * looks for the thing itself: a directory named `migrations` holding at least
 * one subdirectory with a `migration.sql`. That covers every layout in use or
 * planned:
 *
 *   packages/<pkg>/prisma/migrations              (report-builder, today)
 *   packages/<pkg>/<sub>/prisma/migrations        (payments/backend, today)
 *   packages/<pkg>/api/migrations                 planned
 *   packages/<pkg>/migrations                     planned
 *   node_modules/<scope>/<pkg>/**\/migrations     once packages ship as libs
 *
 * MIGRATIONS ARE COPIED, NEVER SYMLINKED. Prisma does not open a migration by
 * path — it enumerates the migrations folder with
 * `readdir(dir, { withFileTypes: true })` and keeps entries whose
 * `isDirectory()` is true. Those dirents come from `lstat`, which does not
 * follow links, so a symlink reports `isDirectory() === false` even when it
 * resolves perfectly, and the migration is skipped. `migrate deploy` then finds
 * nothing pending, prints "No pending migrations to apply" and exits 0 — a
 * green deploy that changed no schema. Five migrations sat unapplied in
 * production behind that exact hole.
 *
 * Schema PARTIALS are a different case and stay with their owning package's
 * sync script: a partial is a file opened by path, so a symlink is read
 * through, and its name is package-specific. Only directories have this bug.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/shared-helpers — the HOST whose migrations folder is assembled. */
const HOST_PACKAGE = resolve(HERE, '..');
export const HOST_MIGRATIONS = join(HOST_PACKAGE, 'prisma', 'migrations');
const REPO_ROOT = resolve(HOST_PACKAGE, '../..');

/**
 * Which migrations in the host folder came from a plugin.
 *
 * Needed because a copy is indistinguishable from a host-owned migration once
 * it lands — same shape, same contents, no marker. Without this record, a
 * migration a plugin RENAMED or DELETED would keep its orphaned copy in the
 * host folder forever: still a real directory, still enumerated by Prisma,
 * still applied on the next deploy, with no owner left to compare it against.
 * Pruning "anything the sources no longer claim" is not an option either —
 * that describes all 81 host-owned migrations too.
 *
 * Kept OUTSIDE prisma/migrations so it is not an entry Prisma has to skip.
 */
export const MANIFEST = join(HOST_PACKAGE, 'prisma', 'plugin-migrations.json');

/**
 * Where a plugin can live. `packages/*` and `packages/*\/*` cover the workspace
 * (payments is nested as packages/payments/backend); the scopes cover the same
 * packages once they are published and installed as real dependencies.
 */
const WORKSPACE_ROOT = join(REPO_ROOT, 'packages');
export const PUBLISHED_SCOPES = ['@12-apps'];

/** Never descend into these — build output and vendored trees. */
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.git',
  'storybook-static',
]);

/** How deep below a plugin root a `migrations` directory may sit. */
const MAX_DEPTH = 3;

function subdirectories(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(dir, entry.name))
    .filter((path) => existsSync(path) && lstatSync(realpathSync(path)).isDirectory());
}

/** A migrations folder proper: holds ≥1 subdirectory containing migration.sql. */
function isMigrationSet(dir) {
  return subdirectories(dir).some((child) => existsSync(join(child, 'migration.sql')));
}

/** Directories named `migrations` at or below `dir`, bounded and filtered. */
function findMigrationSets(dir, depth = 1) {
  if (depth > MAX_DEPTH) return [];
  const children = subdirectories(dir).filter((path) => !SKIP.has(basename(path)));
  const named = children.filter((path) => basename(path) === 'migrations');
  const deeper = children
    .filter((path) => basename(path) !== 'migrations')
    .flatMap((path) => findMigrationSets(path, depth + 1));
  return [...named.filter(isMigrationSet), ...deeper];
}

/** Plugin roots: workspace packages (two levels) plus installed scoped ones. */
function pluginRoots() {
  const workspace = subdirectories(WORKSPACE_ROOT);
  const scoped = PUBLISHED_SCOPES.flatMap((scope) =>
    subdirectories(join(REPO_ROOT, 'node_modules', scope)),
  );
  const roots = [...workspace, ...workspace.flatMap(subdirectories), ...scoped];
  return [...new Set(roots.map((path) => realpathSync(path)))];
}

/**
 * Every plugin-owned migrations folder in the repo, host's own excluded.
 *
 * Deduplicated by real path: a workspace package installed under a published
 * scope resolves to the same directory through both, and pnpm's node_modules
 * links would otherwise yield it twice.
 */
export function discoverMigrationSources() {
  const host = realpathSync(HOST_MIGRATIONS);
  const found = pluginRoots().flatMap((root) => findMigrationSets(root));
  const unique = [...new Set(found.map((path) => realpathSync(path)))];
  return unique.filter((path) => path !== host).sort();
}

/** Migration directory names inside one source, sorted. */
export function migrationNamesIn(source) {
  return subdirectories(source)
    .filter((child) => existsSync(join(child, 'migration.sql')))
    .map((child) => basename(child))
    .sort();
}

/** `{ name → owning source }`, throwing if two plugins claim the same name. */
export function ownedMigrations(sources = discoverMigrationSources()) {
  const claims = sources.flatMap((source) =>
    migrationNamesIn(source).map((name) => ({ name, source })),
  );
  const owners = new Map();
  for (const { name, source } of claims) {
    const existing = owners.get(name);
    if (existing) {
      throw new Error(
        `[prisma-plugins] migration "${name}" is claimed by two plugins:\n` +
          `  ${relative(REPO_ROOT, existing)}\n  ${relative(REPO_ROOT, source)}\n` +
          'Migration directory names must be unique across the whole schema.',
      );
    }
    owners.set(name, source);
  }
  return owners;
}

/**
 * Make `target` a real directory. A symlink here IS the bug this module exists
 * to prevent, so check mode names it specifically rather than repairing it into
 * something that also would not work. Returns false to stop (check-mode fault).
 */
function ensureRealDirectory(target, { check, fail }) {
  const stat = existsSync(target) || isLink(target) ? lstatSync(target) : null;
  if (stat?.isSymbolicLink()) {
    if (check) {
      fail(
        `${relative(REPO_ROOT, target)} is a SYMLINK. Prisma keeps only real ` +
          'directories when it enumerates migrations, so this one would never ' +
          'be applied and the deploy would still exit 0.',
      );
      return false;
    }
    unlinkSync(target);
  }
  if (existsSync(target)) return true;
  if (check) {
    fail(`${relative(REPO_ROOT, target)} is missing.`);
    return false;
  }
  mkdirSync(target, { recursive: true });
  return true;
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Copy one migration's files byte for byte (Prisma checksums migration.sql). */
function syncFiles(sourceDir, targetDir, { check, fail, log }) {
  const files = readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  for (const file of files) {
    const from = join(sourceDir, file);
    const to = join(targetDir, file);
    const source = readFileSync(from);
    const current = existsSync(to) ? readFileSync(to) : null;
    if (current && source.equals(current)) continue;
    if (check) {
      fail(`${relative(REPO_ROOT, to)} does not match ${relative(REPO_ROOT, from)}.`);
      continue;
    }
    copyFileSync(from, to);
    log(`synced ${relative(REPO_ROOT, to)}`);
  }
}

/** Migration names the last sync recorded as plugin-owned. */
export function readManifest() {
  if (!existsSync(MANIFEST)) return [];
  const parsed = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
  return Array.isArray(parsed.migrations) ? parsed.migrations : [];
}

function writeManifest(owned) {
  const body = {
    $comment:
      'Migrations in prisma/migrations that were COPIED from a plugin package. ' +
      'Generated by scripts/sync-prisma-plugins.mjs — do not edit by hand. Its ' +
      'only job is to let the sync recognise a copy whose owner renamed or ' +
      'deleted it, since a copy is otherwise indistinguishable from a ' +
      'host-owned migration.',
    migrations: owned,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Remove copies whose owner has dropped them.
 *
 * Only ever touches a directory this manifest recorded as a plugin copy AND
 * that no plugin claims any more — never a host-owned migration. Check mode
 * reports instead of deleting, so CI fails on the committed state before any
 * deploy acts on it. Note that dropping a migration a database has already
 * applied is its own hazard (Prisma will report it as applied but missing
 * locally); the prune follows the owner, it does not sanction the removal.
 */
function pruneStale(owned, { check, fail, log }) {
  const current = new Set(owned);
  const stale = readManifest().filter((name) => !current.has(name));
  for (const name of stale) {
    const target = join(HOST_MIGRATIONS, name);
    if (!existsSync(target) && !isLink(target)) continue;
    if (check) {
      fail(
        `${relative(REPO_ROOT, target)} is a stale plugin copy — no plugin ` +
          'claims it any more, but it is still here and Prisma would apply it.',
      );
      continue;
    }
    rmSync(target, { recursive: true, force: true });
    log(`pruned ${relative(REPO_ROOT, target)} (no longer claimed by any plugin)`);
  }
}

/**
 * Copy (or verify) every discovered plugin migration into the host folder.
 * Returns the number of problems found — always 0 outside check mode.
 */
export function syncPluginMigrations({ check = false } = {}) {
  const sources = discoverMigrationSources();
  const log = (message) => console.log(`[prisma-plugins] ${message}`);
  let problems = 0;
  const fail = (message) => {
    console.error(`[prisma-plugins] ${message}`);
    problems += 1;
  };

  if (sources.length === 0) {
    fail('no plugin-owned migrations folder found — expected at least one.');
    return problems;
  }

  log(`${check ? 'checking' : 'syncing'} ${sources.length} plugin migration source(s):`);
  sources.forEach((source) => log(`  ${relative(REPO_ROOT, source)}`));

  const owners = ownedMigrations(sources);
  for (const [name, source] of owners) {
    const target = join(HOST_MIGRATIONS, name);
    if (ensureRealDirectory(target, { check, fail })) {
      syncFiles(join(source, name), target, { check, fail, log });
    }
  }

  const owned = [...owners.keys()].sort();
  pruneStale(owned, { check, fail, log });

  if (check) {
    const recorded = readManifest();
    if (JSON.stringify(recorded) !== JSON.stringify(owned)) {
      fail(
        `${relative(REPO_ROOT, MANIFEST)} does not list the plugin migrations ` +
          `that exist (recorded ${recorded.length}, found ${owned.length}).`,
      );
    }
  } else {
    writeManifest(owned);
  }

  if (problems > 0) {
    console.error(
      '[prisma-plugins] run "pnpm --filter @12-apps/shared-helpers prisma:sync-plugins" ' +
        'and commit the result.',
    );
  }
  return problems;
}
