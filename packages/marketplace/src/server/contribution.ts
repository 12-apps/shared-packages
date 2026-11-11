import type { WirePermissionsContribution } from "@12-apps/wiring";

/**
 * THIS PACKAGE'S OWN PERMISSION CONTRIBUTION.
 *
 * Two privileges, kept apart on purpose (the ADR-0117 pattern of naming the
 * act, not the role):
 *
 * - `marketplace:manage` — CONNECT a marketplace (store its credentials, turn
 *   it on, set auto-accept and the acceptance window) and MAP its SKUs to the
 *   catalog. Committing the store to a commercial relationship and teaching
 *   the engine what a SKU means are the same person's job.
 * - `marketplace:decide` — read the acceptance queue and answer it: accept or
 *   refuse an order with a reason. That is whoever is on the floor when the
 *   clock runs, and a queue only an owner could answer would lapse.
 *
 * Which roles hold either is the HOST's decision; the package only names
 * them. The shape is `@12-apps/rbac`'s `PermissionContribution`, taken from
 * the wiring contract's type-only twin. No labels: a label is a word in a
 * language, and the vocabulary a picker renders is the host's.
 */
export const MARKETPLACE_PERMISSIONS = {
  source: "@12-apps/marketplace",
  ids: ["marketplace:manage", "marketplace:decide"],
  permissions: {
    "marketplace:manage": { kind: "class" },
    "marketplace:decide": { kind: "class" },
  },
} as const satisfies WirePermissionsContribution;

/** Connect a marketplace and map its SKUs. */
export const MARKETPLACE_MANAGE = "marketplace:manage";
/** Read and answer the acceptance queue. */
export const MARKETPLACE_DECIDE = "marketplace:decide";
