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
 * One leg per tender carrying money, in the order they were picked. The OPEN
 * leg — the last automatic pick — goes without an amount: it is "the rest",
 * divided by the server against the total it composes, so a total that moved
 * between this screen and the write lands on that leg instead of being
 * refused. With no automatic leg every amount is named and they add up to the
 * total exactly.
 *
 * A tender flagged `givesChange` (cash) may be typed above what the bill
 * leaves: the excess is change handed back, reported beside the legs and
 * taken off that leg, never sent as money received.
 *
 * ## A tender with its own price, pro rata (FUT-4416)
 *
 * A host may price the bill per tender (a discount for Pix or cash): `priceOf`
 * answers what the WHOLE bill costs in that tender, `P`, against the bill's
 * full price `T`. A pick then covers a share of `T` and pays that share at its
 * tender's price:
 *
 * - a typed amount `A` covers `A × T / P` of the bill (unrounded);
 * - the automatic picks share what the typed ones leave, equally, in whole
 *   cents of coverage; each but the open one pays `round(share × P / T)`;
 * - THE OPEN LEG TAKES THE REMAINDER: it pays
 *   `round((T − Σ amountᵢ × T / Pᵢ) × P_open / T)`, the sum over every other
 *   leg as SENT (rounded amounts). This is the rule a server mirrors to price
 *   the leg it is sent without an amount, so the screen's total — the legs'
 *   sum, `dueCents` — is exactly the total the server derives;
 * - what is still missing is said at the last tender's price;
 * - a typed cash tender gives change only when it covers more of the bill
 *   than the excess, and the change is that excess at the CASH price. A
 *   non-cash tender typed above its own price explains nothing: the split is
 *   OVER, and no leg is ever dropped to make it fit.
 *
 * Without `priceOf`, with a bill of zero, or with every tender at the full
 * price, every figure is exactly what it was.
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
  /** The bill at the picks' prices (FUT-4416) — only when the tenders are priced. */
  readonly dueCents?: number;
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
  /**
   * What the bill comes to at the picks' prices (FUT-4416): what they carry
   * less the change, plus what is still missing. The bill itself when the
   * tenders are not priced.
   */
  readonly dueCents: number;
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
  shown = '',
): TenderPick<T>[] {
  return picks.map((pick) =>
    pick.tender === tender ? { tender, typed: firstTyping(pick, typed, shown) } : pick,
  );
}

/**
 * What an automatic card's field holds once the operator types into it.
 *
 * The field shows the card's share and selects it on focus, so a keystroke
 * replaces it. Where the selection does not take (iOS Safari), the keystroke
 * lands after the share instead — "41,00" + "5" → "41,005" — so on that FIRST
 * edit the share still sitting in front of the new characters is dropped.
 * `shown` is the share as the field displayed it.
 */
function firstTyping<T extends string>(pick: TenderPick<T>, typed: string, shown: string): string {
  if (pick.typed !== null || shown === '' || typed === shown) return typed;
  return typed.startsWith(shown) ? typed.slice(shown.length) : typed;
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
  return /^[\d.,]+$/u.test(bare) ? centsOf(bare) : null;
}

/** Digits and separators → cents, or `null` when they are not an amount. */
function centsOf(typed: string): number | null {
  // A separator typed last is a decimal on its way ("50," while typing "50,50").
  const bare = typed.replace(/[.,]$/u, '');
  const decimal = /[.,](\d{1,2})$/u.exec(bare);
  const whole = wholeUnits(decimal === null ? bare : bare.slice(0, decimal.index));
  if (whole === null || (whole === '' && decimal === null)) return null;
  const fraction = decimal === null ? '00' : decimal[1]!.padEnd(2, '0');
  return Number(whole || '0') * 100 + Number(fraction);
}

/** The digits before the decimal separator; grouping only in threes, so "1,2,3" is refused. */
function wholeUnits(grouped: string): string | null {
  if (!/^(\d+|\d{1,3}([.,]\d{3})+)?$/u.test(grouped)) return null;
  return grouped.replace(/[.,]/gu, '');
}

