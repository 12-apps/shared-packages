/**
 * The arithmetic behind `TenderSplit` — which part of a bill each picked
 * tender carries, and what the host is sent — kept free of React so it is
 * tested on its own.
 *
 * ## Two kinds of pick
 *
 * A tender the operator only TAPPED is automatic: every automatic pick takes
 * an equal share of what the typed picks leave, and the cent a division cannot
 * place goes to the one tapped last (100 → 50/50 → 33,33/33,33/33,34). A
 * tender whose amount the operator TYPED is fixed: it is never recalculated,
 * not even when it is emptied (an empty field is a typed zero), until the pick
 * is removed. That is the whole rule, and it is how an amount is said out
 * loud: "cinquenta no dinheiro, o resto no cartão".
 *
 * ## What the host is sent
 *
 * One leg per tender carrying money, in the order they were picked. The LAST
 * automatic leg goes without an amount — it is "the rest", divided by the
 * server against the total it composes, so a total that moved between this
 * screen and the write lands on that leg instead of being refused. With no
 * automatic leg every amount is named and they add up to the total exactly.
 *
 * A tender flagged `givesChange` (cash) may be typed above what the bill
 * leaves: the excess is change handed back, reported beside the legs and
 * taken off that leg, never sent as money received.
 */

/** One picked tender: `typed` is what was typed, `null` while automatic. */
export interface TenderPick<T extends string> {
  readonly tender: T;
  readonly typed: string | null;
}

/** One part of the payment. No `amountCents` means "whatever is left". */
export interface TenderSplitLeg<T extends string> {
  readonly tender: T;
  readonly amountCents?: number;
}

/** What `TenderSplit` answers with. */
export interface TenderSplitAnswer<T extends string> {
  readonly legs: readonly TenderSplitLeg<T>[];
  /** Handed back to the payer; already taken off the leg that received it. */
  readonly changeCents: number;
}

/**
 * Where the picks stand against the bill.
 *
 * - `EMPTY`: nothing picked yet.
 * - `INVALID`: a typed amount is not an amount.
 * - `SHORT`: the picks leave part of the bill unpaid.
 * - `OVER`: the picks pass the bill and no change-giving tender explains it.
 * - `READY`: the bill is covered; `answer` is set.
 */
export type TenderSplitOutcome = 'EMPTY' | 'INVALID' | 'SHORT' | 'OVER' | 'READY';

export interface TenderSplitState<T extends string> {
  /** Cents each pick carries: its typed amount, or its automatic share. */
  readonly amounts: ReadonlyMap<T, number>;
  readonly launchedCents: number;
  /** The bill minus what the picks carry — negative when they pass it. */
  readonly restCents: number;
  readonly changeCents: number;
  readonly outcome: TenderSplitOutcome;
  readonly answer: TenderSplitAnswer<T> | null;
}

/** Tap a tender: it joins as automatic. A tender already picked is kept. */
export function withPicked<T extends string>(
  picks: readonly TenderPick<T>[],
  tender: T,
): TenderPick<T>[] {
  if (picks.some((pick) => pick.tender === tender)) return [...picks];
  return [...picks, { tender, typed: null }];
}

/** Remove a tender — the one way a typed amount stops being fixed. */
export function withoutPicked<T extends string>(
  picks: readonly TenderPick<T>[],
  tender: T,
): TenderPick<T>[] {
  return picks.filter((pick) => pick.tender !== tender);
}

/** Type into a tender's field: from here on its amount is fixed. */
export function withTyped<T extends string>(
  picks: readonly TenderPick<T>[],
  tender: T,
  typed: string,
): TenderPick<T>[] {
  return picks.map((pick) => (pick.tender === tender ? { tender, typed } : pick));
}

/**
 * Typed money → whole cents; `0` for an empty field, `null` for text that is
 * not an amount.
 *
 * Reads either separator, whatever the locale: a separator followed by one or
 * two final digits is the decimal one and every other is grouping, so
 * "50", "50,5", "50.50", "1.234,56" and "1,234.56" all read as written. A
 * currency sign in front ("R$ 12,00", "$12") is ignored; a minus is refused.
 */
