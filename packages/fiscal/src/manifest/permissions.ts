/**
 * The package's permissions, declared HERE and nowhere else (the owner's
 * decision on FUT-2237): a host composes them into its RBAC catalog and
 * decides which roles hold them. The ids are mechanism; the words a picker
 * shows are the host's, so no `labels` ship.
 */

import type { WirePermissionsContribution } from "@12-apps/wiring";

/** See the fiscal settings and the documents issued. */
export const FISCAL_READ = "fiscal:read";
/** Edit the emitter profile and its certificate. */
export const FISCAL_MANAGE = "fiscal:manage";
/** Issue a fiscal document. */
export const FISCAL_ISSUE = "fiscal:issue";
/** Cancel an issued fiscal document. */
export const FISCAL_CANCEL = "fiscal:cancel";

export const FISCAL_PERMISSIONS = {
  source: "@12-apps/fiscal",
  ids: [FISCAL_READ, FISCAL_MANAGE, FISCAL_ISSUE, FISCAL_CANCEL],
  permissions: {
    [FISCAL_READ]: { kind: "class" },
    [FISCAL_MANAGE]: { kind: "class" },
    [FISCAL_ISSUE]: { kind: "class" },
    [FISCAL_CANCEL]: { kind: "class" },
  },
} as const satisfies WirePermissionsContribution;
