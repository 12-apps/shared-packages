import type {
  DiscountRejectionReason,
  DiscountScope,
  DiscountTrigger,
  DiscountType,
} from "./kinds";
import type { DiscountSchedule, LocalClock } from "./schedule";

/**
 * The evaluator's type contract (FUT-245). Types only, no logic — the shape
 * `./evaluate.ts` and whatever loads a host's rows agree on.
 */

/**
 * One SLOT of a combo: what may fill it, and how many units it needs for ONE
 * application of the combo.
 *
 * "1 large popcorn + 2 sodas" is two slots — `{ menuItemIds: ["popcorn-lg"],
 * quantity: 1 }` and `{ categoryIds: ["sodas"], quantity: 2 }`. "3 burgers for
 * the price of 2" is ONE slot of quantity 3, whose rule carries
 * `type: "FREE_UNITS"`, `freeUnits: 1`.
 *
 * A slot is satisfied from either list — an item id OR a category — because a
 * merchant thinks in both at once ("a soda" is a category, "the large popcorn"
 * is an item). At least one of the two must be non-empty; a slot naming
 * neither can never be filled, and `toDiscountScalars` refuses it rather than
 * storing a combo that silently never fires.
 */
export interface ComboRequirement {
  /**
   * Menu-item ids that fill this slot, matched against a line's BASE item OR
   * its chosen variation — the same reach an `ITEM`-scoped discount has, so
   * "a Coke" still fills the slot when the buyer picked "Coke zero can".
   */
  menuItemIds: readonly string[];
  /**
   * Category ids that fill this slot, matched against a line's category PATH,
   * so a slot naming a top-level category is filled by its subcategories' items
   * — the same reach a `CATEGORY`-scoped discount has.
   */
  categoryIds: readonly string[];
  /** Units this slot needs per application. An integer >= 1. */
  quantity: number;
}

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
  /**
   * What the matched combo group costs, in cents. Non-null iff
   * `type === "BUNDLE_PRICE"`. The discount is the group's gross value minus
   * this, per application.
   */
  bundlePriceCents?: number | null;
  /**
   * How many units of the matched group are free. Non-null iff
   * `type === "FREE_UNITS"`. The CHEAPEST units of each application are the
   * free ones, which is the buyer-favourable reading of "3 for the price of 2"
   * and the one every merchant means by it.
   */
  freeUnits?: number | null;
  scope: DiscountScope;
  /** Target category ids. Non-empty iff `scope === "CATEGORY"`. */
  targetCategoryIds: readonly string[];
  /** Target menu-item ids. Non-empty iff `scope === "ITEM"`. */
  targetMenuItemIds: readonly string[];
  /**
   * The combo's slots, in the merchant's own declaration order. Non-empty iff
   * `scope === "COMBO"`; ignored at every other scope.
   *
   * OPTIONAL, unlike the two target arrays above, and that asymmetry is the
   * point: every discount has a scope and a type, so those fields are facts
   * about all of them, while a combo is a CAPABILITY a host opts into. A host
   * that does not sell combos never stores a `COMBO`-scoped rule, so it never
   * has a value to put here, and requiring one would have made adding combos a
   * breaking change for every adopter that does not want them.
   */
  comboRequirements?: readonly ComboRequirement[];
  /**
   * How many times this combo may apply to ONE cart; null or omitted means as
   * often as the cart can fill its slots. A cart with six burgers takes "3 for
   * the price of 2" twice unless this says otherwise.
   */
  maxComboApplications?: number | null;
  trigger: DiscountTrigger;
  /** Normalized (trimmed, upper-cased) code. Non-null iff `trigger === "CODE"`. */
  code: string | null;
  active: boolean;
  /** Inclusive lower bound of the active window; null = already open. */
  startsAt: Date | null;
  /** EXCLUSIVE upper bound of the active window; null = never closes. */
  endsAt: Date | null;
  /**
   * The WEEKLY schedule INSIDE that window (FUT-996) — "toda sexta, das 16:00
   * às 20:00". Null or omitted = always, within `[startsAt, endsAt)`, which is
   * every rule that predates the feature.
   *
   * OPTIONAL for the reason `comboRequirements` is: a schedule is a capability
   * a host opts into, so requiring the field would have made recurring
   * promotions a breaking change for every adopter that does not want them.
   */
  schedule?: DiscountSchedule | null;
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
  /**
   * WHEN this line was committed, as the store's own wall clock (FUT-996).
   *
   * The instant a scheduled promotion is screened against — never the instant
   * of payment. For a cart line that is `cart_items.created_at`; for a comanda
   * line it is the kitchen-send time at which its price was already frozen.
   * That is what makes "the beer ordered at 19:55 was ordered during happy
   * hour" true however long the table takes to settle.
   *
   * Optional, and `null` means "the host could not resolve one" — which makes
   * a scheduled rule cover the line rather than skip it. See `scheduleCovers`
   * for why the unknown fails in that direction.
   */
  committedLocal?: LocalClock | null;
}

export interface DiscountEvaluationInput {
  lines: readonly DiscountCartLine[];
  /** Every non-archived discount of the tenant; the evaluator screens them. */
  rules: readonly DiscountRule[];
  /** Raw code as the buyer typed it, or null. Normalized internally. */
  couponCode: string | null;
  /** Evaluation instant. Injected — the evaluator never calls `new Date()`. */
  now: Date;
  /**
   * `now` as the STORE's wall clock (FUT-996) — what an `ORDER`-scoped
   * scheduled rule is screened against.
   *
   * `ORDER` scope is the one place a schedule cannot be answered per line: an
   * order-wide discount names no line, and the order itself comes into
   * existence at checkout. Every other scope screens each line against its own
   * `committedLocal`. That asymmetry is deliberate and is surfaced to the
   * operator in the form rather than left invisible.
   */
  localNow?: LocalClock | null;
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
  /**
   * How many times a `COMBO`-scoped discount applied to this cart; absent for
   * every other scope.
   *
   * It is on the SNAPSHOT rather than merely in the evaluation because it is
   * the one combo fact an order cannot re-derive later: the rule's slots may
   * have been re-stated, and the line quantities the combo consumed are not
   * recoverable from the per-line cents alone. A receipt saying "Combo leve 3
   * pague 2 (2x)" needs this number.
   */
  comboApplications?: number;
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
