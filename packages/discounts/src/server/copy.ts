/**
 * Every string the discounts API surface answers a HUMAN with — required host
 * config, with NO defaults, deliberately (the payments extraction's doctrine,
 * enforced repo-wide by the copy-portability gate): a default in the origin
 * host's language reads as finished to the next host right up until a user
 * sees it. The machine-readable halves of a failure — the status, and the
 * FIELD the operator must fix — stay the package's own; only the sentence is
 * the host's.
 *
 * A pt-BR host imports {@link PT_BR_DISCOUNTS_SERVER_COPY} from
 * `@12-apps/discounts/server/pt-BR` and passes it by hand — one reviewable
 * line, never a silence.
 *
 * The keys are named after the RULE, not the field, because several rules
 * report against the same form input (`targets` covers both scopes) and one
 * rule reports against two (`invalidDate` is raised for either bound).
 */
export interface DiscountsServerCopy {
  /** 400 — the list query did not parse (unknown sort field, bad page). */
  readonly invalidQuery: string;
  /** 404 — the id names no live discount of this tenant. */
  readonly notFound: string;
  /** 422 — a PERCENTAGE discount without a rate in `1..MAX_PERCENT_OFF_BP`. */
  readonly invalidPercent: string;
  /** 422 — a FIXED_AMOUNT discount without a positive amount in cents. */
  readonly invalidAmount: string;
  /** 422 — a CODE-triggered discount with no coupon code to type. */
  readonly codeRequired: string;
  /** 422 — a CATEGORY-scoped discount targeting no category. */
  readonly categoryTargetRequired: string;
  /** 422 — an ITEM-scoped discount targeting no item. */
  readonly itemTargetRequired: string;
  /** 422 — a window bound that is not a calendar date. */
  readonly invalidDate: string;
  /** 422 — the window closes at or before it opens, so it is never open. */
  readonly endsBeforeStarts: string;
  /** The weekly schedule is not one the engine can act on (FUT-996). */
  readonly invalidSchedule: string;
  /** 422 — a minimum-basket threshold of zero or less. */
  readonly invalidMinSubtotal: string;
  /** 422 — a global redemption cap of zero or less. */
  readonly invalidUsageLimit: string;
  /** 422 — a per-buyer redemption cap of zero or less. */
  readonly invalidPerBuyerLimit: string;
  /** 422 — a BUNDLE_PRICE or FREE_UNITS reward on a discount that is not a combo. */
  readonly comboScopeRequired: string;
  /** 422 — a combo with no slots at all, or more than `MAX_COMBO_SLOTS`. */
  readonly invalidComboSlots: string;
  /** 422 — a combo slot naming neither a product nor a category. */
  readonly comboTargetRequired: string;
  /** 422 — a slot asking for zero units, or more than `MAX_COMBO_SLOT_QUANTITY`. */
  readonly invalidComboQuantity: string;
  /** 422 — a BUNDLE_PRICE combo without a positive price in cents. */
  readonly invalidBundlePrice: string;
  /** 422 — a FREE_UNITS combo without a positive count of free units. */
  readonly invalidFreeUnits: string;
  /** 422 — a combo giving away every unit it asks for, which sells nothing. */
  readonly freeUnitsExceedCombo: string;
  /** 422 — a per-cart combo cap of zero or less. */
  readonly invalidMaxComboApplications: string;
  /**
   * 422 — a target id that is not this tenant's, or no longer exists.
   *
   * Reported against `targets` whichever dimension it came from, and whether
   * it arrived as a scope target or inside a combo slot: an operator picks
   * from a list this surface handed them, so the only way to reach this is a
   * crafted request or a row deleted while the form was open. One sentence
   * covers both, and it must not name WHICH id — an id the caller did not
   * already have is a fact about another store's catalog.
   */
  readonly foreignTarget: string;
}

const COPY_KEYS: readonly (keyof DiscountsServerCopy)[] = [
  "invalidQuery",
  "notFound",
  "invalidPercent",
  "invalidAmount",
  "codeRequired",
  "categoryTargetRequired",
  "itemTargetRequired",
  "invalidDate",
  "endsBeforeStarts",
  "invalidSchedule",
  "invalidMinSubtotal",
  "invalidUsageLimit",
  "invalidPerBuyerLimit",
  "comboScopeRequired",
  "invalidComboSlots",
  "comboTargetRequired",
  "invalidComboQuantity",
  "invalidBundlePrice",
  "invalidFreeUnits",
  "freeUnitsExceedCombo",
  "invalidMaxComboApplications",
  "foreignTarget",
];

/** Every key present and non-blank — checked at assembly, like the rest. */
export function missingServerCopy(copy: DiscountsServerCopy | undefined): string[] {
  if (copy === undefined) return [...COPY_KEYS];
  return COPY_KEYS.filter((key) => typeof copy[key] !== "string" || copy[key].trim() === "");
}

/**
 * What the config field takes once its copy can follow a reader.
 *
 * Declared here rather than imported from `@12-apps/i18n`: this package must
 * stay liftable into a repo that has never heard of it, so the two agree
 * STRUCTURALLY and nothing forces the dependency. The context is deliberately
 * loose — a raw tag off `WireRequest.locale`, unnarrowed — because matching it
 * is the host resolver's job.
 */
export type DiscountsCopyResolver<T> = (context: { readonly locale?: string | null }) => T;
export type DiscountsCopySource<T> = T | DiscountsCopyResolver<T>;

/**
 * The copy a field is offering, at the moment it is needed.
 *
 * Call this where the sentence is USED — a factory that resolves once and keeps
 * the result has re-frozen the language into its mount, and a single-locale
 * host cannot tell the difference.
 */
export function resolveDiscountsCopy<T>(
  source: DiscountsCopySource<T>,
  locale: string | undefined,
): T {
  return typeof source === "function"
    ? (source as DiscountsCopyResolver<T>)({ locale })
    : source;
}
