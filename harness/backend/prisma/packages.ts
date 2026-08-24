/**
 * What the INSTALLED `@12-apps/*` tarballs contribute to this host's database.
 *
 * The one place that answers "which packages ship schema, and where is it" —
 * shared by `sync-partials.ts` (which assembles the schema folder) and
 * `src/prisma.ts` (which replays the SQL). Two readers of one discovery, so the
 * folder Prisma generates a client from and the tables a test actually gets can
 * never disagree about which packages are in play.
 *
 * ## Read from `node_modules`, never from `packages/`
 *
 * Everything here resolves inside `harness/backend/node_modules`, which
 * `scripts/harness-install.mjs` fills with tarballs. That is the whole point of
 * the harness, and it buys a property the workspace cannot: a package whose
 * `files` field forgets `prisma` publishes a schema nobody can adopt, and the
 * only place that is visible is a consumer's install. Here it surfaces as a
 * package contributing nothing — which `sync-partials.ts` turns into a named
 * failure rather than a quietly smaller schema.
 *
 * ## Why `@12-apps/prisma` is excluded
 *
 * It is the AGGREGATOR: its own `prisma/migrations` is a mirror of every plugin
 * package's, assembled at ITS build time by sixteen `sync-*-schema.mjs` scripts.
 * It is installed here like every other tarball, so counting it would replay
 * every migration twice — the second pass failing on `relation already exists`,
 * or worse, succeeding on whichever ones happen to be written defensively.
 *
 * Excluding it is also the more honest test. A mirror is a snapshot taken when
 * `@12-apps/prisma` was last released; assembling from each plugin directly
 * means this harness sees what a plugin ships TODAY, so a plugin whose newest
 * migration has not reached the aggregator yet is still exercised here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `harness/backend`, resolved from this file so the cwd never matters. */
export const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));

const SCOPE_DIR = join(BACKEND_DIR, 'node_modules', '@12-apps');

/**
 * The aggregator, and the only `@12-apps` package this discovery skips.
 *
 * Named rather than detected. "Ships migrations that duplicate another
 * package's" is exactly the condition a genuine drift would also satisfy, so
 * detecting it would silence the failure this harness exists to raise.
 */
const AGGREGATOR = 'prisma';

export interface SchemaPackage {
  /** Package name without the scope, e.g. `rbac`. */
  name: string;
  /** Full package name, e.g. `@12-apps/rbac`. */
  packageName: string;
  /** Absolute path to the package's shipped `prisma/` directory. */
  prismaDir: string;
  /** Absolute paths to its `*.prisma` model files, in name order. */
  partials: string[];
  /** Migration directory names carrying a `migration.sql`, in name order. */
  migrations: string[];
}

export interface MigrationFile {
  /** The package that ships it, for a failure message that names an owner. */
  package: string;
  /** The migration directory name — what decides apply order. */
  dir: string;
  /** Absolute path to its `migration.sql`. */
  path: string;
}

/** Directory entries only — a stray file under the scope is not a package. */
function installedScopeDirs(): string[] {
  if (!existsSync(SCOPE_DIR)) {
    throw new Error(
      `No @12-apps packages installed at ${SCOPE_DIR}. ` +
        'Run `node scripts/harness-install.mjs` from the repo root first.',
    );
  }
  return readdirSync(SCOPE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== AGGREGATOR)
    .sort();
}

/**
 * Every installed package that ships a `prisma/` directory, in name order.
 *
 * A package contributes partials, migrations, or both. `@12-apps/billing` ships
 * neither and is simply absent: it persists through ports its host fills, which
 * is a design choice rather than a gap.
 */
