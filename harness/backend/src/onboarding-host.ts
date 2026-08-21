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
import { onboardingRouter } from '@12-apps/onboarding/hono';
import { PT_BR_ONBOARDING_MESSAGES, PT_BR_ONBOARDING_UNAUTHENTICATED } from '@12-apps/onboarding/server';
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

export function onboardingHost(pg: PGlite) {
  return onboardingRouter({
    // Required host copy — the refusal sentences and the router's 401.
    messages: PT_BR_ONBOARDING_MESSAGES,
    unauthenticatedMessage: PT_BR_ONBOARDING_UNAUTHENTICATED,
    db: async () => onboardingDb(pg) as unknown as OnboardingPrisma,
    featureKeys: ONBOARDING_FEATURES,
    // The harness is not production, and the DEV-only reset is one of the three
    // operations under test.
    resetEnabled: () => true,
    resolveActor: (c) => {
      // Which tenant: resolved from the mounted path's own slug, the way a real
      // host resolves it — and it is HALF THE ROW'S KEY, so an unknown slug
      // resolves nobody rather than defaulting to a tenant the caller did not name.
      const clientId = c.req.param('tenantSlug');
      if (clientId !== ONBOARDING_TENANT && clientId !== ONBOARDING_TENANT_B) return null;
      // Who: the SPA sends no header and acts as the seeded owner. A spec that
      // needs another vantage sets the header; `anonymous` is how it asks for the
      // unauthenticated path — the host resolves nobody, and the package answers
      // 401 before any handler runs.
      const userId = c.req.header(ACTOR_HEADER) ?? 'owner-1';
      if (userId === 'anonymous') return null;
      return { userId, clientId };
    },
  });
}
