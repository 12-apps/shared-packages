/**
 * The `@12-apps/feature-flags` adoption (FUT-884), through the wiring
 * consumer like the reports surface beside it. What is genuinely the HOST's,
 * and all that is here: the CATALOG (a flag is host vocabulary — the package
 * refuses to ship one), the directory that turns by-value user ids into
 * people, where grant rows live, and WHO is calling.
 *
 * The actor is the platform operator's email and nothing else — the package
 * treats it as the audit identity, never an authorization input. In the
 * origin host the guard in front of this surface is the env-allowlist
 * superadmin check; this harness has exactly one operator, resolved
 * unconditionally, which plays the same role the frozen reports actor does.
 */
import type { FeatureFlagsDb, FlagDefinition } from '@12-apps/feature-flags';
import { featureFlagsManifest } from '@12-apps/feature-flags/manifest';
import { featureFlagsServerManifest } from '@12-apps/feature-flags/manifest/server';
import type { FeatureFlagsActor } from '@12-apps/feature-flags/server';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';
import type { MountedRoute } from '@12-apps/wiring';
import { Hono } from 'hono';

import { harnessDirectory, memoryFeatureFlagsDb } from './feature-flags-db';
import { honoRouterFor } from './wire-hono';

/** The betas this host is running — pt-BR copy, the operator reads it. */
export const HARNESS_FLAGS: readonly FlagDefinition[] = [
  {
    key: 'delivery-beta',
    label: 'Delivery (beta)',
    description: 'Entrega em teste para lojas selecionadas.',
  },
  { key: 'novo-dashboard', label: 'Novo dashboard' },
];

const OPERATOR: FeatureFlagsActor = { email: 'root@harness.dev' };

/** Where `mount-surfaces.ts` hangs the router — the adoption's claim. */
export const FEATURE_FLAGS_MOUNT_PATH = '/api/platform/feature-flags';

/** Ana starts inside the delivery beta so the surface opens with a tally. */
function seededStore(): FeatureFlagsDb {
  return memoryFeatureFlagsDb([
    { userId: 'u-ana', flagKey: 'delivery-beta', note: 'primeira testadora' },
  ]);
}

export function wireFeatureFlags(): {
  router: Hono;
  report: WiringReport;
  routes: readonly MountedRoute[];
  harnessRoutes: Hono;
} {
  // `let` + a closure, so the suite's reset swaps the store under the same
  // adoption — the packaged journeys start every scenario from this seed.
  let store = seededStore();
  const host = createWiringHost({ name: 'harness-backend', kind: 'server' });
  host.adoptServer({
    manifest: featureFlagsManifest,
    server: featureFlagsServerManifest,
    bindings: {
      http: {
        mountPath: FEATURE_FLAGS_MOUNT_PATH,
        config: {
          db: () => Promise.resolve(store),
          catalog: HARNESS_FLAGS,
          directory: harnessDirectory,
        },
      },
    },
  });
  const wired = host.assemble();
  // The SUITE's reset control — under `/__harness`, deliberately NOT `/api`,
  // so nothing can mistake it for part of the package's surface.
  const harnessRoutes = new Hono().post('/reset', (c) => {
    store = seededStore();
    return c.body(null, 204);
  });
  return {
    router: honoRouterFor(wired.routes, () => OPERATOR),
    report: wired.report,
    routes: wired.routes,
    harnessRoutes,
  };
}
