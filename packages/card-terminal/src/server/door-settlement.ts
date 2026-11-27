/**
 * What ONE capture taken for a sale with no till behind it means for that
 * sale (FUT-3764): a charge at the door, where nobody can hand change back
 * in cash or post a credit at a register. Pure and caller-driven, like
 * `./capture-excess.ts`, whose `CHANGE` and `STORE_CREDIT` choices both need
 * a till session or a buyer wallet a door charge does not have.
 *
 * - `EXACT`: the capture is the due. Settle the sale at the due, bound to it.
 * - `SHORT`: the capture is below the due. The money is real and stays bound
 *   to the sale's payment row at what was captured; the CALLER parks the sale
 *   short (its own "short paid" state) for a person to collect the rest.
 * - `EXCESS`: the capture is above the due. Settle the sale at the due, bound
 *   to it, and the CALLER records `excessCents` of that capture as owed back
 *   to the card (its own refund queue and audit), never cut from the capture:
 *   the capture is the money truth.
 *
 * Nothing here writes. The bind is the ledger's (`bind`, or
 * `captureBindSql` inside the caller's claim). A capture is at least one
 * cent; a sale may owe nothing (all of the capture is then excess).
 */

export interface DoorCapture {
  transactionCode: string;
  amountCents: number;
}

/**
 * One shape for every kind: what the sale's payment row records, what is still
 * owed (SHORT), and what is owed back on that capture (EXCESS) — zero where
 * the kind has none.
 */
export interface DoorSettlement {
  kind: 'EXACT' | 'SHORT' | 'EXCESS';
  transactionCode: string;
  settleCents: number;
  shortCents: number;
  excessCents: number;
}

function cents(name: string, value: number, least: number): number {
  if (!Number.isSafeInteger(value) || value < least) throw new RangeError(`${name} must be an integer of cents of at least ${least}, got ${value}`);
  return value;
}

/**
 * The door settlement of `capture` against `dueCents`. `settleCents` is what
 * the sale's payment row records: what was captured when it is short, the due
 * otherwise.
 */
export function planDoorSettlement(capture: DoorCapture, dueCents: number): DoorSettlement {
  // A capture is money taken: at least one cent. A sale may owe nothing (an undone debt), then it is all excess.
  const captured = cents('amountCents', capture.amountCents, 1);
  const due = cents('dueCents', dueCents, 0);
  const base = { transactionCode: capture.transactionCode, shortCents: 0, excessCents: 0 };
  if (captured === due) return { ...base, kind: 'EXACT', settleCents: due };
  if (captured < due) return { ...base, kind: 'SHORT', settleCents: captured, shortCents: due - captured };
  return { ...base, kind: 'EXCESS', settleCents: due, excessCents: captured - due };
}
