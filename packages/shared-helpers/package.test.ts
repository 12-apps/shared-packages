/* eslint-disable test-flakiness/no-unmocked-fs -- the filesystem IS the subject
   here: these tests assert that this package's own committed manifest, prisma
   schema folder and migration symlinks are what the build expects. Mocking the
   reads would leave the suite asserting against a fixture instead of the repo,
   which is the one thing it exists to check. Every path read is a checked-in
   file resolved from __dirname, so there is no ordering or timing to race. */
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain .mjs build script, no type declarations by design
import { discoverMigrationSources, migrationNamesIn, readManifest } from './scripts/prisma-plugins.mjs';

interface ManifestShape {
  prisma?: { seed?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifestPath = join(__dirname, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestShape;

describe('shared-helpers manifest — prisma wiring', () => {
  // No seed assertions here: seeding belongs to the consuming app, because the
  // seed data describes the domain models this package deliberately does not
  // own. The host schema is datasource + generator plus plugin partials only.
  it('declares no seed command — seeding is the host app’s job', () => {
    const config = readFileSync(join(__dirname, 'prisma.config.ts'), 'utf-8');
    expect(config).not.toMatch(/seed\s*:/);
    expect(manifest.prisma?.seed).toBeUndefined();
    expect(manifest.scripts?.['db:seed']).toBeUndefined();
  });
});

/**
 * Packages that own Prisma models (@12-apps/payments-backend, @12-apps/report-builder)
 * keep the model file and its migrations in their OWN folder and expose them
 * here — see packages/payments/backend/scripts/sync-payments-schema.mjs.
 *
 * The SCHEMA PARTIAL is a committed symlink. Prisma opens it by path, so the
 * read follows the link. But nothing about that composition is visible in the
 * dependency graph, and `turbo prune` copies only the packages the graph
 * reaches: an owner left undeclared is dropped from the Docker build context,
 * the link dangles, and `prisma generate` dies with
 * `ENOENT ... prisma/schema/<owner>.prisma` — which is exactly how CD broke
 * once. Declaring the owner as a workspace dependency is what keeps it in the
 * prune, and the second describe below is that gate.
 *
 * The MIGRATIONS are committed COPIES, and the first describe below is why.
 * They were symlinks until five of them turned out to be invisible in
 * production; see the comment on that block.
 */
const repoRoot = resolve(__dirname, '../..');
const declaredDeps = { ...manifest.dependencies, ...manifest.devDependencies };

interface PrismaLink {
  /** Path of the link itself, repo-relative, for readable failures. */
  readonly link: string;
  /** Absolute path the link points at. */
  readonly target: string;
}

/** Every committed symlink directly inside `dir` (missing dir → none). */
function prismaLinksIn(dir: string): PrismaLink[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => {
      const link = join(dir, entry.name);
      return { link: link.slice(repoRoot.length + 1), target: resolve(dir, readlinkSync(link)) };
    });
}

/** A partial that is a committed COPY of some package's own prisma file. */
interface CopiedPartial {
  /** Repo-relative path of the copy, for readable failures. */
  readonly partial: string;
  /** Package name that owns the source file. */
  readonly owner: string;
}

/**
 * Every non-symlink partial in `dir` whose SOURCE lives in a workspace package.
 *
 * Discovered structurally, by basename: a copied partial keeps the owner's file
 * name (`product-research.prisma` ← `packages/product-research/prisma/
 * product-research.prisma`), which is the same convention every sync script
 * follows. `schema.prisma` is the host's own and has no owner, so it is skipped
 * along with anything whose source cannot be located — a partial nobody owns is
 * not a prune risk.
 */
function copiedPartialsIn(dir: string): CopiedPartial[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name !== 'schema.prisma')
    .flatMap((entry) => {
      const source = join(repoRoot, 'packages', entry.name.replace(/\.prisma$/, ''), 'prisma', entry.name);
      if (!existsSync(source)) return [];
      const owner = owningPackage(source);
      return owner ? [{ partial: `prisma/schema/${entry.name}`, owner }] : [];
    });
}

/** Name of the nearest workspace package containing `target`, if any. */
function owningPackage(target: string): string | undefined {
  for (let dir = dirname(target); dir.startsWith(repoRoot) && dir !== repoRoot; dir = dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (!existsSync(candidate)) continue;
    const { name } = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: string };
    return name;
  }
  return undefined;
}

const migrationsDir = join(__dirname, 'prisma/migrations');

/**
 * Discovered the same way the sync does — structurally, by looking for a
 * `migrations` directory inside every workspace package and every installed
 * `@12-apps/*` package. Hardcoding the owners here would let a new plugin ship
 * unsynced and still pass, which is the class of gap this suite exists to
 * close.
 */
const migrationOwners = discoverMigrationSources().map((dir) => ({
  owner: relative(repoRoot, dir),
  dir,
}));

