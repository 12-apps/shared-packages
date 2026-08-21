import { allocateByLargestRemainder, maxDiscountableCents, rawAmountCents } from "./allocate";
import type { AppliedDiscount, DiscountCartLine, DiscountRule } from "./types";

/**
 * APPLICATION core of the discount evaluator (FUT-245): rules R4 (a discount's
 * base is what is still discountable), R6 (the three narrowest-first passes),
 * R9 (the payable floor, imposed here rather than on the finished total) and the
 * plumbing that turns one set of candidates into one complete
 * "what if we applied exactly these" {@link Outcome}, which R8 in `./evaluate.ts`
 * then compares against the alternatives.
 *
 * Split out of `./evaluate.ts` purely for the 400-line file gate — the same
 * reason `order-confirm-payment.ts` sits beside `order-confirm.ts`. Read it as
 * the middle of that file, not as a separate concept. Pure: no database, no
 * clock, no I/O.
 */

/** R6's three passes, narrowest scope first. */
const SCOPE_PASSES = ["ITEM", "CATEGORY", "ORDER"] as const;

/** A rule that survived R2, carried together with its R3 covered set. */
export interface Candidate {
  rule: DiscountRule;
  covered: ReadonlySet<string>;
}

/** The mutable working set of one outcome: what is left on each line so far. */
export interface EvaluationState {
  remaining: Map<string, number>;
  applied: AppliedDiscount[];
  /** R1 gross of the whole cart — the fixed reference R9's floor measures from. */
  subtotalCents: number;
  /** `Σ applied[].amountCents` so far, kept beside it so R9's headroom is O(1). */
  appliedTotalCents: number;
}

/** One complete run over a candidate set, ready to be compared with another. */
export interface Outcome {
  state: EvaluationState;
  candidates: readonly Candidate[];
  totalCents: number;
}

/** R1 — a line's gross value, floored at zero for defensive inputs. */
export function lineGrossCents(line: DiscountCartLine): number {
  return Math.max(0, line.unitPriceCents * line.quantity);
}

function freshState(lines: readonly DiscountCartLine[]): EvaluationState {
  return {
    remaining: new Map(lines.map((line) => [line.lineId, lineGrossCents(line)])),
    applied: [],
    subtotalCents: lines.reduce((sum, line) => sum + lineGrossCents(line), 0),
    appliedTotalCents: 0,
  };
}

/** Deterministic total order on rules: oldest first, then lowest id. */
export function compareRuleOrder(a: DiscountRule, b: DiscountRule): number {
  const byAge = a.createdAt.getTime() - b.createdAt.getTime();
  if (byAge !== 0) return byAge;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** R4 — what is still discountable on each of a candidate's covered lines. */
function remainingFor(state: EvaluationState, covered: ReadonlySet<string>): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const lineId of covered) {
    remaining.set(lineId, Math.max(0, state.remaining.get(lineId) ?? 0));
  }
  return remaining;
}

function sumValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const cents of values.values()) total += cents;
  return total;
}

function chargeAllocation(state: EvaluationState, allocation: ReadonlyMap<string, number>): void {
  for (const [lineId, cents] of allocation) {
    state.remaining.set(lineId, (state.remaining.get(lineId) ?? 0) - cents);
  }
}

function toApplied(rule: DiscountRule, amountCents: number): AppliedDiscount {
  return {
    discountId: rule.id,
    name: rule.name,
    code: rule.code,
    type: rule.type,
    scope: rule.scope,
    percentOffBp: rule.percentOffBp,
    amountOffCents: rule.amountOffCents,
    amountCents,
  };
}

/**
 * R9 — the cents this outcome may still give away: everything above the payable
 * floor that earlier discounts have not already taken.
 *
 * Measured against the SUBTOTAL and the running applied total rather than
 * against the per-line remainders, because the floor is a property of the ORDER
 * (one charge, one provider) and not of any line. On a cart whose gross is zero
 * this is zero, so a free cart stays free instead of being handed a phantom cent.
 */
function headroomCents(state: EvaluationState): number {
  return maxDiscountableCents(state.subtotalCents) - state.appliedTotalCents;
}

