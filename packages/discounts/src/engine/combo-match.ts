import { rawAmountCents } from "./allocate";
import type { ComboRequirement, DiscountCartLine, DiscountRule } from "./types";

/**
 * COMBO matching (FUT-268): which UNITS of a cart satisfy a combo's slots, how
 * many times, and how many cents that is worth.
 *
 * This is the one part of the engine that counts UNITS rather than lines. A
 * discount scoped to an item takes a percentage off a whole line and never
 * needs to know it holds five burgers; a combo does — "3 for the price of 2"
 * on a line of five applies once and leaves two burgers at full price, and the
 * cents that fall out of that are not a function of the line's total.
 *
 * Pure, like the rest of the engine: no database, no clock, no I/O. The same
 * pool and the same rule always produce the same match, down to WHICH units
 * were taken, because every ordering below has an explicit final tie-break.
 *
 * ## The matching rule, stated once
 *
 * One APPLICATION fills every slot. A slot is filled from the units its
 * targets accept, MOST EXPENSIVE FIRST, and slots are filled MOST CONSTRAINED
 * FIRST. The combo then applies again against whatever units are left, until a
 * slot can no longer be filled or `maxComboApplications` is reached.
 *
 * Most-expensive-first is the buyer-favourable reading and it is the same
 * instinct as R6's biggest-first ordering. On a `FREE_UNITS` combo it makes the
 * free unit the dearest one the deal can reach; on a `BUNDLE_PRICE` combo the
 * buyer pays the bundle price either way, so pulling the expensive units INTO
 * the bundle leaves the cheap ones outside it at full price, which is again the
 * cheaper cart.
 *
 * Most-constrained-first is a HEURISTIC, and the honest name for what it is: a
 * greedy assignment, not a maximum bipartite matching. It is exact whenever the
 * slots are disjoint — which every combo a merchant can describe in a sentence
 * is — and it repairs the one overlap that occurs in practice, a specific item
 * slot next to a broad category slot that also accepts it ("1 large popcorn + 2
 * sodas", where the popcorn is itself filed under a targeted category). Filling
 * the narrow slot first stops the broad one from eating its only candidate. A
 * deliberately pathological spec — three slots overlapping three ways — can
 * still leave an application unmatched that a full matching would have found.
 *
 * That residue is bounded and it is bounded in the safe direction: the cost is
 * a combo firing fewer times than it could, never a wrong price, because
 * whatever the assignment picks is a real set of units the buyer really has.
 * The admin surface does NOT detect overlap — it caps the slot COUNT
 * (`MAX_COMBO_SLOTS`), which is a limit on how pathological a spec can get and
 * not a check that one is not. Trading an exact matching for that was
 * deliberate: the exact algorithm is a maximum bipartite matching re-run per
 * application, on a hot path a whole menu page walks, to buy correctness only
 * on specs no merchant writes.
 */

/**
 * The units a combo may still consume, plus the lines they belong to.
 *
 * It is a POOL rather than a plain line list because combos share it: two
 * combos that both want the same burgers must not both be paid for them, so
 * the combo pass builds one pool, and each match deducts what it took. See
 * `runPass` in `./evaluate-passes.ts`.
 */
export interface ComboPool {
  /** lineId -> units still available. */
  readonly unitsByLine: ReadonlyMap<string, number>;
  /** Every line of the cart by id — the matcher needs prices and targeting. */
  readonly linesById: ReadonlyMap<string, DiscountCartLine>;
}

/** What one combo took from the cart, and what it is worth. */
export interface ComboMatch {
  /** How many times the slots were filled. Always >= 1 on a real match. */
  applications: number;
  /** lineId -> units consumed across every application. */
  consumedUnitsByLine: ReadonlyMap<string, number>;
  /** lineId -> GROSS cents of those units. This is the allocation base. */
  consumedCentsByLine: ReadonlyMap<string, number>;
  /** Gross value of the whole matched group: the sum of the map above. */
  groupCents: number;
  /**
   * Cents this combo removes, summed over its applications and before the
   * cart-level clamps (R4's remainders and R9's payable floor) are applied.
   */
  rewardCents: number;
}

/** lineId -> a count of units. */
type UnitTally = Map<string, number>;

/** One slot with its target lists turned into sets, prepared once per match. */
interface PreparedSlot {
  quantity: number;
  menuItemIds: ReadonlySet<string>;
  categoryIds: ReadonlySet<string>;
}

/** One candidate line for a slot, carried with the facts the sort needs. */
interface SlotCandidate {
  lineId: string;
  units: number;
  line: DiscountCartLine;
}

