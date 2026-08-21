import { allocateByLargestRemainder, maxDiscountableCents, rawAmountCents } from "./allocate";
import { freshComboPool, matchCombo, type ComboMatch } from "./combo-match";
import type { AppliedDiscount, DiscountCartLine, DiscountRule } from "./types";

/**
 * APPLICATION core of the discount evaluator (FUT-245): rules R4 (a discount's
 * base is what is still discountable), R6 (the four narrowest-first passes),
 * R9 (the payable floor, imposed here rather than on the finished total), R10
 * (combos: the shared unit pool and the opacity of what they consumed) and the
 * plumbing that turns one set of candidates into one complete
 * "what if we applied exactly these" {@link Outcome}, which R8 in `./evaluate.ts`
 * then compares against the alternatives.
 *
 * Split out of `./evaluate.ts` purely for the 400-line file gate — the same
 * reason `order-confirm-payment.ts` sits beside `order-confirm.ts`. Read it as
 * the middle of that file, not as a separate concept. Pure: no database, no
 * clock, no I/O.
 *
 * ─── R10, THE COMBO RULES, IN FULL ───
 *
 * A combo is the only candidate whose base is not "the lines it covers". It
 * consumes UNITS, and two consequences follow that the other three scopes never
 * raise:
 *
 * 1. **One pool, shared by every combo.** Two combos that both want the same
 *    three burgers must not both be paid for them. The state therefore carries
 *    a unit pool that each match DEDUCTS from, so the second combo sees only
 *    what the first left. Without it a cart of three burgers could satisfy
 *    "3 for the price of 2" and "buy 3 get a free soda" on the same three
 *    units, and the merchant would pay for both.
 *
 * 2. **What a combo consumed is OPAQUE to `ITEM` and `CATEGORY`.** A combo
 *    price is a number the merchant set deliberately for a specific group; a
 *    component-targeted promotion stacking on top of it is the double discount
 *    the epic exists to refuse. So the units inside a combo are locked at their
 *    post-combo value and the two middle passes see only the units OUTSIDE it —
 *    a line of five burgers with three in a combo offers exactly two burgers at
 *    full price to an item-level promotion.
 *
 *    `ORDER` is deliberately NOT blocked, and applies to the combo PRICE: an
 *    order-wide "10% off everything" is a statement about the basket, not about
 *    the components, and a buyer who was promised it on the whole cart would be
 *    right to be surprised by a combo silently opting out of it.
 *
 * The two together are what make R4's promise still true at the UNIT level:
 * money already given away on a unit cannot be given away again.
 */

/**
 * R6's four passes, narrowest scope first. `COMBO` leads because it is the
 * narrowest thing a merchant can price — a named group of units — and because
 * the opacity in R10 only means anything if the combo has already claimed its
 * units by the time the item pass runs.
 */
const SCOPE_PASSES = ["COMBO", "ITEM", "CATEGORY", "ORDER"] as const;

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
  /** R10 — units no combo has claimed yet. Depleted as combos match. */
  comboPool: Map<string, number>;
  /** R10 — per line, the NET value sitting inside a combo. Opaque to ITEM/CATEGORY. */
  comboLockedCents: Map<string, number>;
  /** The cart by line id: the combo matcher needs unit prices and targeting. */
  linesById: ReadonlyMap<string, DiscountCartLine>;
}

/** One complete run over a candidate set, ready to be compared with another. */
export interface Outcome {
  state: EvaluationState;
  candidates: readonly Candidate[];
  totalCents: number;
}

/** What one candidate would take, and from where, measured against the state. */
interface ApplicationPlan {
  /** lineId -> the cents this candidate may take from that line. */
  base: Map<string, number>;
  /** R5's raw value against that base, before R9's floor. */
  rawCents: number;
  /** The combo match behind the plan, or null for the other three scopes. */
  match: ComboMatch | null;
}

/** R1 — a line's gross value, floored at zero for defensive inputs. */
export function lineGrossCents(line: DiscountCartLine): number {
  return Math.max(0, line.unitPriceCents * line.quantity);
}

function freshState(lines: readonly DiscountCartLine[]): EvaluationState {
  const pool = freshComboPool(lines);
  return {
    remaining: new Map(lines.map((line) => [line.lineId, lineGrossCents(line)])),
    applied: [],
    subtotalCents: lines.reduce((sum, line) => sum + lineGrossCents(line), 0),
    appliedTotalCents: 0,
    comboPool: new Map(pool.unitsByLine),
    comboLockedCents: new Map(),
    linesById: pool.linesById,
  };
}

/** Deterministic total order on rules: oldest first, then lowest id. */
export function compareRuleOrder(a: DiscountRule, b: DiscountRule): number {
  const byAge = a.createdAt.getTime() - b.createdAt.getTime();
  if (byAge !== 0) return byAge;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function sumValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const cents of values.values()) total += cents;
  return total;
}

/**
 * R4 + R10 — what is still discountable on each of a candidate's covered lines.
 *
 * `ITEM` and `CATEGORY` are additionally denied whatever a combo has locked, so
 * they reach only the units the combo did not take. `ORDER` reads the plain
 * remainder, which is the combo's net price plus everything else.
 */
function discountableFor(state: EvaluationState, candidate: Candidate): Map<string, number> {
  const respectsCombos = candidate.rule.scope !== "ORDER";
  const base = new Map<string, number>();
  for (const lineId of candidate.covered) {
    const remaining = Math.max(0, state.remaining.get(lineId) ?? 0);
    const locked = respectsCombos ? (state.comboLockedCents.get(lineId) ?? 0) : 0;
    base.set(lineId, Math.max(0, remaining - locked));
  }
  return base;
}

