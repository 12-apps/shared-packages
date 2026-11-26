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
 * `captureBindSql` inside the caller's claim).
 */

export interface DoorCapture {
  transactionCode: string;
  amountCents: number;
}

export type DoorSettlement =
  | { kind: 'EXACT'; settleCents: number }
  | { kind: 'SHORT'; settleCents: number; shortCents: number }
  | { kind: 'EXCESS'; settleCents: number; excess: { transactionCode: string; excessCents: number } };

function cents(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer of cents, got ${value}`);
  return value;
}

/**
 * The door settlement of `capture` against `dueCents`. `settleCents` is what
 * the sale's payment row records: what was captured when it is short, the due
 * otherwise.
 */
export function planDoorSettlement(capture: DoorCapture, dueCents: number): DoorSettlement {
  const captured = cents('amountCents', capture.amountCents);
  const due = cents('dueCents', dueCents);
  if (captured === due) return { kind: 'EXACT', settleCents: due };
  if (captured < due) return { kind: 'SHORT', settleCents: captured, shortCents: due - captured };
  return { kind: 'EXCESS', settleCents: due, excess: { transactionCode: capture.transactionCode, excessCents: captured - due } };
}
