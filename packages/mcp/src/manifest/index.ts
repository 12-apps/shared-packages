/**
 * `@12-apps/mcp/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution (the three tables behind the
 * authorization server) and the runtime inventory: `http` on the server.
 *
 * ON THE `db` DECLARATION — the reason this manifest exists at all.
 *
 * This package ships `prisma/mcp.prisma` and a migration beside it, and until
 * now nothing said so in a form a host assembler could read. The origin
 * host's assembler discovers partials in two steps: a package that carries
 * `"wiring": { "db": ... }` in its package.json is taken at its word, and a
 * package that carries nothing falls back to a STRUCTURAL scan — every
 * `prisma/*.prisma` under the package root is treated as a partial. So three
 * tables reach somebody's database because a `readdir` found them, not
 * because this package said they should. `@12-apps/notifications`' manifest
 * closed exactly this gap for its four models and the anti-pattern audit
 * names it directly; declaring changes no assembler behaviour (the
 * declaration is read where the scan used to run) and closes the one case
 * where composition was happening by accident.
 *
 * The mirror is what makes the declaration reachable: host assemblers are
 * plain Node reading `node_modules` and cannot execute this TypeScript, so
 * the contribution is repeated under `package.json` `"wiring": { "db": … }`
 * and `assertDbMirror` pins the two together in this package's own test run.
 *
 * `composed`, not `isolated`, and the choice is forced. An isolated stack
 * needs models carrying no relation into host tables — true of the three
 * here as SHIPPED (`user_id` and `user_email` are deliberately by-value
 * scalars, see the partial's header) — but the host is invited to add the FK
 * in its own migration, and the origin host's is `ON DELETE CASCADE`. A
 * package cannot declare isolation for models whose adopters relate them
 * into their own account tables.
 *
 * ## THE NARROWINGS, each deliberate
 *
 * - **No `mcp` capability.** This package IS the MCP runtime — the
 *   OpenAPI→tools generator, the registry, the JSON-RPC transport, the
 *   coverage gate. It advertises no tools of its own, and a manifest that
 *   declared any would be the runtime describing itself to itself.
 * - **No `permissions`.** Authorization here is the OAuth scope set
 *   (`MCP_SUPPORTED_SCOPES`) plus whatever the host's own RBAC says about
 *   the proxied endpoint — the point of bearer passthrough is that an agent
 *   inherits the caller's permissions rather than holding its own. There is
 *   no id for this package to contribute.
 * - **No `web` inventory**, though `./react` ships the whole AI-connect
 *   onboarding flow. A `surface` contribution is a `createWeb*` FACTORY —
 *   one config object in, an object of component types out, memoised once by
 *   the binder. `./react` has no such factory: it exports components a host
 *   mounts with its own props (`AiIntegrationOnboarding` takes the store,
 *   the endpoint URL and the live connection at the call site). Inventing a
 *   factory here to have something to declare would freeze a props table
 *   three hosts pass differently, which is the opposite of what a surface
 *   contribution is for. When the flow grows a real bound surface, the
 *   inventory grows with it.
 * - **No `env`.** The signing-key variables (`DEFAULT_SIGNING_KEY_ENV`,
 *   `DEFAULT_SIGNING_KEY_ID_ENV`) and `trustedOriginsFromEnv` are NAMES this
 *   package exports for a host to read `process.env` with; the package reads
 *   nothing itself, and the names are overridable per call. Declaring them
 *   would oblige a host to answer for variables it may legitimately have
 *   spelled differently.
 * - **No `e2e`.** This package packages no journeys.
 * - **No `jobs`.** Nothing here sweeps: authorization codes are stateless
 *   signed blobs (the partial's header says so — there is no `oauth_codes`
 *   table and nothing to expire), and refresh-token revocation happens on
 *   the rotation path rather than on a clock.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const mcpManifest = {
  name: "@12-apps/mcp",
  contract: 1,
  db: { partial: "prisma/mcp.prisma", migrations: "prisma/migrations" },
  /**
   * A refused token grant, an unresolvable signing key or a rejected
   * redirect URI files under `mcp` rather than under whichever host mounted
   * the authorization server. Mandatory for runtime manifests since wiring
   * 1.3.0, and this is the surface that most needs it: every failure here is
   * a caller who cannot connect, reported to them as an opaque OAuth error
   * code by specification.
   */
  observability: { namespace: "mcp" },
  server: ["http"],
} as const satisfies PackageManifest;