/** A pristine pool: every line's full quantity available. */
export function freshComboPool(lines: readonly DiscountCartLine[]): ComboPool {
  return {
    unitsByLine: new Map(lines.map((line) => [line.lineId, Math.max(0, line.quantity)])),
    linesById: new Map(lines.map((line) => [line.lineId, line])),
  };
}

function prepareSlots(requirements: readonly ComboRequirement[]): PreparedSlot[] {
  return requirements.map((requirement) => ({
    quantity: Math.trunc(requirement.quantity),
    menuItemIds: new Set(requirement.menuItemIds),
    categoryIds: new Set(requirement.categoryIds),
  }));
}

/**
 * Whether one slot accepts one line: its BASE item, its chosen VARIATION, or
 * any category on its path. Exactly the reach `coveredLineIds` gives an
 * `ITEM`- or `CATEGORY`-scoped discount, so a merchant does not have to learn
 * a second targeting model for combos.
 */
function slotAccepts(slot: PreparedSlot, line: DiscountCartLine): boolean {
  if (slot.menuItemIds.has(line.menuItemId)) return true;
  if (line.variationMenuItemId !== null && slot.menuItemIds.has(line.variationMenuItemId)) {
    return true;
  }
  return line.categoryPath.some((categoryId) => slot.categoryIds.has(categoryId));
}

/** Every available unit a slot accepts, dearest first, then by line id. */
function candidatesFor(
  slot: PreparedSlot,
  available: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): SlotCandidate[] {
  return [...available.entries()]
    .map(([lineId, units]) => ({ lineId, units, line: linesById.get(lineId) }))
    .filter(
      (entry): entry is SlotCandidate =>
        entry.units > 0 && entry.line !== undefined && slotAccepts(slot, entry.line),
    )
    .sort((a, b) => {
      const byPrice = b.line.unitPriceCents - a.line.unitPriceCents;
      if (byPrice !== 0) return byPrice;
      return a.lineId < b.lineId ? -1 : 1;
    });
}

/** Take one slot's units, dearest first. Null when the cart is short. */
function takeSlot(
  slot: PreparedSlot,
  available: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): UnitTally | null {
  const taken: UnitTally = new Map();
  let needed = slot.quantity;
  for (const candidate of candidatesFor(slot, available, linesById)) {
    if (needed <= 0) break;
    const take = Math.min(needed, candidate.units);
    taken.set(candidate.lineId, take);
    needed -= take;
  }
  return needed > 0 ? null : taken;
}

/** How many units are available to a slot right now — the constraint metric. */
function supplyFor(
  slot: PreparedSlot,
  available: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): number {
  return candidatesFor(slot, available, linesById).reduce(
    (total, candidate) => total + candidate.units,
    0,
  );
}

/** Most constrained first, ties broken by the merchant's declaration order. */
function orderSlots(
  slots: readonly PreparedSlot[],
  available: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): PreparedSlot[] {
  return slots
    .map((slot, index) => ({ slot, index, supply: supplyFor(slot, available, linesById) }))
    .sort((a, b) => a.supply - b.supply || a.index - b.index)
    .map((entry) => entry.slot);
}

function addUnits(target: UnitTally, source: ReadonlyMap<string, number>): void {
  for (const [lineId, units] of source) {
    target.set(lineId, (target.get(lineId) ?? 0) + units);
  }
}

function subtractUnits(target: UnitTally, source: ReadonlyMap<string, number>): void {
  for (const [lineId, units] of source) {
    target.set(lineId, Math.max(0, (target.get(lineId) ?? 0) - units));
  }
}

/**
 * Fill every slot once, against a private copy of what is available.
 *
 * The copy is what makes an application ALL-OR-NOTHING: a combo that fills two
 * of its three slots and then runs short must consume nothing at all, or the
 * buyer would be charged for a bundle they were never given.
 */
function fillOneApplication(
  slots: readonly PreparedSlot[],
  available: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): UnitTally | null {
  const left: UnitTally = new Map(available);
  const taken: UnitTally = new Map();
  for (const slot of orderSlots(slots, left, linesById)) {
    const slotTake = takeSlot(slot, left, linesById);
    if (slotTake === null) return null;
    addUnits(taken, slotTake);
    subtractUnits(left, slotTake);
  }
  return taken;
}

function tallyCents(
  units: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const [lineId, count] of units) {
    const line = linesById.get(lineId);
    if (line !== undefined) cents.set(lineId, count * Math.max(0, line.unitPriceCents));
  }
  return cents;
}

function sumValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const cents of values.values()) total += cents;
  return total;
}

/** The unit prices of one application, one entry per unit. */
function unitPricesOf(
  units: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): number[] {
  return [...units.entries()].flatMap(([lineId, count]) => {
    const line = linesById.get(lineId);
    if (line === undefined) return [];
    return Array.from({ length: count }, () => Math.max(0, line.unitPriceCents));
  });
}

