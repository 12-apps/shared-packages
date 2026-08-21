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
  /** 422 — a minimum-basket threshold of zero or less. */
  readonly invalidMinSubtotal: string;
  /** 422 — a global redemption cap of zero or less. */
  readonly invalidUsageLimit: string;
  /** 422 — a per-buyer redemption cap of zero or less. */
  readonly invalidPerBuyerLimit: string;
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
  "invalidMinSubtotal",
  "invalidUsageLimit",
  "invalidPerBuyerLimit",
];

/** Every key present and non-blank — checked at assembly, like the rest. */
export function missingServerCopy(copy: DiscountsServerCopy | undefined): string[] {
  if (copy === undefined) return [...COPY_KEYS];
  return COPY_KEYS.filter((key) => typeof copy[key] !== "string" || copy[key].trim() === "");
}
