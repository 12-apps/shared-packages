import type { PackageManifest } from "@12-apps/wiring";

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
 *
 * ## Why `@12-apps/wiring` is a TYPE-ONLY devDependency here
 *
 * This file used to `import { defineManifest } from '@12-apps/wiring/producer'`
 * and call it, with `@12-apps/wiring` in `dependencies` as `workspace:*` — which
 * publishes as a pinned RUNTIME dependency. That made the contract package
 * something every auth installer downloads and, worse, put auth's release behind
 * wiring's: a package cannot ship a fix until the contract it merely describes
 * itself with has shipped first. Auth is the estate's most-installed package, so
 * it was the worst possible place for that edge.
 *
 * The report-builder move fixes it without losing a single check. The manifests
 * are plain values `satisfies`-checked against the contract's TYPES, and the
 * producer factories' RUNTIME assertions — identity, contribution validation,
 * and the inventory drift check in both directions — run in this package's own
 * test suite (`__tests__/manifest.test.ts`). Same "a malformed manifest fails in
 * the package's own test run, before any host sees it" guarantee; zero runtime
 * dependencies added; a host that never adopts the contract never installs it.
 */

/** The sign-in surface, and the owner of every auth table. */
export const authManifest = {
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
  /**
   * Every literal `process.env` key this package reads (`build-config.ts` and
   * the handlers), so a host can see its whole environment surface without
   * reading the source, and deploy tooling can union `.env.example` from the
   * mirrors. Two classes stay deliberately UNDECLARED because they are not
   * this package's names to state: the mailer reads keys the HOST chooses
   * (`AuthMailerEnvNames`), and `coreSetEnvDefaults` hands the whole
   * environment to Auth.js core, which honours further `AUTH_*` keys of its
   * own. `NODE_ENV` is platform vocabulary, not a contribution.
   */
  env: [
    { name: "AUTH_SECRET", required: true, secret: true, description: "Signs sessions and tokens; the runtime refuses to start without it." },
    { name: "AUTH_URL", description: "Public origin of the sign-in surface; defaults to the mount path." },
    { name: "AUTH_TRUST_HOST", description: "\"true\" to trust the reverse proxy's Host header." },
    { name: "AUTH_DEBUG", description: "Verbose Auth.js logging; keep off in production." },
    { name: "GOOGLE_CLIENT_ID", description: "Google OAuth app; the provider is offered only when both halves are set." },
    { name: "GOOGLE_CLIENT_SECRET", secret: true, description: "Second half of the Google OAuth app." },
    { name: "FACEBOOK_CLIENT_ID", description: "Facebook OAuth app; offered only when both halves are set." },
    { name: "FACEBOOK_CLIENT_SECRET", secret: true, description: "Second half of the Facebook OAuth app." },
    { name: "APPLE_CLIENT_ID", description: "Apple OAuth app; offered only when both halves are set." },
    { name: "APPLE_CLIENT_SECRET", secret: true, description: "Second half of the Apple OAuth app." },
    { name: "ADMIN_EMAILS", description: "Comma-separated superadmin allowlist; empty denies everyone." },
    { name: "OAUTH_MOCK_ISSUER", description: "Points the Google provider at the e2e mock OpenID issuer; tests only." },
    { name: "SKIP_ENV_VALIDATION", description: "Skips the env schema — build steps that never serve a request." },
  ],
  server: ["http", "email"],
  web: ["surface", "areas"],
} as const satisfies PackageManifest;

/** The operator console: the two platform switches. */
export const authPlatformManifest = {
  name: "@12-apps/auth-platform",
  contract: 1,
  observability: { namespace: "auth-platform" },
  server: ["http"],
  web: ["surface", "areas"],
} as const satisfies PackageManifest;
