/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-test-isolation -- the
   filesystem IS the subject here: these tests assert that this package's own
   committed manifest, prisma schema folder and migration copies are what the
   build — and `npm pack` — expect. Mocking the reads would leave the suite
   asserting against a fixture instead of the repo, which is the one thing it
   exists to check. Every path read is a checked-in file resolved from
   __dirname, so there is no ordering or timing to race; the one spawned
   process (`npm pack --dry-run`) reads the same checked-in tree. */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
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

describe('prisma manifest — prisma wiring', () => {
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
 * Packages that own Prisma models keep the model file and its migrations in
 * their OWN folder and this package pulls them in — as committed COPIES,
 * repaired by `scripts/sync-*-schema.mjs` and verified by the same scripts'
 * `--check` mode in the build.
 *
 * EVERYTHING under prisma/ is a copy, NEVER a symlink. Symlinks lose three
 * different ways, all silent: Prisma's migration walk `lstat`s the folder and
 * skips a linked entry even when it resolves; `turbo prune` drops an owner
 * the dependency graph does not reach and leaves the link dangling; and
 * `npm pack` drops symlinked entries from the tarball entirely — the
 * published @12-apps/prisma shipped a schema folder missing the three models
 * whose partials were links. The no-symlink walk below is what makes that
 * class of bug impossible to reintroduce, and the pack manifest gate at the
 * bottom verifies the artifact itself.
 */
const repoRoot = resolve(__dirname, '../..');
const declaredDeps = { ...manifest.dependencies, ...manifest.devDependencies };

/** Every symlink ANYWHERE under `dir`, repo-relative — lstat, recursive. */
function symlinksUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [path.slice(repoRoot.length + 1)];
    if (entry.isDirectory()) return symlinksUnder(path);
    return [];
  });
}

/** A partial that is a committed COPY of some package's own prisma file. */
interface CopiedPartial {
  /** Repo-relative path of the copy, for readable failures. */
  readonly partial: string;
  /** Absolute path of the copy. */
  readonly copy: string;
  /** Absolute path of the owner's source file. */
  readonly source: string;
  /** Package name that owns the source file. */
  readonly owner: string;
}

/**
 * Where a partial's SOURCE may live: `packages/<name>/prisma/<file>`, or one
 * level deeper for nested packages (`packages/payments/backend/prisma/
 * payments.prisma`). Structural, so a moved owner is found rather than
 * silently skipped.
 */
function sourceOf(fileName: string): string | null {
  const base = fileName.replace(/\.prisma$/, '');
  const flat = join(repoRoot, 'packages', base, 'prisma', fileName);
  if (existsSync(flat)) return flat;
  const parent = join(repoRoot, 'packages', base);
  if (!existsSync(parent)) return null;
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(parent, entry.name, 'prisma', fileName);
    if (existsSync(nested)) return nested;
  }
  return null;
}

/**
 * Every partial in `dir` whose SOURCE lives in a workspace package.
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
      const source = sourceOf(entry.name);
      if (source === null) return [];
      const owner = owningPackage(source);
      return owner
        ? [{ partial: `prisma/schema/${entry.name}`, copy: join(dir, entry.name), source, owner }]
        : [];
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
describe('prisma host — migrations are visible to Prisma', () => {
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

/**
 * NOTHING under prisma/ may be a symlink — not a partial, not a migration,
 * not anything a future sync invents. `npm pack` silently drops symlinked
 * entries from the tarball (the published package shipped a schema folder
 * missing three models this way), on top of the Prisma-migration-walk and
 * turbo-prune failure modes documented above. One structural walk makes the
 * whole class unrepresentable in a green tree.
 */
describe('prisma assets — no symlinks anywhere', () => {
  it('finds no symlinked entry under prisma/', () => {
    expect(symlinksUnder(join(__dirname, 'prisma'))).toEqual([]);
  });
});

/**
 * …and no sync script may PUT one there.
 *
 * The walk above checks the tree; this checks the machinery that writes it.
 * Two owning-side scripts kept the pre-#153 symlink shape long after the
 * copies landed — `packages/payments/backend/scripts/sync-payments-schema.mjs`
 * and `packages/report-builder/scripts/sync-report-builder-schema.mjs` — and
 * nothing was red, because no gate and no workflow ran an owning-side
 * `prisma:sync:check`. Worse than a stale script: its `--check` failure told
 * the reader to run `prisma:sync`, which recreated the link. A gate on the
 * artifact alone cannot see an instruction to break the artifact.
 *
 * So: every `sync-*-schema.mjs` in the workspace, on BOTH sides of the copy,
 * must copy. `symlinkSync` creates the bug; `readlinkSync` is how a `--check`
 * demands it — no copy-based sync has a use for either.
 */
