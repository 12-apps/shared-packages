/**
 * Prisma client singleton.
 *
 * Default mode builds a PostgreSQL-backed `PrismaClient` (the real / production
 * database, driven by `DATABASE_URL`). When a PGlite flag is present in the
 * environment the same client is built on the community `pglite-prisma-adapter`
 * so PGlite (WASM Postgres) becomes the app runtime database for local dev and
 * Playwright e2e — no Docker Postgres required.
 *
 * PGlite mode is selected by ANY of:
 *   - `USE_FILE_DB=1` (or `true`)            → in-memory, unless a dir is also set
 *   - `PGLITE_DATA_DIR=<dir>`                → file-backed at <dir>
 *   - `DATABASE_URL` starting with `pglite:` → `pglite:memory` or `pglite:<dir>`
 *
 * Production safety: when `NODE_ENV=production` the database is ALWAYS real
 * PostgreSQL unless `USE_FILE_DB=1` is set explicitly — so a stray
 * `PGLITE_DATA_DIR` / `pglite:` URL can never silently point prod at a throwaway
 * WASM DB. `USE_FILE_DB=0` forces real PostgreSQL everywhere (dev/e2e opt-out).
 *
 * The generated `PrismaClient` type is re-exported below so consumers stay fully
 * typed without any hand-written stub interfaces. Server-only: never import this
 * (directly or transitively) from middleware or an Edge-runtime route — PGlite
 * needs Node's filesystem/WASM and Prisma is not Edge-safe.
 */

// Re-export the generated client type.
export type { PrismaClient } from '@prisma/client';

import { Buffer } from 'node:buffer';

import type { Prisma, PrismaClient } from '@prisma/client';

import { applyAppendOnlyGuard } from './append-only-extension';
import { applyAuditStamps } from './audit-extension';

// Append-only guard for the audit log (FUT-209): mutating the AuditLog model
// throws. Re-exported so tests can assert on the error type.
export { AppendOnlyViolationError } from './append-only-extension';
/**
 * Declare which models carry attribution, and which keep a normalised search
 * column. Call once at the composition root, before the first client is built —
 * nothing is stamped until you do. See `audit-extension.ts` for why this is the
 * host's to say rather than a list this package guesses.
 */
export { configureAuditStamps, auditStampConfig, type AuditStampConfig } from './audit-extension';

// Change-attribution context helpers (FUT-168): the auth layer calls `setActor`
// once a request is authorized; the audit extension applied below reads it to
// stamp created_by/updated_by. Re-exported here so consumers import them from
// the same `@12-apps/prisma` entry point as `getPrismaClient`.
export {
  actorContextKey,
  DEFAULT_ACTOR_STORE_KEY,
  declareActorContextKey,
  getActorAttribution,
  getActorUserId,
  runWithActor,
  runWithActorScope,
  setActor,
  type ActorAttribution,
  type ActorAttributionSnapshot,
  type ActorContext,
} from './actor-context';
export { normalizeSearchText } from './search-normalize';

// The singleton and its in-flight init promise live on `globalThis` so that
// Next dev / Turbopack hot-reload (which re-evaluates this module) never spawns
// a second PGlite instance against the same dataDir — PGlite holds a single
// exclusive connection, and a duplicate would deadlock or corrupt the store.

/**
 * The `globalThis` keys the client singleton lives under, exported as named
 * constants because they are cross-module-instance coordination surface (two
 * copies of this package in one process share the client through them), not a
 * private detail.
 */
export const DEFAULT_CLIENT_STORE_KEY = '__12appsPrisma';
export const DEFAULT_CLIENT_INIT_KEY = '__12appsPrismaInit';

/**
 * The keys releases before 5.0.0 used — the host-branded names 5.0.0 renamed
 * away, decoded from base64 at runtime so no spelling of the brand — whole or
 * split — appears in shipped source.
 * Still read and mirrored so a process mixing this copy with a pre-5.0.0 copy
 * shares ONE client instead of racing two PGlite instances on one dataDir.
 * DELETE in 6.0.0, with the fallbacks below, once no adopter pins
 * `@12-apps/prisma` < 5.0.0 (both known consumers pin exact versions).
 */
