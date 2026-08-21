import { maxDiscountableCents } from "./allocate";
import { normalizeDiscountCode } from "./kinds";
import { buildLineIndex, coveredLineIds, screenRule } from "./eligibility";
import {
  compareRuleOrder,
  lineGrossCents,
  outcomeBestSingle,
  runOutcome,
  type Candidate,
  type Outcome,
} from "./evaluate-passes";
import type { DiscountRejectionReason } from "./kinds";
import type { LineIndex } from "./eligibility";
import type {
  DiscountCartLine,
  DiscountEvaluation,
  DiscountEvaluationInput,
  DiscountLineAdjustment,
  DiscountRejection,
  DiscountRule,
} from "./types";

/**
 * The discount evaluator (FUT-245): given a priced cart, the tenant's discount
 * rules and an instant, decide which discounts apply, how much each removes and
 * how that money is charged back to the individual lines.
 *
 * PURE: no database, no I/O, no clock, no randomness. `now` is injected, the
 * rules arrive pre-loaded from whatever the host reads them out of, and the same input
 * always produces byte-identical output — including the ORDER of `applied[]`
 * and `rejections[]`, which the storefront renders.
 *
 * THE RULE SET (cited by number from the tests and from the sibling modules):
 *
 * R1 — Line gross is `unitPriceCents * quantity`, with `unitPriceCents` exactly
 *      the cart's composed unit price (base/variation + paid extras).
 *      `subtotalCents` is their sum. An empty cart short-circuits to a zero
 *      evaluation, with `EMPTY_CART` for any coupon the buyer supplied.
 * R2 — Eligibility screen (`./eligibility.ts`). A failing AUTOMATIC discount is
 *      dropped silently; a failing CODE discount the buyer typed is reported.
 * R3 — Covered set (`./eligibility.ts`).
 * R4 — A discount's base is what is STILL discountable on its covered lines, so
 *      a later discount never discounts money an earlier one already removed.
 * R5 — Raw amount (`./allocate.ts`).
 * R6 — Scope precedence `ITEM → CATEGORY → ORDER`, in three passes
 *      (`./evaluate-passes.ts`). Narrowest first, so an order-wide percentage is
 *      computed on the already item-discounted amount and an order-wide fixed
 *      amount is clamped to what is actually left.
 * R7 — Allocation across lines by largest remainder (`./allocate.ts`).
 * R8 — Stacking: the stackable discounts applied together ("outcome A") versus
 *      the best single exclusive one ("outcome B"); more cents off wins, a tie
 *      goes to A. Both outcomes are built under R9, so the comparison is between
 *      what each would REALLY remove, never between two pre-clamp fantasies. A
 *      coupon the buyer actually typed always wins: exclusive ⇒ it forces B,
 *      stackable ⇒ it forces A.
 * R9 — Payable floor: `totalCents = subtotalCents - discountTotalCents`, and a
 *      discounted order never lands below `MIN_PAYABLE_TOTAL_CENTS` (R$ 0,01).
 *
 * ─── R9 CONTRADICTS THE FUT-235 SPEC ON PURPOSE. DO NOT "FIX" IT BACK. ───
 *
 * The written spec (rule R9, unit cases C15 and C16) says a 100%-off percentage
 * and an oversized `FIXED_AMOUNT` must both land the order on EXACTLY ZERO. The
 * product owner overrode that after the payment path was re-read: `totalCents`
 * is the only number ever sent to the payment provider, and a provider has no
 * zero-amount branch, and a R$ 0,00 charge is REJECTED — the order would strand
 * in `AWAITING_PAYMENT` with its stock never consumed and its coupon never
 * counted. Given the choice between teaching the payment path to settle an order
 * nobody pays for and keeping one cent payable, the owner chose the cent. The
 * spec is wrong on this point and this code is right; a later reader restoring
 * "must reach zero" would be re-introducing a stranded-order bug, not a fix.
 *
 * The floor is imposed DURING application, in `./evaluate-passes.ts`: each
 * discount's amount is capped to `subtotalCents - alreadyApplied -
 * MIN_PAYABLE_TOTAL_CENTS` BEFORE it is allocated across its lines, and one that
 * lands at or below zero is not applied at all (rejected `ZERO_VALUE`). It is
 * never a post-hoc subtraction from the finished total, because that would break
 * the double-entry invariant below — and with it the `orders_subtotal_check`
 * CHECK, which refuses any order row where the three numbers disagree.
 *
 * The floor only bites when there is money to floor: a cart whose gross is
 * already zero (empty, or only free items) stays at zero and simply gets no
 * discount. `totalCents` can therefore never exceed `subtotalCents` either.
 *
 * Double-entry invariant, asserted across the whole unit matrix:
 * `Σ applied[].amountCents === discountTotalCents === Σ lines[].discountCents`.
 */

/** The stacking decision of R8: who won, and who was displaced by whom. */
interface OutcomeChoice {
  outcome: Outcome;
  displaced: readonly Candidate[];
  supersededBy: string | null;
}

