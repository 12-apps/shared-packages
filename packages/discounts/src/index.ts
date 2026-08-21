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
 * The DATABASE is deliberately NOT here, and the manifest declares no `db`
 * capability. A discount's rows relate to a host's own catalog and orders —
 * targets point at categories and items, redemptions at orders and buyers —
 * so a shipped Prisma partial would only compile inside a host that already
 * has those tables under those names. What is portable is the RULE, not the
 * storage: the host owns the schema and hands this package rows through the
 * `DiscountStore` port and the `DiscountRule` value object.
 */

export {
  DISCOUNT_REJECTION_REASONS,
  DISCOUNT_SCOPES,
  DISCOUNT_TRIGGERS,
  DISCOUNT_TYPES,
  MAX_PERCENT_OFF_BP,
  MIN_PAYABLE_TOTAL_CENTS,
  normalizeDiscountCode,
  type DiscountRejectionReason,
  type DiscountScope,
  type DiscountTrigger,
  type DiscountType,
} from "./engine/kinds";

export type {
  AppliedDiscount,
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
