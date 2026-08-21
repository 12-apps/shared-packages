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
 * ## The `db` capability, and what had to change to earn it
 *
 * This manifest used to declare none, on the reasoning that a discount's rows
 * relate to a host's own catalog: a partial literally naming `product_categories`
 * and `menu_items` only compiles inside a host that has tables under those
 * names. That half was right. The half that was not is the conclusion — the
 * shape was not a given.
 *
 * `@12-apps/entity-lifecycle` had already solved it in this repo and written
 * the answer at the top of its own partial: name the record BY VALUE. Applied
 * here, the two target join tables collapse into one `discount_targets` keyed
 * `(target_type, target_id)`, the tenant becomes a scalar `client_id`, and
 * WHICH collections are discountable becomes a runtime `DiscountableCollection`
 * registration rather than a schema fact. Nothing in the partial names a host
 * table, so `composed` qualifies on the contract's own terms.
 *
 * What stays behind is the REDEMPTION snapshot (`order_discounts`): a child of
 * the host's order, with a cascade, whose whole purpose is to freeze what a
 * buyer received on an order the host owns. Shipping the rule and leaving the
 * receipt is the clean cut.
 *
 * ## The `web` capability, and what had to move first
 *
 * This manifest also used to refuse `web`, and the refusal was right at the
 * time: the screens were three quarters product copy and host design system,
 * and a surface declared before its copy is host config is the exact
 * anti-pattern the copy-portability gate exists to refuse.
 *
 * Neither half holds now. The copy IS host config — `DiscountsWebCopy`,
 * required and defaultless, the third such port here. And what was genuinely
 * host-grown underneath the screens — the kebab, the card context, the two
 * confirm hooks, the server-grid hook, the row export — moved into
 * `@12-apps/ui` and `@12-apps/app-shell` first, which is the only reason this
 * could follow rather than dragging a private copy of an admin framework along
 * with it.
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
   *
   * `createApiDiscounts` REFUSES to build without one, which is what makes
   * that sentence a fact rather than an aspiration: for the whole of 1.0.x it
   * was neither — the binder built the logger, hung it on
   * `assembled.loggers["@12-apps/discounts"]`, and the package took nothing
   * and logged nothing. A declared capability nobody consumes is worse than an
   * undeclared one, because it reads as finished.
   */
  observability: { namespace: "discounts" },
  /**
   * `composed`, not `isolated`. The models carry no relation into host tables,
   * which is the qualification isolation asks for — but isolation costs the
   * seam, and this is the one package where that cost is unpayable: the
   * redemption counter is incremented INSIDE the host's PAID confirmation
   * transaction, and a rule whose counter cannot move in the same transaction
   * as the order that redeemed it is a rule that can be redeemed twice.
   */
  db: { partial: "prisma/discounts.prisma", migrations: "prisma/migrations" },
  server: ["http"],
  web: ["surface", "areas"],
} as const satisfies PackageManifest;
