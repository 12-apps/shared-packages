/**
 * `@12-apps/discounts` — the discount/promotion domain, host-agnostic.
 *
 * The root entry is the ENGINE: given a priced cart, a tenant's rules and an
 * instant, decide which promotions apply, how many cents each removes, and
 * how those cents land on the individual lines. It reaches no database, no
 * clock, no framework and no locale — `now` is injected, the rules arrive
 * pre-loaded, and every user-facing sentence is host config
 * (`./rejection-copy`, with a pt-BR pack at `@12-apps/discounts/pt-BR`).
 *
 * The admin CRUD surface lives behind `@12-apps/discounts/server`, so a
 * browser bundle that only prices a cart never resolves it. The wiring
 * manifests are at `@12-apps/discounts/manifest` and `./manifest/server`.
 *
 * COMBOS (FUT-268) live here too, as a SCOPE rather than as a catalog entity:
 * a `COMBO`-scoped rule matches quantified slots against the cart's units and
 * prices the group ("1 large popcorn + 2 sodas for R$ 25", "3 burgers for the
 * price of 2"). What is NOT here — and cannot be, for the same reason the
 * database is not — is a combo as a SELLABLE product: its own menu card, its
 * own cart line, its own order snapshot. That is a host catalog entity with
 * foreign keys into host tables. The pricing RULE travels; the product does not.
 *
 * The DATABASE is deliberately NOT here, and the manifest declares no `db`
 * capability. A discount's rows relate to a host's own catalog and orders —
 * targets point at categories and items, redemptions at orders and buyers —
 * so a shipped Prisma partial would only compile inside a host that already
 * has those tables under those names. What is portable is the RULE, not the
 * storage: the host owns the schema and hands this package rows through the
 * `DiscountStore` port and the `DiscountRule` value object.
 */

export {
  COMBO_ONLY_DISCOUNT_TYPES,
  DISCOUNT_REJECTION_REASONS,
  DISCOUNT_SCOPES,
  DISCOUNT_TARGET_TYPES,
  DISCOUNT_TRIGGERS,
  DISCOUNT_TYPES,
  MAX_COMBO_SLOTS,
  MAX_COMBO_SLOT_QUANTITY,
  MAX_PERCENT_OFF_BP,
  MIN_PAYABLE_TOTAL_CENTS,
  normalizeDiscountCode,
  type DiscountRejectionReason,
  type DiscountScope,
  type DiscountTargetType,
  type DiscountTrigger,
  type DiscountType,
} from "./engine/kinds";

export type {
  AppliedDiscount,
  ComboRequirement,
  DiscountCartLine,
  DiscountEvaluation,
  DiscountEvaluationInput,
  DiscountLineAdjustment,
  DiscountRejection,
  DiscountRule,
} from "./engine/types";

export { evaluateDiscounts } from "./engine/evaluate";

export {
  previewItemDiscount,
  type ItemDiscountPreview,
  type ItemDiscountPreviewInput,
} from "./engine/preview";

/**
 * The COMBO half of the catalog surface (FUT-268). A combo has no single-item
 * price to badge, so a card advertises PARTICIPATION instead — see
 * `./engine/combo-offer.ts` for why that is the only honest thing a card can
 * say about one.
 */
export {
  comboOffersForItem,
  type ComboOffer,
  type ComboOffersInput,
} from "./engine/combo-offer";

/**
 * The combo matcher, exported because a host that wants to EXPLAIN a combo —
 * "aplicado 2x", "faltam 2 refrigerantes" — needs the same match the evaluator
 * priced, and re-deriving it host-side is how a receipt and a cart start
 * disagreeing about what was in the bundle.
 */
export {
  freshComboPool,
  matchCombo,
  type ComboMatch,
  type ComboPool,
} from "./engine/combo-match";

export {
  discountRejectionMessage,
  missingRejectionCopy,
  MIN_SUBTOTAL_TOKEN,
  type DiscountRejectionCopy,
} from "./engine/rejection-copy";

/**
 * The allocation primitives, exported because the badge preview and any host
 * that quotes a discounted price outside a cart must read the payable floor
 * from the SAME place the evaluator caps against — a second implementation is
 * how a card and a cart start quoting different numbers.
 */
export { maxDiscountableCents, rawAmountCents } from "./engine/allocate";