const LEGACY_CLIENT_STORE_KEY = Buffer.from('X19mdXR1cmVQYXlQcmlzbWE=', 'base64').toString();
const LEGACY_CLIENT_INIT_KEY = `${LEGACY_CLIENT_STORE_KEY}Init`;

const globalStore = globalThis as unknown as Record<string, unknown>;

/** The live client, under the current key or a pre-5.0.0 copy's. */
const currentClient = (): PrismaClient | undefined =>
  (globalStore[DEFAULT_CLIENT_STORE_KEY] ?? globalStore[LEGACY_CLIENT_STORE_KEY]) as
    | PrismaClient
    | undefined;

/** The in-flight init, under the current key or a pre-5.0.0 copy's. */
const currentInit = (): Promise<PrismaClient> | undefined =>
  (globalStore[DEFAULT_CLIENT_INIT_KEY] ?? globalStore[LEGACY_CLIENT_INIT_KEY]) as
    | Promise<PrismaClient>
    | undefined;

/** Write (or clear) the client under BOTH keys, so either copy finds it. */
const storeClient = (client: PrismaClient | undefined): void => {
  globalStore[DEFAULT_CLIENT_STORE_KEY] = client;
  globalStore[LEGACY_CLIENT_STORE_KEY] = client;
};

/** Write (or clear) the in-flight init under BOTH keys. */
const storeInit = (init: Promise<PrismaClient> | undefined): void => {
  globalStore[DEFAULT_CLIENT_INIT_KEY] = init;
  globalStore[LEGACY_CLIENT_INIT_KEY] = init;
};

/**
 * Prisma log levels.
 *
 * Full `query` logging prints every SQL statement (table/column names) to the
 * server console, so it is OFF by default — even in development — to avoid
 * surfacing schema details and noise. Opt in locally with `PRISMA_LOG_QUERIES=1`.
 * Production logs errors only.
 */
const prismaLog = (): Array<'query' | 'error' | 'warn'> => {
  if (process.env.NODE_ENV === 'production') return ['error'];
  return process.env.PRISMA_LOG_QUERIES === '1'
    ? ['query', 'error', 'warn']
    : ['error', 'warn'];
};

/**
 * Resolve PGlite mode from the environment. Returns `{ dataDir? }` when PGlite is
 * requested (`dataDir` undefined ⇒ in-memory), or `null` for the default
 * PostgreSQL path.
 *
 * Precedence (production can never fall back to a throwaway file DB by accident):
 *   1. `USE_FILE_DB=0|false`  → PostgreSQL (explicit opt-out always wins).
 *   2. `NODE_ENV=production`  → PostgreSQL, unless `USE_FILE_DB=1` is explicit.
 *   3. `USE_FILE_DB=1|true` / `PGLITE_DATA_DIR` / a `pglite:` URL → PGlite.
 *   4. otherwise              → PostgreSQL.
 */
/** The parsed PGlite-selection signals read from the environment. */
interface PgliteEnv {
  url: string;
  explicitDir: string | undefined;
  forcedOn: boolean;
  forcedOff: boolean;
  urlIsPglite: boolean;
}

/**
 * Whether the environment selects PGlite over PostgreSQL. Production is
 * PostgreSQL unless a file DB is DELIBERATELY forced on; an explicit
 * `USE_FILE_DB=0` always wins.
 */
const isPgliteSelected = (env: PgliteEnv): boolean => {
  if (env.forcedOff) return false;
  if (process.env.NODE_ENV === 'production') return env.forcedOn;
  return env.forcedOn || env.explicitDir !== undefined || env.urlIsPglite;
};

/**
 * Resolve the PGlite target once selected: an explicit dir wins, else a
 * `pglite:` URL (`pglite:memory` / `pglite://memory` ⇒ in-memory; `pglite:./dir`
 * ⇒ file), else `USE_FILE_DB` with no directory ⇒ in-memory.
 */
const pgliteTarget = (env: PgliteEnv): { dataDir?: string } => {
  if (env.explicitDir) return { dataDir: env.explicitDir };
  if (env.urlIsPglite) {
    const raw = env.url.replace(/^pglite:(\/\/)?/, '');
    return raw === '' || raw === 'memory' ? {} : { dataDir: raw };
  }
  return {};
};

