/**
 * `@12-apps/billing/manifest` — the SHARED wiring manifest.
 *
 * Identity, the observability namespace and the runtime inventory. Four
 * absences are deliberate, and each is worth stating because a host reading
 * this manifest is entitled to conclude that what is not here is not shipped:
 *
 * - **No `db` contribution.** Subscriptions, their cycles and their stored
 *   instruments all carry foreign keys into the host's own account table.
 *   A package partial cannot declare a relation into a table it does not own,
 *   so the schema stays the host's and reaches this package through the
 *   `./server` ports instead. That is the graduation rule working as intended:
 *   a model set graduates into a package when it has lost every foreign key
 *   into host tables, and this one has not.
 * - **No `permissions` contribution.** Who may put a card on file is a role
 *   decision — in the origin host an owner, not merely an administrator,
 *   because a subscription card is a standing financial commitment against
 *   whoever signed up. That is not a permission id this package could name
 *   for every host; the host guards the mount.
 * - **No `notifications` contribution.** The one notice this domain sends —
 *   we could not charge your card — is entirely host copy and host recipient
 *   policy. A blueprint here would be a sentence with no words in it.
 * - **No `mcp` contribution.** The surface writes a payment instrument. That
 *   stays in a browser, behind a human, by the same policy that keeps other
 *   money writes off the agent surface.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency: the manifests are plain
 * `satisfies`-checked values, and the producer factories' runtime assertions
 * run in this package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const billingManifest = {
  name: "@12-apps/billing",
  contract: 1,
  /**
   * Mandatory for runtime manifests since wiring 1.3.0. The money path is the
   * one place where "it failed and filed nowhere" is unaffordable, so the
   * binder hands this package a logger already scoped to `billing`.
   */
  observability: { namespace: "billing" },
  server: ["http"],
} as const satisfies PackageManifest;
