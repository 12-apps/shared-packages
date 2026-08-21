import type { WirePermissionsContribution } from "@12-apps/wiring";

/**
 * THIS PACKAGE'S OWN PERMISSION CONTRIBUTION.
 *
 * The discounts surface decides two privileges, so it declares them rather
 * than leaving each host to spell them: seeing which promotions are running,
 * and changing what the store charges. They are SEPARATE on purpose (FUT-235)
 * — "show me the promos" is a reasonable thing to grant a floor manager, and
 * it is not the same act as repricing the menu — and neither is folded into a
 * catalog permission, because a discount is not catalog content.
 *
 * There is deliberately no `discounts:approve`. A discount is a pricing rule
 * carrying a LIVE redemption counter, not versioned content: restoring
 * "version 3" of a coupon whose `usageCount` has since moved is meaningless,
 * so there is no approval branch and therefore no author-cannot-approve pair
 * to declare.
 *
 * The shape is `@12-apps/rbac`'s `PermissionContribution`, taken from the
 * wiring contract's type-only twin rather than by depending on rbac: a host
 * may run any RBAC, or none, and the contribution is plain data, so
 * `composePermissions(DISCOUNTS_PERMISSIONS, …)` accepts it structurally.
 *
 * The LABELS are absent, and that is the same rule as the copy ports: a label
 * is a word in a language, and the segment vocabularies a host composes are
 * its own. A host that shows a permission picker supplies them there.
 */
export const DISCOUNTS_PERMISSIONS = {
  source: "@12-apps/discounts",
  ids: ["discounts:read", "discounts:write"],
  permissions: {
    /** See the promotions list and read one — RBAC alone decides. */
    "discounts:read": { kind: "class" },
    /** Create, re-state or end a promotion — the repricing privilege. */
    "discounts:write": { kind: "class" },
  },
} as const satisfies WirePermissionsContribution;

/** The read privilege's id, so a host maps a token rather than a string. */
export const DISCOUNTS_READ = "discounts:read";
/** The write privilege's id. */
export const DISCOUNTS_WRITE = "discounts:write";
