/**
 * `@12-apps/entity-lifecycle/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebEntityLifecycle`, unchanged; the consumer's
 * binder builds it once per adoption (the members are component TYPES — a
 * rebuild per render unmounts the tree).
 *
 * The surface returns more than the area declares, on purpose: `page` (the
 * tabbed Lixeira + Aprovações console) is the one ROUTABLE screen, so it is
 * the one area route. `RecycleBinScreen`, `ApprovalsScreen`,
 * `VersionHistoryDialog` and `DraftBanner` are host-embedded pieces — a
 * host mounts them inside its own screens, which no route declaration can
 * express. The area is a bare suggestion, report-builder style: no
 * permission and no plan-feature gates, because those are host vocabulary.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebEntityLifecycle } from '../react/create-web-entity-lifecycle';

export const entityLifecycleWebManifest = {
  name: '@12-apps/entity-lifecycle',
  surface: { create: createWebEntityLifecycle },
  areas: [
    {
      area: 'admin',
      routes: [{ path: 'lifecycle/*', screen: 'page' }],
      nav: [{ testId: 'lifecycle', path: 'lifecycle/*' }],
    },
  ],
} as const satisfies AnyWebManifest;
