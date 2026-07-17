/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the connection URL and the seed command no longer live in
 * schema.prisma / package.json — they move here. The Prisma CLI is invoked with
 * cwd = packages/shared-helpers (`pnpm --filter @12-apps/shared-helpers prisma:*`),
 * so the `schema` / `migrations` paths resolve relative to this file.
 *
 * Prisma 7 also stopped auto-loading `.env`, hence the explicit `dotenv/config`
 * import so `env("DATABASE_URL")` is populated for migrate / db push / db seed.
 * The runtime PrismaClient does NOT use this datasource — it reads DATABASE_URL
 * through its driver adapter (see src/prisma/index.ts).
 */
import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
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
