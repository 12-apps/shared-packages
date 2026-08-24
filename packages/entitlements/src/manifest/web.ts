/**
 * `@12-apps/entitlements/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebEntitlements`, unchanged: the plan screen, the
 * upsell host every locked trigger lands on, and the `withEntitlement` page
 * gate. Built once per adoption by the consumer's binder — `UpsellHost` is
 * mounted once in the layout and rebuilding it per render would drop the
 * prompt mid-upgrade.
 *
 * ## Why this manifest exists now
 *
 * The shared manifest narrowed `web` away claiming that listing it would
 * oblige every SERVER host to answer for a React surface it never mounts. It
 * does not: a capability declared for the OTHER runtime is reported
 * `out-of-scope`, and only an applicable, unanswered one is `unbound`. The
 * narrowing protected nothing and made the plan screens undeclarable to any
 * web host.
 *
 * ## The area
 *
 * One admin route for the plan screen, and no permission gate on it — which is
 * deliberate and is this package's own semantics rather than an omission. The
 * plan page is where a tenant goes to SEE what it is missing and ask for more;
 * gating it behind a permission would hide the upgrade path from exactly the
 * people who cannot currently reach the thing they want. Who may actually
 * REQUEST a change is a separate decision the host already answers, by name,
 * through `canRequestPlanChange` on the web config.
 *
 * No `feature` gate either, for the same reason at one remove: a plan screen
 * behind a plan feature is a lock with its own key inside.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebEntitlements } from '../react/create-web-entitlements';

export const entitlementsWebManifest = {
  name: '@12-apps/entitlements',
  surface: { create: createWebEntitlements },
  areas: [
    {
      area: 'admin',
      routes: [{ path: 'plan', screen: 'page' }],
      nav: [{ testId: 'entitlements-plan', path: 'plan' }],
    },
  ],
} as const satisfies AnyWebManifest;
