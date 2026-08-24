/**
 * Everything `@12-apps/onboarding` needs from a HOST, in one object (12-23).
 *
 * What is genuinely the host's, and all that is here: who is calling and which
 * tenant they are acting on (a header-driven session stand-in — a browser cannot
 * have a real one), and where the owned table lives. Everything after that —
 * parsing, the three operations, the timestamp stamping, the statuses, the
 * envelope — is the package's, which is the claim under test.
 *
 * The table arrives the way a host deploy applies it: the PACKAGE'S OWN migration,
 * read out of the installed tarball.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import { onboardingManifest } from '@12-apps/onboarding/manifest';
import { onboardingServerManifest } from '@12-apps/onboarding/manifest/server';
import type { MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import { harnessLoggerFor, honoRouterFor } from './wire-hono';
import { PT_BR_ONBOARDING_MESSAGES } from '@12-apps/onboarding/server';
import type { OnboardingPrisma } from '@12-apps/onboarding/server';

import { onboardingDb } from './onboarding-db';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/onboarding/prisma/migrations/', import.meta.url),
);

/** The tenant the SPA page and most specs drive. */
export const ONBOARDING_TENANT = 'harness';

/**
 * A second tenant. Progress is keyed `(user, tenant, feature)`, so tenant
 * isolation is the property with the highest stakes here — and a harness with one
 * tenant cannot exercise it at the tarball level.
 */
export const ONBOARDING_TENANT_B = 'harness-b';

/** The guided features this host serves; anything else is a 404. */
export const ONBOARDING_FEATURES = ['ai_integration', 'payments'] as const;

/** The header a spec (or the SPA) sets to act as someone else. */
const ACTOR_HEADER = 'x-onboarding-user';

/** The mounted surface's type — inferred, so the router keeps its shape. */
export type HarnessOnboarding = ReturnType<typeof onboardingHost>;

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyOnboardingMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/** Back to a clean slate — the `/__harness/reset` contract. */
export async function reseedOnboarding(pg: PGlite): Promise<void> {
  await pg.exec('TRUNCATE TABLE onboarding_states');
}

/** Where `mount-surfaces.ts` hangs it — the adoption's claim. */
export const ONBOARDING_MOUNT_PATH = '/api/admin/:tenantSlug';

export interface OnboardingHost {
  router: ReturnType<typeof honoRouterFor>;
  /** The consumer's account of what was bound, declined or left over. */
  report: WiringReport;
  routes: readonly MountedRoute[];
}

/**
 * The surface, adopted through `@12-apps/wiring/consumer` rather than through
 * `@12-apps/onboarding/hono`.
 *
 * The per-package adapter still works. What it cannot do is answer the
 * manifest, and this one declares a MANDATORY `observability` namespace whose
 * reason it states in one line — "a progress write that fails files under
 * `onboarding`, not nowhere." `onboardingRouter` takes no logger argument, so
 * the binder is the only thing that can supply one.
 *
 * `db` is collected rather than bound, which still means COUNTED: the partial
 * and its migrations appear in the report, so a host can be asked what it did
 * with them instead of never being told they exist.
 *
 * ONE thing genuinely changes, and it is worth stating rather than discovering:
 * the 401 body. `onboardingRouter` took an `unauthenticatedMessage` and wrote
 * the package's own refusal; the shared bridge answers its own, the same one it
 * answers for every adopted surface. That is the trade the contract makes on
 * purpose — a host has ONE framework adapter instead of one per package, so the
 * sentence a caller with no session reads is the host's, once. The status is
 * unchanged, and it is still refused before any handler runs.
 */
export function onboardingHost(pg: PGlite): OnboardingHost {
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });

  host.adoptServer({
    manifest: onboardingManifest,
    server: onboardingServerManifest,
    bindings: {
      http: {
        mountPath: ONBOARDING_MOUNT_PATH,
        config: {
          // Required host copy — the refusal sentences.
          messages: PT_BR_ONBOARDING_MESSAGES,
          db: async () => onboardingDb(pg) as unknown as OnboardingPrisma,
          featureKeys: ONBOARDING_FEATURES,
          // The harness is not production, and the DEV-only reset is one of the
          // three operations under test.
          resetEnabled: () => true,
        },
      },
    },
  });

  const wired = host.assemble();

  return {
    report: wired.report,
    routes: wired.routes,
    router: honoRouterFor(wired.routes, (c) => {
      // Which tenant: resolved from the mounted path's own slug, the way a real
      // host resolves it — and it is HALF THE ROW'S KEY, so an unknown slug
      // resolves nobody rather than defaulting to a tenant the caller did not
      // name.
      const clientId = c.req.param('tenantSlug');
      if (clientId !== ONBOARDING_TENANT && clientId !== ONBOARDING_TENANT_B) return null;
      // Who: the SPA sends no header and acts as the seeded owner. A spec that
      // needs another vantage sets the header; `anonymous` is how it asks for
      // the unauthenticated path — the host resolves nobody, and the bridge
      // answers 401 before any handler runs.
      const userId = c.req.header(ACTOR_HEADER) ?? 'owner-1';
      if (userId === 'anonymous') return null;
      return { userId, clientId };
    }),
  };
}