export function schemaPackages(): SchemaPackage[] {
  const found: SchemaPackage[] = [];
  for (const name of installedScopeDirs()) {
    const prismaDir = join(SCOPE_DIR, name, 'prisma');
    if (!existsSync(prismaDir)) continue;

    const entries = readdirSync(prismaDir, { withFileTypes: true });
    const partials = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.prisma'))
      .map((entry) => join(prismaDir, entry.name))
      .sort();

    const migrationsDir = join(prismaDir, 'migrations');
    const migrations = existsSync(migrationsDir)
      ? readdirSync(migrationsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .filter((dir) => existsSync(join(migrationsDir, dir, 'migration.sql')))
          .sort()
      : [];

    if (partials.length === 0 && migrations.length === 0) continue;
    found.push({ name, packageName: `@12-apps/${name}`, prismaDir, partials, migrations });
  }
  return found;
}

/**
 * Every migration from every package, as one ordered list.
 *
 * Sorted by DIRECTORY NAME across packages, which is what a real host gets:
 * `@12-apps/prisma` copies each plugin's migrations into one folder and Prisma
 * applies a folder in name order. Modelling that ordering here is the point —
 * the harness should meet an ordering hazard a host would meet, not route
 * around it by grouping per package.
 *
 * Safe to interleave because the partials carry no cross-package foreign keys:
 * every `client_id` is a by-value scalar (the payments/rbac doctrine), so no
 * package's tables depend on another's existing first.
 *
 * The package name breaks a tie, so two packages that stamp the same timestamp
 * still apply in a stable order rather than whatever the filesystem returns.
 */
export function orderedMigrations(): MigrationFile[] {
  const all = schemaPackages().flatMap((pkg) =>
    pkg.migrations.map((dir) => ({
      package: pkg.packageName,
      dir,
      path: join(pkg.prismaDir, 'migrations', dir, 'migration.sql'),
    })),
  );
  return all.sort((a, b) => a.dir.localeCompare(b.dir) || a.package.localeCompare(b.package));
}

/** Every migration's SQL, in apply order. Read eagerly so a bad path fails here. */
export function migrationStatements(): (MigrationFile & { sql: string })[] {
  return orderedMigrations().map((migration) => ({
    ...migration,
    sql: readFileSync(migration.path, 'utf8'),
  }));
}

export interface DeclaredModel {
  /** The package that declares it. */
  package: string;
  /** The Prisma model name, i.e. the client delegate's name once lowercased. */
  model: string;
  /** The table it maps to — `@@map` where there is one, the model name otherwise. */
  table: string;
}

/** The three lines the parse recognises; hoisted so they compile once. */
const MODEL_OPENING = /^\s*model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/;
const TABLE_MAP = /^\s*@@map\("([^"]+)"\)/;
const BLOCK_CLOSE = /^\s*\}\s*$/;

/**
 * The models one partial declares, with the table each claims.
 *
 * Split out of {@link declaredModels} so the line-level parse is one function
 * with one job — the enclosing walk over packages and their partials says
 * nothing about Prisma syntax, and this says nothing about where files are.
 */
function modelsInPartial(packageName: string, partial: string): DeclaredModel[] {
  const found: DeclaredModel[] = [];
  let model: string | null = null;
  let table: string | null = null;
  for (const line of readFileSync(partial, 'utf8').split('\n')) {
    const opening = MODEL_OPENING.exec(line);
    if (opening?.[1]) {
      model = opening[1];
      table = null;
    } else if (model === null) {
      continue;
    } else if (BLOCK_CLOSE.test(line)) {
      found.push({ package: packageName, model, table: table ?? model });
      model = null;
      table = null;
    } else {
      table = TABLE_MAP.exec(line)?.[1] ?? table;
    }
  }
  return found;
}

/**
 * Every model declared by every installed partial, with the table it claims.
 *
 * Parsed out of the `.prisma` text rather than read off the generated client's
 * DMMF, for two reasons. The partial IS the artifact under test here, so
 * reading it directly keeps the assertion pointed at the file a package ships;
 * and `Prisma.dmmf` is an internal whose shape has moved between major
 * versions, which would make a Prisma bump look like a schema failure.
 *
 * The parse is deliberately shallow — block headers and `@@map`, nothing else.
 * `enum` and `type` blocks are not models and carry no table, so only `model`
 * opens a block here.
 */
export function declaredModels(): DeclaredModel[] {
  return schemaPackages().flatMap((pkg) =>
    pkg.partials.flatMap((partial) => modelsInPartial(pkg.packageName, partial)),
  );
}
