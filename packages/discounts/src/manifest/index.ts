/**
 * `@12-apps/discounts/manifest` — the SHARED wiring manifest.
 *
 * Data every runtime can hold: identity, the permission contribution, the MCP
 * tools, and the INVENTORY of the runtime manifest (`./manifest/server`). A
 * host adopts this through `@12-apps/wiring/consumer`, and the inventory is
 * what makes an unanswered capability a red `assemble()` instead of a silent
 * gap.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency here, on purpose: the
 * manifests are plain values `satisfies`-checked against the contract, and the
 * producer factories' assertions run in this package's own test suite
 * (`__tests__/manifest.test.ts`) — the same "fails in the package's own test
 * run" guarantee with zero runtime dependencies added.
 *
 * ## Two capabilities this package deliberately does NOT declare
 *
 * **`db`.** A discount's rows relate to a host's own catalog and orders:
 * targets point at its categories and items, redemptions at its orders and
 * buyers. A `composed` partial may in principle relate to host models, but one
 * shipped from here would only compile inside a host that already has those
 * tables under those names — and `isolated` is ruled out by the same
 * relations, which is exactly the qualification the wiring db contract states
 * ("a package qualifies only when its models carry no relation into host
 * tables"). What is portable is the RULE, not the storage: the host owns the
 * schema and answers `DiscountStore`.
 *
 * **`web`.** The admin grid, the form and the target pickers stay host
 * surfaces for now. They are three quarters product copy and host design
 * system, and a surface declared before its copy is host config is the exact
 * anti-pattern the copy-portability gate exists to refuse. The permission ids
 * and the tool schemas are enough for a host to build them against.
 */

import type { PackageManifest } from "@12-apps/wiring";

import { DISCOUNTS_PERMISSIONS } from "../server/contribution";
import { DISCOUNTS_MCP_TOOLS } from "../server/mcp";

export const discountsManifest = {
  name: "@12-apps/discounts",
  contract: 1,
  permissions: DISCOUNTS_PERMISSIONS,
  mcp: { endpoints: DISCOUNTS_MCP_TOOLS },
  /**
   * The server half logs through the binder's namespaced logger, so a
   * discounts failure files under `discounts` rather than under the host app
   * or nowhere.
   */
  observability: { namespace: "discounts" },
  server: ["http"],
} as const satisfies PackageManifest;
