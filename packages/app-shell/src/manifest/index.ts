/**
 * `@12-apps/app-shell/manifest` — the SHARED wiring manifest.
 *
 * Identity, the observability namespace and one runtime inventory entry:
 * `http` on the server. That is the whole of it, and the narrowness is the
 * point — this package is mostly a BROWSER shell, and its backend half is the
 * consent status/accept pair and nothing else.
 *
 * ## THE `web` HALF IS DELIBERATELY ABSENT
 *
 * `createWebAppShell` is a `createWeb*` factory and would satisfy
 * `WebSurfaceContribution` structurally — so leaving it undeclared is a
 * decision rather than an omission. It is not a CONTRIBUTION: a web surface
 * contribution is a package handing a host screens to place inside the
 * host's shell, and this factory IS the shell those screens are placed in.
 * The consumer's own model says the same thing from the other side — a
 * bound surface is memoised per adoption and mounted at a route, while
 * `createWebAppShell` builds the theme, the session provider, the error
 * boundary and the chunk-recovery that everything else (including other
 * packages' surfaces) then lives inside. Declaring it would invite a host to
 * adopt the anchor as though it were cargo, and `areas` would have to name
 * an area the shell itself defines.
 *
 * So the adaptation report's `n/a (IS the shell)` is recorded here as data:
 * no `web` inventory, and the three SPAs keep calling `createWebAppShell`
 * directly at their root.
 *
 * ## THE OTHER NARROWINGS
 *
 * - **No `db`.** This package owns no Prisma model on purpose (ADOPTING.md
 *   says why): consent state lives on the HOST's identity row, reached
 *   through the `isCurrent` / `record` seams, because a package cannot
 *   declare a relation into a user table it does not own. The seam is the
 *   contribution; there is no partial to compose.
 * - **No `permissions`.** Both endpoints are `public` — consent precedes
 *   having an account — so there is no id to contribute.
 * - **No `mcp`.** A host may well expose "am I overdue for the terms?" as a
 *   tool, but the tool's summary and its noun are that product's words; the
 *   package declares the endpoint and lets the host author the tool.
 * - **No `env`, no `e2e`, no `jobs`, no `email`.** Nothing here reads
 *   `process.env` (the signing secret arrives as `cookie.sign`), ships
 *   journeys, sweeps on a clock or sends mail.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const appShellManifest = {
  name: '@12-apps/app-shell',
  contract: 1,
  /**
   * Mandatory for runtime manifests since wiring 1.3.0, and this surface has
   * the history that makes it worth stating: for a day one adopter answered
   * the 500 this package deliberately returns over a failed acceptance and
   * logged NOTHING, because moving the routes off a wrapper took the
   * catch-all with it. `onUnexpectedError` stays the seam a host wires by
   * hand; the namespace is what a wiring host files it under without being
   * asked.
   */
  observability: { namespace: 'app-shell' },
  server: ['http'],
} as const satisfies PackageManifest;
