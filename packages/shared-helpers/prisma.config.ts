/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the connection URL and the seed command no longer live in
 * schema.prisma / package.json — they move here. The Prisma CLI is invoked with
 * cwd = packages/shared-helpers (`pnpm --filter @12-apps/shared-helpers prisma:*`),
 * so the `schema` / `migrations` paths resolve relative to this file.
 *
 * Prisma 7 also stopped auto-loading `.env`, hence the explicit `dotenv/config`
 * import so `env("DATABASE_URL")` is populated for migrate / db push.
 * The runtime PrismaClient does NOT use this datasource — it reads DATABASE_URL
 * through its driver adapter (see src/prisma/index.ts).
 *
 * No `migrations.seed` here: seeding is the consuming app's job, since the seed
 * data belongs to the domain models this package deliberately does not own.
 */
import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  // Multi-file schema FOLDER: `schema.prisma` (datasource/generator, no domain
  // models) plus the model partials OWNED by the plugin packages —
  // `entity-lifecycle.prisma`, `product-research.prisma`, `shift.prisma` — each
  // synced in via its scripts/sync-*-schema.mjs (the plug-and-play seam, so
  // hosts never hand-copy those models).
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Read directly from process.env (populated by dotenv above) rather than
    // prisma's strict `env()` helper, which throws at config-load when the var
    // is unset — that would break `prisma generate` / `pnpm build` on machines
    // without a DATABASE_URL. Generate needs no connection; migrate / db push /
    // db seed surface a clear connection error if the URL is genuinely missing.
    url: process.env.DATABASE_URL,
  },
});
