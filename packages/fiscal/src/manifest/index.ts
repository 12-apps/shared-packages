/**
 * `@12-apps/fiscal/manifest` — the SHARED wiring manifest, a SKELETON.
 *
 * What it declares today is what exists today:
 *
 * - `permissions` — `fiscal:read`, `fiscal:manage`, `fiscal:issue`,
 *   `fiscal:cancel`: data, valid with no route or table behind them yet, and
 *   declared now so a host composes the catalog once.
 *
 * The first module, `./engine`, is a pure function a host calls; it has
 * nothing to wire. The document module (FUT-2237) adds, in this manifest:
 * `db` (the emitter profile, the fiscal document and its events, a number
 * counter per issuing point and series), `server: ["http", "jobs"]` (profile,
 * certificate upload, issue, cancel, look up; retry, contingency
 * transmission, certificate-expiry warning), `notifications` (certificate
 * expiring, document rejected) and `web: ["surface"]` (the fiscal settings
 * screen and the documents list), with `observability: { namespace: "fiscal" }`
 * once there is running code to log — declaring it now would only make every
 * host bind a logger for a pure function that throws and never logs. Until then `.wiring-conformance.json`
 * answers each of those with its reason.
 *
 * `@12-apps/wiring` is a TYPE-ONLY dependency: the manifest is a plain
 * `satisfies`-checked value, and the producer's assertions run in this
 * package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

import { FISCAL_PERMISSIONS } from "./permissions";

export { FISCAL_CANCEL, FISCAL_ISSUE, FISCAL_MANAGE, FISCAL_PERMISSIONS, FISCAL_READ } from "./permissions";

export const fiscalManifest = {
  name: "@12-apps/fiscal",
  contract: 1,
  permissions: FISCAL_PERMISSIONS,
} as const satisfies PackageManifest;