/**
 * Dedupe by id (first wins — adversarial input must not be counted twice) and
 * put the rules in their canonical order, so the evaluation cannot depend on
 * the order the host's loader happened to return them in.
 */
function canonicalRules(rules: readonly DiscountRule[]): DiscountRule[] {
  const byId = new Map<string, DiscountRule>();
  for (const rule of rules) {
    if (!byId.has(rule.id)) byId.set(rule.id, rule);
  }
  return [...byId.values()].sort(compareRuleOrder);
}

/**
 * R8 — choose between stacking everything stackable and applying the single
 * best exclusive discount.
 *
 * A coupon the buyer explicitly typed is never silently discarded: an exclusive
 * coupon IS exclusivity, so it forces outcome B on its own terms; a stackable
 * coupon is already inside outcome A, so A is forced. Otherwise the outcome
 * that removes more cents wins, and a tie goes to A — the additive result is
 * the one the promotions advertised, and it shows the buyer more of them.
 */
function selectOutcome(
  lines: readonly DiscountCartLine[],
  candidates: readonly Candidate[],
  couponCode: string | null,
): OutcomeChoice {
  const stackables = candidates.filter((candidate) => candidate.rule.stackable);
  const coupon =
    couponCode === null
      ? undefined
      : candidates.find((candidate) => candidate.rule.code === couponCode);
  const stack = runOutcome(lines, stackables);
  if (coupon) {
    if (coupon.rule.stackable) return { outcome: stack, displaced: [], supersededBy: null };
    const forced = runOutcome(lines, [coupon]);
    // "Always applied" presupposes there is something to apply: a coupon that
    // computes to zero (R5), or that finds no headroom under the payable floor
    // (R9, e.g. a one-cent cart), was never applied, so it has displaced nothing,
    // and charging the buyer full price for typing a worthless code would be a
    // punishment. Fall back to the stack — the coupon still gets its own
    // ZERO_VALUE rejection, so the buyer is told what happened. `forced` is a
    // post-floor total, so this reads what really happened, not what was asked.
    if (forced.totalCents === 0) return { outcome: stack, displaced: [], supersededBy: null };
    return { outcome: forced, displaced: stackables, supersededBy: coupon.rule.id };
  }

  const best = outcomeBestSingle(
    lines,
    candidates.filter((candidate) => !candidate.rule.stackable),
  );
  if (best === null || best.outcome.totalCents <= stack.totalCents) {
    return { outcome: stack, displaced: [], supersededBy: null };
  }
  return { outcome: best.outcome, displaced: stackables, supersededBy: best.candidate.rule.id };
}

function toRejection(rule: DiscountRule, reason: DiscountRejectionReason): DiscountRejection {
  const rejection: DiscountRejection = { discountId: rule.id, code: rule.code, reason };
  if (reason === "MIN_SUBTOTAL_NOT_MET" && rule.minSubtotalCents !== null) {
    return { ...rejection, minSubtotalCents: rule.minSubtotalCents };
  }
  return rejection;
}

type Screened =
  | { kind: "candidate"; candidate: Candidate }
  | { kind: "rejected"; rejection: DiscountRejection }
  | { kind: "skipped" };

/**
 * R2 for one rule. A CODE rule the buyer did not type is not a candidate and
 * not a rejection — it simply is not in play. A failing AUTOMATIC rule is
 * dropped silently: the buyer must never be shown a promotion they cannot have.
 */
function screenOneRule(
  rule: DiscountRule,
  input: DiscountEvaluationInput,
  context: { subtotalCents: number; couponCode: string | null; index: LineIndex },
): Screened {
  if (rule.trigger === "CODE" && rule.code !== context.couponCode) return { kind: "skipped" };
  const covered = coveredLineIds(rule, input.lines, context.index);
  const reason = screenRule(rule, {
    now: input.now,
    subtotalCents: context.subtotalCents,
    hasEligibleItems: covered.size > 0,
  });
  if (reason === null) return { kind: "candidate", candidate: { rule, covered } };
  if (rule.trigger !== "CODE") return { kind: "skipped" };
  return { kind: "rejected", rejection: toRejection(rule, reason) };
}

interface ScreenResult {
  candidates: Candidate[];
  rejections: DiscountRejection[];
}

function screenCandidates(
  input: DiscountEvaluationInput,
  subtotalCents: number,
  couponCode: string | null,
): ScreenResult {
  const rules = canonicalRules(input.rules);
  const context = { subtotalCents, couponCode, index: buildLineIndex(input.lines) };
  const candidates: Candidate[] = [];
  const rejections: DiscountRejection[] = [];
  for (const rule of rules) {
    const screened = screenOneRule(rule, input, context);
    if (screened.kind === "candidate") candidates.push(screened.candidate);
    else if (screened.kind === "rejected") rejections.push(screened.rejection);
  }
  if (couponCode !== null && !rules.some((rule) => rule.code === couponCode)) {
    rejections.push({ discountId: null, code: couponCode, reason: "UNKNOWN_CODE" });
  }
  return { candidates, rejections };
}

