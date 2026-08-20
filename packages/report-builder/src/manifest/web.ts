/**
 * `@12-apps/report-builder/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebReportBuilder`, unchanged; the consumer's
 * binder builds it once per adoption, which is the memoisation rule every
 * hand wiring carries as a comment today (the factory returns a component
 * TYPE — rebuilding per render unmounts the whole surface).
 *
 * The area contribution is a SUGGESTION, and deliberately a bare one: the
 * whole reports area is one splat route (the package owns its internal route
 * table, including the `new`-before-`:id` ordering every host used to
 * rediscover), and one nav anchor. No permission and no plan-feature gates
 * here — those are host vocabulary, and a package that guessed at them would
 * be wrong for every host but the first. A plain `satisfies`-checked value —
 * see `./index` for why the contract package stays a type-only
 * devDependency.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebReportBuilder } from '../react/create-report-builder';

export const reportBuilderWebManifest = {
  name: '@12-apps/report-builder',
  surface: { create: createWebReportBuilder },
  areas: [
    {
      area: 'admin',
      routes: [{ path: 'reports/*', screen: 'page' }],
      nav: [{ testId: 'reports', path: 'reports/*' }],
    },
  ],
} as const satisfies AnyWebManifest;
