# @12-apps/prisma

The repo's **Prisma host**. Everything Prisma-shaped lives here and nowhere
else: the multi-file schema folder, the migrations folder, the sync scripts that
pull plugin-owned models and migrations in, and the runtime `PrismaClient`
singleton with its audit / append-only extensions.

It was carved out of `@12-apps/shared-helpers`, which is a bag of generic
utilities (S3, caching, requests, money, dates) and had no business owning a
database schema. Splitting it means a consumer that wants `formatMoney` no
longer installs `@prisma/client`, PGlite and a WASM Postgres to get it.

```
packages/prisma/
  prisma/
    schema/            # datasource + generator, plus the plugin partials
    migrations/        # every committed migration, host- and plugin-owned
    plugin-migrations.json   # generated: which migrations came from a plugin
    migration-files.ts       # side-effect-free migration discovery
  prisma.config.ts     # Prisma 7 config (schema/migrations paths, datasource)
  scripts/             # the sync + verification scripts
  src/                 # the runtime client and its extensions
```

## What it exports

```ts
import {
  getPrismaClient,
  setPrismaClient,
  resetPrismaClient,
  runWithActor,
  setActor,
  getActorUserId,
  getActorAttribution,
  normalizeSearchText,
  AppendOnlyViolationError,
  type PrismaClient,
} from '@12-apps/prisma';
```

`getPrismaClient()` is lazy and memoised on `globalThis`, so Next dev /
Turbopack hot-reload never spawns a second PGlite instance. It builds a
PostgreSQL-backed client by default and a PGlite-backed one when `USE_FILE_DB`,
`PGLITE_DATA_DIR` or a `pglite:` `DATABASE_URL` selects it — never in
production unless `USE_FILE_DB=1` is explicit.

Server-only. `AsyncLocalStorage` and PGlite are Node APIs, and Prisma is not
Edge-safe, so nothing here may be imported (directly or transitively) from
middleware or an Edge-runtime route.

## The plugin seam

Packages that own persisted models keep the model file **and its migrations** in
their own folder, and this package pulls them in:

| Owner | Partial | Pulled in by |
|---|---|---|
| `@12-apps/entity-lifecycle` | `entity-lifecycle.prisma` | `scripts/sync-lifecycle-schema.mjs` |
| `@12-apps/product-research` | `product-research.prisma` | `scripts/sync-research-schema.mjs` |
| `@12-apps/shift` | `shift.prisma` | `scripts/sync-shift-schema.mjs` |
| `@12-apps/jobs` | `jobs.prisma` | `scripts/sync-jobs-schema.mjs` |
| `@12-apps/entitlements` | `entitlements.prisma` | `scripts/sync-entitlements-schema.mjs` |
| `@12-apps/payments-backend` | `payments.prisma` | `scripts/sync-payments-schema.mjs` |
| `@12-apps/report-builder` | `report-builder.prisma` | `scripts/sync-report-builder-schema.mjs` |

Every partial is a committed **COPY** — never a symlink, with no exceptions.
`payments.prisma` and `report-builder.prisma` used to be symlinks, and the
published tarball shipped without them: `npm pack` silently drops symlinked
entries, exactly the way Prisma's migration walk skips a linked migration.
The `--check` syncs and `package.test.ts`'s no-symlink walk keep it true.

Migrations travel separately, through `scripts/sync-prisma-plugins.mjs`, which
discovers every plugin-owned `migrations` directory **structurally** rather than
from a hardcoded list.

`prisma/schema/schema.prisma` is **datasource + generator only** — this repo
deliberately owns no domain models, and no seed command either. The consuming
application supplies both.

Three rules that came from production incidents, gated by `package.test.ts`:

- **Migrations are copied, never symlinked.** Prisma enumerates the migrations
  folder with `lstat`, so a symlinked migration reports `isDirectory() === false`
  and is silently skipped — a green deploy that changed no schema.
- **Schema partials are copies too — nothing under `prisma/` may be a symlink.**
  `npm pack` drops symlinked entries from the tarball with no warning, so the
  published package shipped a schema folder missing three models. A structural
  walk asserts zero symlinks, and a pack-manifest gate asks `npm pack
  --dry-run` itself that every partial and migration ships.
- **A partial's owning package must be a declared workspace dependency.**
  `turbo prune` copies only what the dependency graph reaches; an undeclared
  owner is dropped from the build context, the committed partial's source
  vanishes, and its sync script exits 1 during the image build.

## Scripts

```bash
pnpm --filter @12-apps/prisma prisma:generate        # sync (check mode) + generate
pnpm --filter @12-apps/prisma prisma:migrate         # prisma migrate dev
pnpm --filter @12-apps/prisma prisma:sync-plugins    # repair plugin migration copies
pnpm --filter @12-apps/prisma prisma:sync-lifecycle  # repair one partial
```

`build` and `prisma:generate` run every sync in `--check` mode: they **verify**
the committed state and never repair it, so a CI gate can never assert against
a tree it just fixed. Repair is always explicit.
