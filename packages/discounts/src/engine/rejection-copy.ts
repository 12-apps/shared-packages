import { DISCOUNT_REJECTION_REASONS, type DiscountRejectionReason } from "./kinds";
import type { DiscountRejection } from "./types";

/**
 * The sentence a buyer is shown when a discount they asked for did not stick
 * (FUT-235) — required HOST config, with NO defaults.
 *
 * The evaluator's reasons are machine-readable and stay the package's own; the
 * SENTENCE is the host's, because it is the only part a user reads. A default
 * in the origin host's language reads as finished to the next host right up
 * until someone sees it, which is the rule the copy-portability gate enforces
 * repo-wide. A pt-BR host imports {@link PT_BR_DISCOUNT_REJECTION_COPY} from
 * `@12-apps/discounts/pt-BR` and passes it by hand — one reviewable line.
 *
 * Hosts are encouraged to make the copy COARSER than the reasons. A coupon
 * that is switched off, has not started yet or is over can honestly read the
 * same to the buyer: the distinction only leaks how the merchant schedules
 * their promotions, and there is nothing the buyer could do differently.
 */
export type DiscountRejectionCopy = Readonly<
  Record<DiscountRejectionReason, string>
> & {
  /**
   * Said when `MIN_SUBTOTAL_NOT_MET` arrives WITHOUT its threshold — never
   * show the raw token to a buyer.
   */
  readonly minSubtotalUnknown: string;
};

/**
 * The placeholder {@link DiscountRejectionCopy.MIN_SUBTOTAL_NOT_MET} may carry,
 * replaced with the formatted threshold. A sentence that omits it is left
 * alone, so a host that would rather not quote the number simply does not
 * write the token.
 */
export const MIN_SUBTOTAL_TOKEN = "{minimum}";

const COPY_KEYS: readonly (keyof DiscountRejectionCopy)[] = [
  ...DISCOUNT_REJECTION_REASONS,
  "minSubtotalUnknown",
];

/**
 * Every key present and non-blank — the assembly-time check, so a host that
 * forgot a reason learns at wiring rather than from a buyer staring at
 * `undefined`.
 */
export function missingRejectionCopy(copy: DiscountRejectionCopy | undefined): string[] {
  if (copy === undefined) return [...COPY_KEYS];
  return COPY_KEYS.filter((key) => typeof copy[key] !== "string" || copy[key].trim() === "");
}

/**
 * The message for one rejection, with the minimum-subtotal threshold filled in
 * when the reason carries one and the host's sentence asks for it.
 *
 * `formatCents` is INJECTED rather than imported: money formatting is a
 * locale and currency decision, and this package has neither.
 */
export function discountRejectionMessage(
  rejection: DiscountRejection,
  copy: DiscountRejectionCopy,
  formatCents: (cents: number) => string,
): string {
  const template = copy[rejection.reason];
  if (!template.includes(MIN_SUBTOTAL_TOKEN)) return template;
  if (rejection.minSubtotalCents === undefined) return copy.minSubtotalUnknown;
  return template.replace(MIN_SUBTOTAL_TOKEN, formatCents(rejection.minSubtotalCents));
}