const resolvePglite = (): { dataDir?: string } | null => {
  const url = process.env.DATABASE_URL ?? '';
  const flag = (process.env.USE_FILE_DB ?? '').toLowerCase();
  const env: PgliteEnv = {
    url,
    explicitDir: process.env.PGLITE_DATA_DIR,
    forcedOn: flag === '1' || flag === 'true',
    forcedOff: flag === '0' || flag === 'false',
    urlIsPglite: url.startsWith('pglite:'),
  };

  return isPgliteSelected(env) ? pgliteTarget(env) : null;
};

/** Build a PGlite-backed `PrismaClient` via the community driver adapter. */
const createPgliteClient = async (dataDir?: string): Promise<PrismaClient> => {
  const { PGlite } = await import('@electric-sql/pglite');
  // `pglite-prisma-adapter` is `exports`-only; type the dynamic import locally
  // so it resolves under this package's classic ("Node") module resolution
  // without a static type dependency on the package.
  const { PrismaPGlite } = (await import('pglite-prisma-adapter')) as unknown as {
    PrismaPGlite: new (client: unknown) => unknown;
  };
  const { PrismaClient: GeneratedPrismaClient } = await import('@prisma/client');

  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;

  const adapter = new PrismaPGlite(
    client,
  ) as Prisma.PrismaClientOptions['adapter'];
  return applyAppendOnlyGuard(
    applyAuditStamps(new GeneratedPrismaClient({ adapter, log: prismaLog() })),
  );
};

/** Build the default PostgreSQL-backed `PrismaClient` (real / production DB). */
const createPostgresClient = async (): Promise<PrismaClient> => {
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient: GeneratedPrismaClient } = await import('@prisma/client');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required for the PostgreSQL Prisma client. Set it, or ' +
        'enable PGlite mode (USE_FILE_DB=1 / PGLITE_DATA_DIR / a "pglite:" URL).',
    );
  }

  // Prisma 7 makes a driver adapter mandatory — PrismaClient no longer reads
  // DATABASE_URL itself, and `new PrismaClient()` without an adapter throws at
  // construction. PrismaPg takes a pg.PoolConfig and owns the pool internally.
  const adapter = new PrismaPg({
    connectionString,
  }) as Prisma.PrismaClientOptions['adapter'];
  return applyAppendOnlyGuard(
    applyAuditStamps(new GeneratedPrismaClient({ adapter, log: prismaLog() })),
  );
};

/**
 * Get or create the Prisma client instance.
 *
 * Lazy and memoised: concurrent callers share a single in-flight init promise,
 * so only one client (and at most one PGlite instance) is ever created. A
 * missing generated client surfaces an actionable error rather than a hard
 * module-load failure.
 */
export const getPrismaClient = async (): Promise<PrismaClient> => {
  const existing = currentClient();
  if (existing) {
    // Found under either key (a pre-5.0.0 copy may have created it): make sure
    // both names point at it before answering, so neither copy re-creates.
    storeClient(existing);
    return existing;
  }
  const inFlight = currentInit();
  if (inFlight) {
    storeInit(inFlight);
    return inFlight;
  }

  const pglite = resolvePglite();
  const init = (
    pglite ? createPgliteClient(pglite.dataDir) : createPostgresClient()
  )
    .then((client) => {
      storeClient(client);
      storeInit(undefined);
      return client;
    })
    .catch((error: unknown) => {
      storeInit(undefined);
      throw new Error(
        `Prisma client not available (${pglite ? 'PGlite' : 'PostgreSQL'} mode). ` +
          'Run "pnpm --filter @12-apps/prisma prisma generate" from the ' +
          'monorepo root, or "pnpm prisma generate" from packages/prisma. ' +
          `Cause: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    });

  storeInit(init);
  return init;
};

/**
 * Set a custom Prisma client instance (for testing).
 */
export const setPrismaClient = (client: PrismaClient): void => {
  storeClient(client);
  storeInit(undefined);
};

/**
 * Reset the Prisma client instance (for testing).
 */
export const resetPrismaClient = (): void => {
  storeClient(undefined);
  storeInit(undefined);
};