/**
 * Apply one candidate to the running state (R4 → R5 → R9 → R7) and return what
 * it removed. Zero removes nothing and records nothing — R5's `ZERO_VALUE` case,
 * because an `R$ 0,00` line is not a promotion.
 *
 * The R9 cap sits BETWEEN the raw amount and the allocation on purpose: the
 * clamped amount is the one that gets split across the lines, so the per-line
 * parts still sum to what was actually applied and the double-entry invariant
 * survives a clamp. A discount whose headroom has run out is simply never
 * applied, and `./evaluate.ts` reports it as `ZERO_VALUE` — it removed nothing,
 * which is exactly what that reason means, and inventing a second "the cart is
 * already free" reason would say nothing more to a buyer.
 */
function applyOne(state: EvaluationState, candidate: Candidate): number {
  const remaining = remainingFor(state, candidate.covered);
  const rawCents = rawAmountCents(candidate.rule, sumValues(remaining));
  const amountCents = Math.min(rawCents, headroomCents(state));
  if (amountCents <= 0) return 0;
  chargeAllocation(state, allocateByLargestRemainder(amountCents, remaining));
  state.applied.push(toApplied(candidate.rule, amountCents));
  state.appliedTotalCents += amountCents;
  return amountCents;
}

/**
 * R6's within-pass ordering: biggest saving first, measured against the state
 * at PASS ENTRY (not re-measured mid-pass, or the order would depend on
 * itself), then the canonical rule order. Biggest-first is the buyer-favourable
 * order whenever a later clamp bites.
 *
 * The score is the PRE-R9 raw amount deliberately. R9's headroom is one budget
 * shared by the whole outcome, so it is spent to the last cent whichever order
 * the pass runs in — capping the scores would only flatten distinct promotions
 * into a tie and hand the choice of which one to NAME to the id tie-break. The
 * A-vs-B comparison in R8 is a different question and does compare capped
 * totals; see `runOutcome`.
 */
function orderPassCandidates(
  state: EvaluationState,
  candidates: readonly Candidate[],
): Candidate[] {
  const scored = candidates.map((candidate) => ({
    candidate,
    amountCents: rawAmountCents(candidate.rule, sumValues(remainingFor(state, candidate.covered))),
  }));
  scored.sort((a, b) => {
    const byAmount = b.amountCents - a.amountCents;
    return byAmount !== 0 ? byAmount : compareRuleOrder(a.candidate.rule, b.candidate.rule);
  });
  return scored.map((entry) => entry.candidate);
}

function runPass(state: EvaluationState, candidates: readonly Candidate[]): void {
  for (const candidate of orderPassCandidates(state, candidates)) {
    applyOne(state, candidate);
  }
}

/** R6 — the three fixed passes, narrowest scope first. */
function runPasses(state: EvaluationState, candidates: readonly Candidate[]): void {
  for (const scope of SCOPE_PASSES) {
    runPass(
      state,
      candidates.filter((candidate) => candidate.rule.scope === scope),
    );
  }
}

/**
 * Run one candidate set against a pristine cart.
 *
 * `totalCents` is the sum of the amounts that were ACTUALLY applied — already
 * capped by R9 — which is what makes it safe for R8 to compare two outcomes
 * with. Comparing pre-clamp figures could crown an outcome that looks larger and
 * then delivers less than the one it beat.
 */
export function runOutcome(
  lines: readonly DiscountCartLine[],
  candidates: readonly Candidate[],
): Outcome {
  const state = freshState(lines);
  runPasses(state, candidates);
  return { state, candidates, totalCents: state.appliedTotalCents };
}

/**
 * R8's outcome B — every exclusive discount evaluated ALONE against the
 * pristine cart, best saving wins, ties broken by the canonical rule order.
 * Each one is a full {@link runOutcome}, so every candidate is scored on its
 * post-R9 value and the winner is the one that really removes the most cents.
 */
export function outcomeBestSingle(
  lines: readonly DiscountCartLine[],
  exclusives: readonly Candidate[],
): { candidate: Candidate; outcome: Outcome } | null {
  const scored = exclusives.map((candidate) => ({
    candidate,
    outcome: runOutcome(lines, [candidate]),
  }));
  scored.sort((a, b) => {
    const byAmount = b.outcome.totalCents - a.outcome.totalCents;
    return byAmount !== 0 ? byAmount : compareRuleOrder(a.candidate.rule, b.candidate.rule);
  });
  return scored[0] ?? null;
}
