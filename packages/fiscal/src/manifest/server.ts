/**
 * `@12-apps/fiscal/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiFiscal` (`../http`): profile, certificate upload,
 * issuing points, issue, cancel, look up and the DANFE, each route declaring
 * the package permission it needs. `jobs` is `FISCAL_JOBS` (`../jobs`): the
 * retry sweep, the contingency transmission and the certificate-expiry
 * warning. A host binds both or declines each in writing.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiFiscal } from "../http";
import { FISCAL_JOBS } from "../jobs";

export const fiscalServerManifest = {
  name: "@12-apps/fiscal",
  http: { create: createApiFiscal },
  jobs: FISCAL_JOBS,
} as const satisfies AnyServerManifest;