/** `pool` cents in `parts` equal shares; the leftover cents go to the last. */
export function shareEqually(pool: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(Math.max(0, pool) / parts);
  const shares = Array.from({ length: parts }, () => base);
  shares[parts - 1] = Math.max(0, pool) - base * (parts - 1);
  return shares;
}

/** What the whole bill costs in one tender — the full bill when unpriced or priced unusably. */
type BillPrice<T extends string> = (tender: T) => number;

function billPrice<T extends string>(totalCents: number, priceOf: ((tender: T) => number) | undefined): BillPrice<T> {
  // A bill of zero has nothing to price: every share of it is zero at any price.
  if (!priceOf || totalCents <= 0) return () => totalCents;
  return (tender) => {
    const price = priceOf(tender);
    return Number.isInteger(price) && price > 0 ? price : totalCents;
  };
}

/** `cents` of the bill at one price, said at another — exact when the two are the same. */
function rescale(cents: number, from: number, to: number): number {
  return from === to ? cents : (cents * to) / from;
}

/**
 * Where the picks stand against a bill of `totalCents` — at the tenders' own
 * prices when `priceOf` gives them (see "A tender with its own price").
 */
export function readTenderSplit<T extends string>(
  picks: readonly TenderPick<T>[],
  totalCents: number,
  givesChange: (tender: T) => boolean,
  priceOf?: (tender: T) => number,
): TenderSplitState<T> {
  const priced = priceOf !== undefined && totalCents > 0;
  const price = billPrice(totalCents, priced ? priceOf : undefined);
  const { amounts, covered, open } = amountsOf(picks, totalCents, price);
  const sum = [...amounts.values()].reduce((total, cents) => total + cents, 0);
  const { changeFrom, restCents } = restOf(picks, amounts, { covered, totalCents, price, givesChange });
  const outcome = outcomeOf(picks, restCents);
  if (!settles(outcome, changeFrom)) return unsettled({ amounts, restCents, outcome }, sum);
  // Settled over the bill only through a cash tender's change.
  const changeCents = outcome === 'OVER' ? -restCents : 0;
  const dueCents = sum - changeCents;
  const legs = legsOf(picks, amounts, open, changeCents > 0 ? changeFrom : null, changeCents);
  const answer = { legs, changeCents, ...(priced ? { dueCents } : {}) };
  return { amounts, launchedCents: Math.min(sum, dueCents), restCents, changeCents, dueCents, outcome: 'READY', answer };
}

/**
 * What the picks leave of the bill, in money, and the cash tender that gives
 * change for an excess: the excess is measured in coverage of the full price,
 * and the rest is said at the cash price when cash gives change, else at the
 * last tender's.
 */
function restOf<T extends string>(
  picks: readonly TenderPick<T>[],
  amounts: ReadonlyMap<T, number>,
  bill: { covered: number; totalCents: number; price: BillPrice<T>; givesChange: (tender: T) => boolean },
): { changeFrom: T | null; restCents: number } {
  const { covered, totalCents, price } = bill;
  const coverOf = (tender: T, cents: number): number => rescale(cents, price(tender), totalCents);
  const excess = covered - totalCents;
  const changeFrom = excess > 0 ? changeTaker(picks, amounts, excess, bill.givesChange, coverOf) : null;
  const reference = changeFrom ?? picks[picks.length - 1]?.tender;
  const at = reference === undefined ? totalCents : price(reference);
  return { changeFrom, restCents: Math.round(rescale(totalCents - covered, totalCents, at)) };
}

/** The picks answer the bill: covered exactly, or over it with a cash tender to give the change. */
function settles<T extends string>(outcome: TenderSplitOutcome, changeFrom: T | null): boolean {
  return outcome === 'READY' || (outcome === 'OVER' && changeFrom !== null);
}