const syncScripts = syncScriptsUnder(join(repoRoot, 'packages'));

/** Every `scripts/sync-*-schema.mjs` under `dir`, repo-relative. */
function syncScriptsUnder(dir: string): string[] {
  const skip = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skip.has(entry.name) || entry.isSymbolicLink()) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return syncScriptsUnder(path);
    return /^sync-.*-schema\.mjs$/.test(entry.name) ? [relative(repoRoot, path)] : [];
  });
}

describe('prisma doctrine — every sync script copies, never links', () => {
  it('finds the scripts on both sides of the copy', () => {
    // Non-vacuity, and proof the locator reaches a NESTED owner: payments
    // lives at packages/payments/backend, which a flat glob would miss —
    // exactly the script that stayed symlinked.
    for (const script of [
      'packages/payments/backend/scripts/sync-payments-schema.mjs',
      'packages/report-builder/scripts/sync-report-builder-schema.mjs',
      'packages/prisma/scripts/sync-payments-schema.mjs',
      'packages/prisma/scripts/sync-report-builder-schema.mjs',
    ]) {
      expect(syncScripts).toContain(script);
    }
  });

  it.each(syncScripts)('%s creates no symlink and demands none', (script) => {
    const code = readFileSync(join(repoRoot, script), 'utf-8');
    // Comments explain the doctrine and legitimately name the trap, so only
    // the calls that would implement it are forbidden.
    expect(code).not.toMatch(/\bsymlinkSync\s*\(/);
    expect(code).not.toMatch(/\breadlinkSync\s*\(/);
    expect(code).toMatch(/\bcopyFileSync\s*\(/);
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

describe('prisma manifest — copied prisma schema partials', () => {
  it('has at least one copied partial to check', () => {
    expect(copiedPartials.length).toBeGreaterThan(0);
  });

  it('covers every plugin partial, including the nested-owner ones', () => {
    // The ex-symlinks land in this gate the day they become copies; a source
    // locator that missed a nested owner (payments lives at
    // packages/payments/backend) would silently exempt it from every check
    // below.
    const names = copiedPartials.map(({ partial }) => partial).sort();
    for (const partial of [
      'prisma/schema/entitlements.prisma',
      'prisma/schema/payments.prisma',
      'prisma/schema/report-builder.prisma',
    ]) {
      expect(names).toContain(partial);
    }
  });

  it.each(copiedPartials)('$partial is owned by a declared workspace dependency', ({ owner }) => {
    // Undeclared => turbo prune drops the owner => its sync script exits 1
    // during `pnpm turbo build` => the Docker image never builds.
    expect(Object.keys(declaredDeps)).toContain(owner);
  });

  it.each(copiedPartials)('$partial matches its source byte for byte', ({ copy, source }) => {
    // Drift between the owner and the synced copy means the host generates a
    // client the package did not author — the `--check` syncs in the build
    // enforce this too; this is the gate that runs even without a build.
    expect(readFileSync(copy, 'utf-8')).toBe(readFileSync(source, 'utf-8'));
  });
});

/**
 * The ARTIFACT gate: what `npm pack` would actually upload. Everything under
 * prisma/ that the repo holds must appear in the pack manifest — this is the
 * assertion that fails on the symlink bug even if the walk above is ever
 * weakened, because it asks the packer itself rather than the filesystem.
 */
describe('prisma assets — the pack manifest ships every prisma asset', () => {
  it('lists every schema partial and every migration in npm pack --dry-run', { timeout: 60_000 }, () => {
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--silent'], {
      cwd: __dirname,
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const [report] = JSON.parse(raw) as [{ files: { path: string }[] }];
    const packed = new Set(report.files.map((file) => file.path));

    const schemaDir = join(__dirname, 'prisma/schema');
    for (const entry of readdirSync(schemaDir)) {
      expect(packed, `prisma/schema/${entry} missing from the tarball`).toContain(
        `prisma/schema/${entry}`,
      );
    }
    for (const name of readdirSync(migrationsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const sql = `prisma/migrations/${name.name}/migration.sql`;
      expect(packed, `not packed: ${name.name}`).toContain(sql);
    }
  });
});
