import { defineManifest } from "@12-apps/wiring/producer";

/**
 * `@12-apps/auth`'s producer half of the wiring contract.
 *
 * The shared manifest is data every runtime can hold — no factories, no React,
 * no Hono — and it INVENTORIES the two runtime manifests beside it. That
 * inventory is the integrity mechanism: the producer refuses a runtime manifest
 * that drifts from it, and a host that adopts one without answering an
 * inventoried capability gets a red `assemble()` naming this package and the
 * capability. A version that adds an endpoint therefore cannot arrive silently.
 *
 * ## Why there are TWO manifests
 *
 * An `http` capability binds ONE mount path, and this package has two surfaces
 * that cannot share one:
 *
 * - the **sign-in** surface, mounted where the packaged browser client points,
 *   reachable by anybody;
 * - the **platform** surface, the two switches a superadmin owns, mounted at a
 *   path the host gates for its operators.
 *
 * They differ in audience, in mount path, in the gate in front of them, and in
 * the origin host they also differ in MCP exposure — the platform pair is off
 * the tool surface by exclusion, because a tool that could turn verification
 * off would open unverified registration on the whole platform in one call.
 * Two manifests is what the contract calls that; folding them into one would
 * mean the aggregate could not express the difference.
 *
 * The manifest NAME is a wiring identity, not an npm package name — the
 * consumer keys adoption and the report on it, so it only has to be unique and
 * legible in `report`.
 */

/** The sign-in surface, and the owner of every auth table. */
export const authManifest = defineManifest({
  name: "@12-apps/auth",
  contract: 1,
  // Declared HERE and not on the platform manifest: one package owns the
  // schema, including the settings rows the other surface writes.
  db: { partial: "prisma/auth.prisma", migrations: "prisma/migrations" },
  /**
   * The world is DECLARED, not just shipped: a host adopting this manifest
   * must bind `defineAuthWorld` with its featuresRoot or decline in writing.
   * The first host adoption re-derived the whole mail-sink world by hand
   * without discovering `./e2e` existed — this line is what makes that
   * impossible to repeat.
   */
  e2e: { entry: "@12-apps/auth/e2e", world: { factory: "defineAuthWorld" } },
  /** Mandatory for runtime manifests (wiring 1.3.0): sign-in failures file under `auth`, not nowhere. */
  observability: { namespace: "auth" },
  server: ["http", "email"],
  web: ["surface", "areas"],
});

/** The operator console: the two platform switches. */
export const authPlatformManifest = defineManifest({
  name: "@12-apps/auth-platform",
  contract: 1,
  observability: { namespace: "auth-platform" },
  server: ["http"],
  web: ["surface", "areas"],
});
