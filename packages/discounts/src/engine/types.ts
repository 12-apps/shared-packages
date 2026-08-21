import type {
  DiscountRejectionReason,
  DiscountScope,
  DiscountTrigger,
  DiscountType,
} from "./kinds";

/**
 * The evaluator's type contract (FUT-245). Types only, no logic — the shape
 * `./evaluate.ts` and whatever loads a host's rows agree on.
 */

/**
 * One discount as the evaluator sees it: a plain value object with every
 * stored and every counted fact already resolved. The evaluator never touches
 * a database and never reads the clock — the host's loader builds these from
 * its own rows, and `now` is injected.
 */
export interface DiscountRule {
  id: string;
  name: string;
  type: DiscountType;
  /** 1..10000 basis points. Non-null iff `type === "PERCENTAGE"`. */
  percentOffBp: number | null;
  /** Cents off, > 0. Non-null iff `type === "FIXED_AMOUNT"`. */
  amountOffCents: number | null;
  scope: DiscountScope;
  /** Target category ids. Non-empty iff `scope === "CATEGORY"`. */
  targetCategoryIds: readonly string[];
  /** Target menu-item ids. Non-empty iff `scope === "ITEM"`. */
  targetMenuItemIds: readonly string[];
  trigger: DiscountTrigger;
  /** Normalized (trimmed, upper-cased) code. Non-null iff `trigger === "CODE"`. */
  code: string | null;
  active: boolean;
  /** Inclusive lower bound of the active window; null = already open. */
  startsAt: Date | null;
  /** EXCLUSIVE upper bound of the active window; null = never closes. */
  endsAt: Date | null;
  /** Minimum PRE-discount subtotal in cents; null = no threshold. */
  minSubtotalCents: number | null;
  /** Global redemption cap; null = uncapped. */
  usageLimit: number | null;
  /** Redemptions already counted globally. */
  usageCount: number;
  /** Per-buyer redemption cap; null = uncapped. */
  perBuyerLimit: number | null;
  /** Redemptions this buyer has already PAID for. 0 for an anonymous cart. */
  buyerUsageCount: number;
  /** False ⇒ exclusive: if it wins, nothing else applies. */
  stackable: boolean;
  /** Deterministic tie-break key, ascending. */
  createdAt: Date;
}

/**
 * One cart line, priced exactly as the host prices it: `unitPriceCents`
 * already includes the chosen variation and every paid extra, so the
 * evaluator never re-derives money.
 */
export interface DiscountCartLine {
  /** Cart-line id (or order-line index) — the allocation key. */
  lineId: string;
  /** The BASE (grouping) menu-item id — the card the admin picked as a target. */
  menuItemId: string;
  /** The chosen variation's menu-item id, when the line has one. */
  variationMenuItemId: string | null;
  /**
   * The line's own category id followed by its ancestors, nearest first, so a
   * discount on a top-level category also covers its subcategories' items.
   * Empty for an uncategorized item.
   */
  categoryPath: readonly string[];
  quantity: number;
  /** Composed unit price in integer cents. */
  unitPriceCents: number;
}

export interface DiscountEvaluationInput {
  lines: readonly DiscountCartLine[];
  /** Every non-archived discount of the tenant; the evaluator screens them. */
  rules: readonly DiscountRule[];
  /** Raw code as the buyer typed it, or null. Normalized internally. */
  couponCode: string | null;
  /** Evaluation instant. Injected — the evaluator never calls `new Date()`. */
  now: Date;
}

/** Why a discount the buyer asked for was not applied. */
export interface DiscountRejection {
  /** Null only for `UNKNOWN_CODE`, where no rule matched. */
  discountId: string | null;
  /** The code involved, when the rejection concerns one. */
  code: string | null;
  reason: DiscountRejectionReason;
  /** Present on `MIN_SUBTOTAL_NOT_MET`: the threshold, in cents. */
  minSubtotalCents?: number;
  /** Present on `NOT_STACKABLE`: the discount that displaced this one. */
  supersededByDiscountId?: string;
}

/** A discount that actually removed money, frozen for the order snapshot. */
export interface AppliedDiscount {
  discountId: string;
  name: string;
  code: string | null;
  type: DiscountType;
  scope: DiscountScope;
  percentOffBp: number | null;
  amountOffCents: number | null;
  /** Cents removed from the order by THIS discount. Always > 0. */
  amountCents: number;
}

/** Per-line outcome. `Σ discountCents` equals the order's `discountTotalCents`. */
export interface DiscountLineAdjustment {
  lineId: string;
  /** `unitPriceCents * quantity`, before any discount. */
  lineGrossCents: number;
  /** Cents removed from this line across every applied discount. */
  discountCents: number;
  /** `lineGrossCents - discountCents`. Never negative. */
  lineNetCents: number;
}

export interface DiscountEvaluation {
  /** Σ lineGrossCents. */
  subtotalCents: number;
  /**
   * Σ applied[].amountCents, bounded by R9's payable floor:
   * `0 <= discountTotalCents <= max(0, subtotalCents - MIN_PAYABLE_TOTAL_CENTS)`.
   */
  discountTotalCents: number;
  /**
   * `subtotalCents - discountTotalCents`. Never negative, never above
   * `subtotalCents`, and — whenever anything was discounted at all — never below
   * `MIN_PAYABLE_TOTAL_CENTS`, because the provider cannot be asked to raise a
   * R$ 0,00 charge. See the R9 block in `./evaluate.ts`: this deliberately
   * departs from the FUT-235 spec, which called for landing on exactly zero.
   */
  totalCents: number;
  applied: readonly AppliedDiscount[];
  /** One entry per input line, in input order. */
  lines: readonly DiscountLineAdjustment[];
  /** Only for discounts the buyer explicitly invoked or that lost a stack race. */
  rejections: readonly DiscountRejection[];
}
