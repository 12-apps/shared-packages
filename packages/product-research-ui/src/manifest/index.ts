/**
 * `@12-apps/product-research-ui/manifest` — the SHARED wiring manifest.
 *
 * Identity, the observability namespace, and one runtime inventory: the web
 * half. This package is screens and nothing else — no routes, no models, no
 * jobs — so the manifest is correspondingly small, and every absence below
 * is a sentence rather than an oversight.
 *
 * ## WHAT IT DECLARES
 *
 * `surface` (the two research screens, bound to one port) and `areas` (where
 * a host is invited to put them). Both are in `./manifest/web`.
 *
 * ## THE NARROWINGS
 *
 * - **No `http`, `jobs`, `db` or `mcp`.** All four belong to the SIBLING
 *   `@12-apps/product-research`, which declares them in its own manifest. A
 *   UI package that restated them would be two manifests claiming one
 *   surface, and `assemble()` would refuse the second — correctly.
 * - **No `permissions`.** `research:read` / `research:write` are declared by
 *   the sibling whose routes CHECK them. This manifest references those ids
 *   in its area gates (imported, never retyped) so a host projecting nav
 *   from the aggregate gates the rows the same way the endpoints do — but
 *   the ids stay owned one package over, where the enforcement is.
 * - **No `env`, no `e2e`.** Nothing here reads `process.env`, and the
 *   journeys that drive these screens are the adopting host's.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const productResearchUiManifest = {
  name: '@12-apps/product-research-ui',
  contract: 1,
  /**
   * Mandatory for runtime manifests since wiring 1.3.0. The same namespace
   * the sibling engine files under, deliberately: a buyer's failed research
   * is ONE incident whichever half raised it, and splitting the browser and
   * server halves across two namespaces is what makes a screen error and
   * the run it came from look unrelated in the issue list.
   */
  observability: { namespace: 'product-research' },
  web: ['surface', 'areas'],
} as const satisfies PackageManifest;
