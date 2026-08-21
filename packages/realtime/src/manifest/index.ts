/**
 * `@12-apps/realtime/manifest` — the SHARED wiring manifest.
 *
 * A pure-data manifest: identity plus the env surface, nothing else — hosts
 * mount this package directly today, so no runtime inventory is declared
 * (see `@12-apps/jobs/manifest` for the same call and its rationale).
 *
 * The `scope` split carries the package's own posture: the API half degrades
 * when a key is unset (no ticket secret means no WS transport, logged), so
 * its vars are `server`-scoped and optional; the GATEWAY is a dedicated
 * process that refuses to boot without a ticket secret, so its vars ride the
 * `worker` scope. `REALTIME_TICKET_SECRET` appears once and stays optional
 * here because one declaration cannot carry both postures — the gateway
 * enforces its own requirement at boot, which is stricter than any
 * assemble-time check. `AUTH_SECRET` is declared by `@12-apps/auth`; this
 * package only falls back to it, so re-declaring it would double the union.
 * `NODE_ENV` is platform vocabulary, not a contribution.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const realtimeManifest = {
  name: "@12-apps/realtime",
  contract: 1,
  env: [
    { name: "REALTIME_TICKET_SECRET", secret: true, description: "Signs WS tickets; falls back to AUTH_SECRET, and without either the API serves no WS transport while the gateway refuses to boot." },
    { name: "REALTIME_DRIVER", description: "redis | off; unset picks by REDIS_URL and NODE_ENV, invalid values disable realtime with an error log." },
    { name: "REDIS_URL", description: "The fan-out bus; REALTIME_DRIVER=redis without it disables realtime with an error log." },
    { name: "REALTIME_TENANT_CONNECTION_CAP", description: "Max concurrent sockets per tenant; default 20." },
    { name: "REALTIME_GATEWAY_PORT", scope: "worker", description: "The gateway process's listen port; default 3100, malformed values throw at boot." },
    { name: "REALTIME_GATEWAY_MAX_CONNECTIONS", scope: "worker", description: "The gateway process's global socket cap; malformed values throw at boot." },
  ],
} as const satisfies PackageManifest;