/** A state with no answer: the picks carry `sum`, and what is missing is still owed. */
function unsettled<T extends string>(
  settled: { amounts: ReadonlyMap<T, number>; restCents: number; outcome: TenderSplitOutcome },
  sum: number,
): TenderSplitState<T> {
  const dueCents = sum + settled.restCents;
  const { amounts, restCents, outcome } = settled;
  return { amounts, launchedCents: Math.min(sum, dueCents), restCents, changeCents: 0, dueCents, outcome, answer: null };
}

/**
 * The money each pick carries, how much of the bill's full price they cover
 * between them, and the open leg (the last automatic pick). A typed amount
 * covers its share at its tender's price; the automatic picks share the rest
 * equally, each paying its share at its own price — and the open one pays the
 * remainder against the others' amounts as sent, as the server prices it.
 */
function amountsOf<T extends string>(
  picks: readonly TenderPick<T>[],
  totalCents: number,
  price: BillPrice<T>,
): { amounts: Map<T, number>; covered: number; open: T | null } {
  const coverOf = (tender: T, cents: number): number => rescale(cents, price(tender), totalCents);
  const typedCover = picks
    .filter((pick) => pick.typed !== null)
    .reduce((sum, pick) => sum + coverOf(pick.tender, parseAmount(pick.typed!) ?? 0), 0);
  const automatic = picks.filter((pick) => pick.typed === null);
  const shares = shareEqually(Math.round(totalCents - typedCover), automatic.length);
  const open = automatic[automatic.length - 1] ?? null;
  // Every pick takes its place first, so the map keeps the order they were picked.
  const amounts = new Map<T, number>(picks.map((pick) => [pick.tender, 0]));
  let fixed = typedCover;
  for (const pick of picks) {
    if (pick === open) continue;
    const cents = pick.typed === null ? Math.round(rescale(shares[automatic.indexOf(pick)]!, totalCents, price(pick.tender))) : parseAmount(pick.typed) ?? 0;
    amounts.set(pick.tender, cents);
    if (pick.typed === null) fixed += coverOf(pick.tender, cents);
  }
  if (open === null) return { amounts, covered: fixed, open: null };
  const remainder = Math.max(0, Math.round(rescale(totalCents - fixed, totalCents, price(open.tender))));
  amounts.set(open.tender, remainder);
  return { amounts, covered: fixed + coverOf(open.tender, remainder), open: open.tender };
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

/**
 * The typed change-giving tender that covers more of the bill than the
 * excess — measured in coverage of the full price, so a cash leg is judged at
 * the cash price whatever tender was picked last.
 */
function changeTaker<T extends string>(
  picks: readonly TenderPick<T>[],
  amounts: ReadonlyMap<T, number>,
  excess: number,
  givesChange: (tender: T) => boolean,
  coverOf: (tender: T, cents: number) => number,
): T | null {
  const taker = picks.find(
    (pick) => pick.typed !== null && givesChange(pick.tender) && coverOf(pick.tender, amounts.get(pick.tender)!) > excess,
  );
  return taker?.tender ?? null;
}

function legsOf<T extends string>(
  picks: readonly TenderPick<T>[],
  amounts: ReadonlyMap<T, number>,
  open: T | null,
  changeFrom: T | null,
  changeCents: number,
): TenderSplitLeg<T>[] {
  const carrying = picks
    .map((pick) => ({
      pick,
      cents: amounts.get(pick.tender)! - (pick.tender === changeFrom ? changeCents : 0),
    }))
    .filter((entry) => entry.cents > 0);
  // A bill of zero leaves every tender carrying nothing; the last one tapped
  // still answers, as "the rest" of nothing, which a server accepts.
  if (carrying.length === 0) return [{ tender: picks[picks.length - 1]!.tender }];
  // The open leg is the last automatic pick, the one whose amount is the remainder.
  return carrying.map((entry) =>
    entry.pick.tender === open
      ? { tender: entry.pick.tender }
      : { tender: entry.pick.tender, amountCents: entry.cents },
  );
}
