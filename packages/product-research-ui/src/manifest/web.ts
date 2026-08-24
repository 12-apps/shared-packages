/**
 * `@12-apps/product-research-ui/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebResearch`, unchanged; the consumer's binder
 * builds it once per adoption, which is the memoisation rule every hand
 * wiring carries as a comment today (the factory returns component TYPES,
 * and rebuilding per render unmounts the whole surface — here it would also
 * hand the run screen a new `runChannel` identity on every render, which the
 * seam's own contract forbids because the screen uses it as a hook).
 *
 * The `areas` contribution is a SUGGESTION — the host composes, reorders,
 * relabels and vetoes at its single call site — and it carries exactly one
 * thing a package can honestly know: the route SHAPE.
 * `research/requests/:requestId` is deep-linkable on purpose, because the URL
 * IS the request id: a buyer can leave while sources answer and come back to
 * the same run. A host that re-derives that tree is one rename away from a
 * link the run screen emits and the router does not serve, which is a dead
 * end reached only by the buyers who waited.
 *
 * ## NO GATES HERE, and that is the report-builder rule rather than laziness
 *
 * The endpoints behind these screens do check permissions — `research:read`
 * and `research:write`, declared by the SIBLING `@12-apps/product-research`,
 * whose routes are marked with them. They are still not written into these
 * rows, for two reasons:
 *
 * - **They are not this package's to declare.** The ids belong to the
 *   manifest that enforces them; a second copy here is a second source of
 *   truth for one gate, and the copy is the one that goes stale.
 * - **The host is where they become real anyway.** This package depends on
 *   no RBAC — a host may run any, or none — so a host adopting both halves
 *   composes `assemble().permissions` and the area rows at the same call
 *   site, with its own mapping in front. That is the line in its diff.
 *
 * The WRITE half would be wrong as a route gate in any case: a read-only
 * actor may see history and results, and the host withholds the
 * `onRepeatRequest` callback instead — a screen-level affordance, not a
 * route. Likewise no plan-feature gate and no badge: which plan includes
 * research, and what an exception worklist counts, are host vocabulary. And
 * no labels — `testId` is the stable id a host maps to its own icon and its
 * own words.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebResearch } from '../create-web-research';

export const productResearchUiWebManifest = {
  name: '@12-apps/product-research-ui',
  surface: { create: createWebResearch },
  areas: [
    {
      area: 'admin',
      routes: [
        { path: 'research', screen: 'home' },
        { path: 'research/requests/:requestId', screen: 'run' },
      ],
      nav: [{ testId: 'research', path: 'research' }],
    },
  ],
} as const satisfies AnyWebManifest;
