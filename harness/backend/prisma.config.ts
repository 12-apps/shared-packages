/**
 * Prisma 7 configuration for the consumer harness.
 *
 * Only `generate` is ever run here, and it needs no connection: the schema
 * folder is assembled from the installed tarballs by `prisma/sync-partials.mjs`
 * and the tables are created by REPLAYING each package's shipped
 * `migration.sql` into PGlite (`prisma/migrations.mjs`), never by
 * `prisma migrate`.
 *
 * That is not a shortcut around a missing feature — it is what a host does with
 * plugin-owned migrations. A package ships its migrations so the host applies
 * them alongside its own; `prisma migrate dev` would try to author NEW ones by
 * diffing the schema against a shadow database, which is the opposite job. It
 * is also the only option available: `pglite-prisma-adapter` is Prisma-Client
 * only, so `migrate` has no engine to talk to here at all.
 *
 * `datasource.url` is therefore a placeholder that exists to keep the CLI from
 * refusing to load a config with no URL. Nothing connects through it.
 */
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // A multi-file schema FOLDER: `schema.prisma` is the host's (datasource +
  // generator, no models) and every other file in it is a package's partial,
  // copied out of `node_modules` on each install.
  schema: 'prisma/schema',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://harness:harness@127.0.0.1:5432/harness',
  },
});