/**
 * A CODE candidate that survived the screen but removed nothing — the buyer
 * typed a real, live coupon and got R$ 0,00 off, which needs saying. Candidates
 * an exclusive winner displaced are excluded: they have their own, more
 * informative `NOT_STACKABLE` reason.
 *
 * "Removed nothing" now covers one more case than R5's: a coupon that computed a
 * real amount but found no headroom left under the R9 floor, because everything
 * above R$ 0,01 was already discounted. The reason is the same because the
 * outcome is the same — the coupon took nothing off — and the buyer-facing copy
 * ("Este cupom não vale para os itens do seu carrinho") stays true.
 */
function zeroValueRejections(
  candidates: readonly Candidate[],
  choice: OutcomeChoice,
): DiscountRejection[] {
  const appliedIds = new Set(choice.outcome.state.applied.map((entry) => entry.discountId));
  const displacedIds = new Set(choice.displaced.map(({ rule }) => rule.id));
  return candidates
    .filter(
      ({ rule }) =>
        rule.trigger === "CODE" && !appliedIds.has(rule.id) && !displacedIds.has(rule.id),
    )
    .map(({ rule }) => ({ discountId: rule.id, code: rule.code, reason: "ZERO_VALUE" as const }));
}

/**
 * Whoever an EXCLUSIVE winner pushed aside is reported, so the storefront can
 * say "o cupom X substituiu a promoção Y" instead of silently showing one
 * promotion fewer than the menu advertised. Nothing is reported when the stack
 * wins: nothing was displaced, the additive result simply was the better one.
 */
function notStackableRejections(choice: OutcomeChoice): DiscountRejection[] {
  const { supersededBy } = choice;
  if (supersededBy === null) return [];
  return choice.displaced.map(({ rule }) => ({
    discountId: rule.id,
    code: rule.code,
    reason: "NOT_STACKABLE" as const,
    supersededByDiscountId: supersededBy,
  }));
}

function toAdjustment(line: DiscountCartLine, outcome: Outcome): DiscountLineAdjustment {
  const gross = lineGrossCents(line);
  const lineNetCents = Math.max(0, outcome.state.remaining.get(line.lineId) ?? gross);
  return {
    lineId: line.lineId,
    lineGrossCents: gross,
    discountCents: gross - lineNetCents,
    lineNetCents,
  };
}

function emptyEvaluation(couponCode: string | null): DiscountEvaluation {
  return {
    subtotalCents: 0,
    discountTotalCents: 0,
    totalCents: 0,
    applied: [],
    lines: [],
    rejections:
      couponCode === null
        ? []
        : [{ discountId: null, code: couponCode, reason: "EMPTY_CART" as const }],
  };
}

function buildEvaluation(args: {
  lines: readonly DiscountCartLine[];
  subtotalCents: number;
  choice: OutcomeChoice;
  candidates: readonly Candidate[];
  screenRejections: readonly DiscountRejection[];
}): DiscountEvaluation {
  const outcome = args.choice.outcome;
  const applied = outcome.state.applied;
  // R9 — a belt-and-braces re-clamp, NOT where the floor is enforced: the
  // per-application cap in `./evaluate-passes.ts` already guarantees this bound,
  // so this line is a no-op on every input the engine can currently produce. It
  // stays because a future rule that breaks the guarantee should surface as a
  // wrong-but-safe number (and a failing invariant assertion in the unit matrix)
  // rather than as a charge the provider refuses.
  const summed = applied.reduce((sum, entry) => sum + entry.amountCents, 0);
  const discountTotalCents = Math.min(
    Math.max(summed, 0),
    maxDiscountableCents(args.subtotalCents),
  );
  return {
    subtotalCents: args.subtotalCents,
    discountTotalCents,
    totalCents: args.subtotalCents - discountTotalCents,
    applied,
    lines: args.lines.map((line) => toAdjustment(line, outcome)),
    rejections: [
      ...args.screenRejections,
      ...zeroValueRejections(args.candidates, args.choice),
      ...notStackableRejections(args.choice),
    ],
  };
}

function normalizeCoupon(raw: string | null): string | null {
  if (raw === null) return null;
  const normalized = normalizeDiscountCode(raw);
  return normalized.length === 0 ? null : normalized;
}

/**
 * Evaluate a cart against a tenant's discounts. Pure: same input, same output,
 * no clock, no I/O. See the numbered rule set R1..R9 above.
 */
export function evaluateDiscounts(input: DiscountEvaluationInput): DiscountEvaluation {
  const couponCode = normalizeCoupon(input.couponCode);
  if (input.lines.length === 0) return emptyEvaluation(couponCode);

  const subtotalCents = input.lines.reduce((sum, line) => sum + lineGrossCents(line), 0);
  const screened = screenCandidates(input, subtotalCents, couponCode);
  const choice = selectOutcome(input.lines, screened.candidates, couponCode);
  return buildEvaluation({
    lines: input.lines,
    subtotalCents,
    choice,
    candidates: screened.candidates,
    screenRejections: screened.rejections,
  });
}