/**
 * R10 — a combo's plan: match against what the pool still holds, then take the
 * consumed units' GROSS value as the allocation base.
 *
 * The base is the consumed value rather than the whole line, because a combo
 * that took three of a line's five burgers must charge its discount to those
 * three. Allocating over the whole line would spread the money across units the
 * combo never claimed, and the locked-value arithmetic in `lockComboValue`
 * would then hold back the wrong number.
 */
function comboPlan(state: EvaluationState, rule: DiscountRule): ApplicationPlan {
  const match = matchCombo(rule, {
    unitsByLine: state.comboPool,
    linesById: state.linesById,
  });
  if (match === null) return { base: new Map(), rawCents: 0, match: null };
  const base = new Map<string, number>();
  for (const [lineId, grossCents] of match.consumedCentsByLine) {
    base.set(lineId, Math.min(grossCents, Math.max(0, state.remaining.get(lineId) ?? 0)));
  }
  return { base, rawCents: Math.min(match.rewardCents, sumValues(base)), match };
}

function planFor(state: EvaluationState, candidate: Candidate): ApplicationPlan {
  if (candidate.rule.scope === "COMBO") return comboPlan(state, candidate.rule);
  const base = discountableFor(state, candidate);
  return { base, rawCents: rawAmountCents(candidate.rule, sumValues(base)), match: null };
}

function chargeAllocation(state: EvaluationState, allocation: ReadonlyMap<string, number>): void {
  for (const [lineId, cents] of allocation) {
    state.remaining.set(lineId, (state.remaining.get(lineId) ?? 0) - cents);
  }
}

/** R10 — the units are spent: no later combo may be paid for them again. */
function depleteComboPool(state: EvaluationState, match: ComboMatch): void {
  for (const [lineId, units] of match.consumedUnitsByLine) {
    state.comboPool.set(lineId, Math.max(0, (state.comboPool.get(lineId) ?? 0) - units));
  }
}

/**
 * R10 — lock the consumed units at what the buyer will actually pay for them.
 *
 * `gross - allocated` is the combo's own net, so an item-level promotion is
 * left with exactly `(quantity - consumed) x unitPrice` on that line: the
 * units outside the combo, at full price. Locking the GROSS instead would hide
 * the combo's discount from the order pass too, and locking nothing would let
 * the item pass discount the bundle price a second time.
 */
function lockComboValue(
  state: EvaluationState,
  match: ComboMatch,
  allocation: ReadonlyMap<string, number>,
): void {
  for (const [lineId, grossCents] of match.consumedCentsByLine) {
    const netCents = Math.max(0, grossCents - (allocation.get(lineId) ?? 0));
    state.comboLockedCents.set(lineId, (state.comboLockedCents.get(lineId) ?? 0) + netCents);
  }
}

function toApplied(
  rule: DiscountRule,
  amountCents: number,
  match: ComboMatch | null,
): AppliedDiscount {
  const applied: AppliedDiscount = {
    discountId: rule.id,
    name: rule.name,
    code: rule.code,
    type: rule.type,
    scope: rule.scope,
    percentOffBp: rule.percentOffBp,
    amountOffCents: rule.amountOffCents,
    amountCents,
  };
  if (match === null) return applied;
  return { ...applied, comboApplications: match.applications };
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
 * Apply one candidate to the running state (R4 → R5 → R9 → R7, plus R10 for a
 * combo) and return what it removed. Zero removes nothing and records nothing —
 * R5's `ZERO_VALUE` case, because an `R$ 0,00` line is not a promotion.
 *
 * The R9 cap sits BETWEEN the raw amount and the allocation on purpose: the
 * clamped amount is the one that gets split across the lines, so the per-line
 * parts still sum to what was actually applied and the double-entry invariant
 * survives a clamp. A discount whose headroom has run out is simply never
 * applied, and `./evaluate.ts` reports it as `ZERO_VALUE` — it removed nothing,
 * which is exactly what that reason means, and inventing a second "the cart is
 * already free" reason would say nothing more to a buyer.
 *
 * A combo that removes nothing consumes nothing either: the pool and the locks
 * are only touched past the early return. That matters — a combo clamped to
 * zero by the payable floor must not lock its units away from the item pass,
 * having given the buyer nothing in exchange.
 */
function applyOne(state: EvaluationState, candidate: Candidate): number {
  const plan = planFor(state, candidate);
  const amountCents = Math.min(plan.rawCents, headroomCents(state));
  if (amountCents <= 0) return 0;
  const allocation = allocateByLargestRemainder(amountCents, plan.base);
  chargeAllocation(state, allocation);
  if (plan.match !== null) {
    depleteComboPool(state, plan.match);
    lockComboValue(state, plan.match, allocation);
  }
  state.applied.push(toApplied(candidate.rule, amountCents, plan.match));
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
 *
 * Combos are scored the same way and against the same pass-entry pool, so two
 * combos competing for one set of units are ranked by what each is worth on the
 * FULL cart, and the richer one claims its units first.
 */
function orderPassCandidates(
  state: EvaluationState,
  candidates: readonly Candidate[],
): Candidate[] {
  const scored = candidates.map((candidate) => ({
    candidate,
    amountCents: planFor(state, candidate).rawCents,
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

/** R6 — the four fixed passes, narrowest scope first. */
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