export function parseAmount(typed: string): number | null {
  if (typed.includes('-')) return null;
  const bare = typed.trim().replace(/^[^\d.,]+/u, '').replace(/\s/gu, '');
  if (bare === '') return typed.trim() === '' ? 0 : null;
  if (!/^[\d.,]+$/u.test(bare)) return null;
  const decimal = /[.,](\d{1,2})$/u.exec(bare);
  const whole = (decimal === null ? bare : bare.slice(0, decimal.index)).replace(/[.,]/gu, '');
  if (whole === '' && decimal === null) return null;
  const fraction = decimal === null ? '00' : decimal[1]!.padEnd(2, '0');
  return Number(whole || '0') * 100 + Number(fraction);
}

/** `pool` cents in `parts` equal shares; the leftover cents go to the last. */
export function shareEqually(pool: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(Math.max(0, pool) / parts);
  const shares = Array.from({ length: parts }, () => base);
  shares[parts - 1] = Math.max(0, pool) - base * (parts - 1);
  return shares;
}

/** Where the picks stand against a bill of `totalCents`. */
export function readTenderSplit<T extends string>(
  picks: readonly TenderPick<T>[],
  totalCents: number,
  givesChange: (tender: T) => boolean,
): TenderSplitState<T> {
  const amounts = amountsOf(picks, totalCents);
  const sum = [...amounts.values()].reduce((total, cents) => total + cents, 0);
  const restCents = totalCents - sum;
  const base = { amounts, launchedCents: Math.min(sum, totalCents), restCents };
  const outcome = outcomeOf(picks, restCents);
  if (outcome === 'SHORT' || outcome === 'EMPTY' || outcome === 'INVALID') {
    return { ...base, changeCents: 0, outcome, answer: null };
  }
  const changeFrom = outcome === 'OVER' ? changeTaker(picks, amounts, -restCents, givesChange) : null;
  if (outcome === 'OVER' && changeFrom === null) {
    return { ...base, changeCents: 0, outcome, answer: null };
  }
  const changeCents = changeFrom === null ? 0 : -restCents;
  const legs = legsOf(picks, amounts, changeFrom, changeCents);
  return { ...base, changeCents, outcome: 'READY', answer: { legs, changeCents } };
}

function amountsOf<T extends string>(
  picks: readonly TenderPick<T>[],
  totalCents: number,
): Map<T, number> {
  const typed = picks.filter((pick) => pick.typed !== null);
  const typedSum = typed.reduce((sum, pick) => sum + (parseAmount(pick.typed!) ?? 0), 0);
  const automatic = picks.filter((pick) => pick.typed === null);
  const shares = shareEqually(totalCents - typedSum, automatic.length);
  const amounts = new Map<T, number>();
  for (const pick of picks) {
    amounts.set(
      pick.tender,
      pick.typed === null ? shares[automatic.indexOf(pick)]! : parseAmount(pick.typed) ?? 0,
    );
  }
  return amounts;
}

function outcomeOf<T extends string>(
  picks: readonly TenderPick<T>[],
  restCents: number,
): TenderSplitOutcome {
  if (picks.length === 0) return 'EMPTY';
  if (picks.some((pick) => pick.typed !== null && parseAmount(pick.typed) === null)) {
    return 'INVALID';
  }
  if (restCents > 0) return 'SHORT';
  return restCents < 0 ? 'OVER' : 'READY';
}

/** The typed change-giving tender that received more than the excess. */
function changeTaker<T extends string>(
  picks: readonly TenderPick<T>[],
  amounts: ReadonlyMap<T, number>,
  excess: number,
  givesChange: (tender: T) => boolean,
): T | null {
  const taker = picks.find(
    (pick) => pick.typed !== null && givesChange(pick.tender) && amounts.get(pick.tender)! > excess,
  );
  return taker?.tender ?? null;
}

function legsOf<T extends string>(
  picks: readonly TenderPick<T>[],
  amounts: ReadonlyMap<T, number>,
  changeFrom: T | null,
  changeCents: number,
): TenderSplitLeg<T>[] {
  const carrying = picks
    .map((pick) => ({
      pick,
      cents: amounts.get(pick.tender)! - (pick.tender === changeFrom ? changeCents : 0),
    }))
    .filter((entry) => entry.cents > 0);
  const open = [...carrying].reverse().find((entry) => entry.pick.typed === null);
  return carrying.map((entry) =>
    entry === open
      ? { tender: entry.pick.tender }
      : { tender: entry.pick.tender, amountCents: entry.cents },
  );
}