/** The `FREE_UNITS` reward: the N CHEAPEST units of one application. */
function cheapestUnitsCents(
  units: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
  freeUnits: number,
): number {
  if (freeUnits <= 0) return 0;
  return unitPricesOf(units, linesById)
    .sort((a, b) => a - b)
    .slice(0, freeUnits)
    .reduce((total, cents) => total + cents, 0);
}

/**
 * What ONE application removes.
 *
 * Per application rather than per match, because that is what each reward
 * means: "R$ 5 off the combo" twice is R$ 10, and "one free" twice is two free
 * units, one from each group. Only `PERCENTAGE` would read the same either
 * way, and it goes through the same path so there is one rule to read.
 */
function applicationReward(
  rule: DiscountRule,
  units: ReadonlyMap<string, number>,
  linesById: ReadonlyMap<string, DiscountCartLine>,
): number {
  const groupCents = sumValues(tallyCents(units, linesById));
  if (groupCents <= 0) return 0;
  if (rule.type === "BUNDLE_PRICE") {
    return Math.max(0, groupCents - Math.max(0, rule.bundlePriceCents ?? 0));
  }
  if (rule.type === "FREE_UNITS") {
    return cheapestUnitsCents(units, linesById, rule.freeUnits ?? 0);
  }
  return rawAmountCents(rule, groupCents);
}

/**
 * The application ceiling.
 *
 * Bounded by the pool's own size whatever the rule says, which is what makes
 * the loop below provably terminate: every application consumes at least one
 * unit (a zero-quantity slot is refused before we get here), so there can never
 * be more applications than there are units in the cart.
 *
 * Only null/undefined mean UNCAPPED. A stored zero means "at most zero times",
 * so the combo simply does not fire — the admin surface refuses that value, and
 * a row that carries one anyway should cost the merchant a promotion nobody
 * sees rather than an uncapped giveaway nobody authorised.
 */
function applicationCap(rule: DiscountRule, pool: ComboPool): number {
  const totalUnits = sumValues(pool.unitsByLine);
  const declared = rule.maxComboApplications;
  if (declared === null || declared === undefined) return totalUnits;
  return Math.min(Math.trunc(declared), totalUnits);
}

/**
 * Match one combo rule against a pool. Null when the cart cannot fill its
 * slots even once — which the screen reports as `COMBO_NOT_MATCHED`.
 */
export function matchCombo(rule: DiscountRule, pool: ComboPool): ComboMatch | null {
  const slots = prepareSlots(rule.comboRequirements ?? []);
  if (slots.length === 0 || slots.some((slot) => slot.quantity <= 0)) return null;

  const left: UnitTally = new Map(pool.unitsByLine);
  const consumedUnits: UnitTally = new Map();
  const cap = applicationCap(rule, pool);
  let rewardCents = 0;
  let applications = 0;
  while (applications < cap) {
    const taken = fillOneApplication(slots, left, pool.linesById);
    if (taken === null) break;
    rewardCents += applicationReward(rule, taken, pool.linesById);
    addUnits(consumedUnits, taken);
    subtractUnits(left, taken);
    applications += 1;
  }
  if (applications === 0) return null;

  const consumedCentsByLine = tallyCents(consumedUnits, pool.linesById);
  return {
    applications,
    consumedUnitsByLine: consumedUnits,
    consumedCentsByLine,
    groupCents: sumValues(consumedCentsByLine),
    rewardCents,
  };
}

/**
 * R3 for a `COMBO`-scoped rule: the lines a pristine cart would let it touch.
 *
 * Answered by MATCHING rather than by intersecting target lists, because a
 * combo's coverage is not "every line it names" — a cart holding the popcorn
 * and no soda names one of the slots and covers nothing, and reporting it as
 * covered would let it through the screen only to remove zero.
 */
export function comboCoveredLineIds(
  rule: DiscountRule,
  lines: readonly DiscountCartLine[],
): ReadonlySet<string> {
  const match = matchCombo(rule, freshComboPool(lines));
  return match === null ? new Set<string>() : new Set(match.consumedUnitsByLine.keys());
}

/**
 * Whether any of a combo's slots would accept this line — the question a menu
 * card asks ("is this item part of a combo?"), which is strictly weaker than
 * whether the combo MATCHES. Used by `./combo-offer.ts`.
 */
export function comboRuleAcceptsLine(rule: DiscountRule, line: DiscountCartLine): boolean {
  return prepareSlots(rule.comboRequirements ?? []).some((slot) => slotAccepts(slot, line));
}