/**
 * MIGRATIONS MUST BE REAL DIRECTORIES, NEVER SYMLINKS.
 *
 * Prisma does not open a migration by path — it enumerates this folder with
 * `readdir(dir, { withFileTypes: true })` and keeps the entries whose
 * `isDirectory()` is true. Those dirents come from `lstat`, which does not
 * follow links, so a symlink reports `isSymbolicLink() === true` and
 * `isDirectory() === false` EVEN WHEN IT RESOLVES PERFECTLY. A symlinked
 * migration is not read through; it is skipped.
 *
 * That is not a loud failure. `prisma migrate deploy` finds nothing pending
 * among the migrations it can see, prints "No pending migrations to apply" and
 * exits 0, so CD goes green having changed no schema at all. Five migrations
 * sat unapplied in production behind green deploys this way, and the app 500'd
 * on a column the pipeline had "successfully" not created.
 *
 * The old version of this suite asserted each symlink "resolves to a real
 * file". It did resolve. Resolvability was never the property that mattered —
 * visibility to `readdir` was — so the gate passed throughout. These tests
 * assert the property Prisma actually uses.
 */
describe('shared-helpers prisma — migrations are visible to Prisma', () => {
  /** Read fresh per test — exactly the call Prisma itself makes. */
  const migrationEntries = () => readdirSync(migrationsDir, { withFileTypes: true });

  it('contains no symlinked migration entries', () => {
    const symlinked = migrationEntries()
      .filter((entry) => entry.isSymbolicLink())
      .map((entry) => entry.name);
    expect(symlinked).toEqual([]);
  });

  it('counts every migration as a directory, the way Prisma does', () => {
    // Anything that is neither a real directory nor the lock file would be
    // silently dropped from the migration set.
    const invisible = migrationEntries()
      .filter((entry) => !entry.isDirectory() && entry.name !== 'migration_lock.toml')
      .map((entry) => entry.name);
    expect(invisible).toEqual([]);
  });

  it('discovers at least one plugin migration source', () => {
    // Zero sources would make every check below vacuous.
    expect(migrationOwners.length).toBeGreaterThan(0);
  });

  it('records every plugin copy in the manifest, with none left orphaned', () => {
    // A copy is indistinguishable from a host-owned migration once it lands,
    // so this record is the only way a later sync can tell that a plugin
    // renamed or deleted one. Drift here means either an unrecorded copy or a
    // stale directory Prisma would still apply.
    const claimed = discoverMigrationSources()
      .flatMap((dir: string) => migrationNamesIn(dir))
      .sort();
    expect(readManifest()).toEqual(claimed);
  });

  describe.each(migrationOwners)('$owner', ({ dir }) => {
    const owned = migrationNamesIn(dir);

    it('owns at least one migration (otherwise this gate proves nothing)', () => {
      expect(owned.length).toBeGreaterThan(0);
    });

    it.each(owned)('%s is synced here as a real directory', (name) => {
      const synced = join(migrationsDir, name);
      expect(existsSync(synced)).toBe(true);
      expect(lstatSync(synced).isSymbolicLink()).toBe(false);
      expect(lstatSync(synced).isDirectory()).toBe(true);
    });

    it.each(owned)('%s matches its source byte for byte', (name) => {
      // Prisma checksums migration.sql; drift between the owner and the synced
      // copy means the deploy applies something the package did not author.
      const sql = 'migration.sql';
      expect(readFileSync(join(migrationsDir, name, sql), 'utf-8')).toBe(
        readFileSync(join(dir, name, sql), 'utf-8'),
      );
    });
  });
});

const prismaLinks = prismaLinksIn(join(__dirname, 'prisma/schema'));

describe('shared-helpers manifest — symlinked prisma schema partials', () => {
  it('has at least one symlinked partial to check', () => {
    expect(prismaLinks.length).toBeGreaterThan(0);
  });

  it.each(prismaLinks)('$link resolves to a real file', ({ target }) => {
    expect(existsSync(target)).toBe(true);
  });

  it.each(prismaLinks)('$link is owned by a declared workspace dependency', ({ target }) => {
    const owner = owningPackage(target);
    expect(owner).toBeDefined();
    // Undeclared => turbo prune drops the owner => the Docker build breaks.
    expect(Object.keys(declaredDeps)).toContain(owner);
  });
});

/**
 * COPIED partials need the same declaration, and for a sharper reason.
 *
 * A symlinked partial at least dangles loudly. A copied one is committed, so
 * the schema folder looks complete in the pruned image — but the `build`
 * script re-runs its sync script FIRST, and every sync script exits 1 when its
 * SOURCE package is missing. `turbo prune` drops any package the dependency
 * graph does not reach, so an undeclared owner fails the image build on a file
 * that is sitting right there, correct and committed.
 *
 * That is how CD broke on @12-apps/product-research: a brand-new package with no
 * consumer yet, pruned away, `[research-schema] source partial not found`. The
 * symlink gate above could not see it, because a copy is not a symlink.
 * @12-apps/entity-lifecycle was one `apps/web` dependency away from the same fate.
 */
const copiedPartials = copiedPartialsIn(join(__dirname, 'prisma/schema'));

describe('shared-helpers manifest — copied prisma schema partials', () => {
  it('has at least one copied partial to check', () => {
    expect(copiedPartials.length).toBeGreaterThan(0);
  });

  it.each(copiedPartials)('$partial is owned by a declared workspace dependency', ({ owner }) => {
    // Undeclared => turbo prune drops the owner => its sync script exits 1
    // during `pnpm turbo build` => the Docker image never builds.
    expect(Object.keys(declaredDeps)).toContain(owner);
  });
});
