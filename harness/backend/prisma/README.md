# The harness's Prisma host

One database carrying **every exported package's tables**, assembled from the
installed tarballs, plus a real `PrismaClient` generated from the same packages'
model partials.

```
prisma/
  schema/schema.prisma   the host's own file: datasource + generator, no models
  schema/<pkg>.prisma    GENERATED — one partial per installed package
  packages.ts            discovery: which tarballs ship schema, and where
  sync-partials.ts       assembles schema/ out of node_modules
  assembled.json         GENERATED — what the last sync found
../prisma.config.ts      Prisma 7 config (schema path, placeholder datasource)
../src/prisma.ts         applyPackageMigrations + createPrismaDatabase
```

## Why this exists beside the SQL seams

`rbac-db.ts`, `audit-db.ts`, `saved-report-db.ts` and their siblings fill each
package's structural store with hand-written SQL, on purpose: a package that
declares `RbacDb` as a shape rather than a Prisma type must work for a host that
has no Prisma at all, and the only way to prove that is to be such a host.

That proof has a blind spot, and it is exactly the size of the artifact those
seams never open — **the `.prisma` partial**. Every package ships two things
that must agree: a migration that creates tables, and a partial that describes
them. Hand-written SQL reads the first and ignores the second, so a partial that
has drifted from its own migration — a renamed `@map`, a nullability that moved,
a `@@unique` no migration ever created — passes every suite in `tests/` and then
fails in the first host that generates a client.

No package can catch that alone either. Each generates against its own partial,
in a database its own migration built; the disagreement is only visible where
both artifacts are read by one tool. That is this folder.

## Assembled from `node_modules`, not from `packages/`

`sync-partials.ts` copies each partial out of the installed tarball, so a
package whose `files` field forgets `prisma` shows up here as a package
contributing nothing — and the sync fails by name rather than producing a
quietly smaller schema. A package must ship **both** halves; either alone is a
packaging bug only a consumer can see.

The copies are generated and gitignored. `@12-apps/prisma` makes the opposite
call — it commits its copies and gates them with `--check` — and both are right
for their host: a product repo wants the schema reviewable in the diff, and a
consumer harness wants it to be whatever the tarball says today.

**`@12-apps/prisma` itself is excluded from the discovery.** It is the
aggregator: its `prisma/migrations` mirrors every plugin's, so counting it would
replay all of them twice. Assembling from each plugin directly also means the
harness sees what a plugin ships *today*, rather than a snapshot taken when the
aggregator was last released.

## Migrations are replayed, never `migrate`d

`applyPackageMigrations(pg)` replays every package's `migration.sql` into one
PGlite, sorted by directory name **across** packages — which is what a real host
gets, since `@12-apps/prisma` copies them all into one folder and Prisma applies
a folder in name order. Interleaving is safe because the partials carry no
cross-package foreign keys: every `client_id` is a by-value scalar, per the
payments/rbac doctrine.

`prisma migrate` is never run and could not be. It authors *new* migrations by
diffing a schema against a shadow database, which is the opposite of applying
the ones a plugin ships — and `pglite-prisma-adapter` is Prisma-Client only, so
there is no migrate engine here in any case.

## Using it

```bash
npm run prisma:sync              # assemble schema/ from node_modules
npm run prisma:sync -- --list    # report what each package contributes
npm run prisma:generate          # sync, then generate the client
npm test                         # pretest runs prisma:generate first
```

```ts
import { createPrismaDatabase } from '../src/prisma';

const { prisma, pg, close } = await createPrismaDatabase();
// `prisma` is a real client over every package's models;
// `pg` is the same database the SQL seams would address.
```
