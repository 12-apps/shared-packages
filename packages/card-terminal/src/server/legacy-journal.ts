import { MOVE_ATTEMPTS, REFUSALS, versionOf } from './decisions';
import { CaptureError, traceColumns, type RecordCaptureInput, type TerminalCaptureRecord } from './model';
import type { CapturePatch, TerminalCaptureStore } from './ports';

/**
 * Legacy `JOURNAL` rows: captures a host kept from a cashier-typed code before
 * this package existed. The package never writes one; it only lets the
 * terminal's report fill them, because the terminal is the payment truth.
 */

/** A legacy `JOURNAL` row still without the trace a terminal report brings. */
export function awaitsItsReport(row: TerminalCaptureRecord): boolean {
  return row.source === 'JOURNAL' && row.transactionId === null && row.authorizationCode === null && row.terminalSerial === null;
}

/**
 * The terminal's report fills a legacy row's trace, and the report is the
 * truth. When it names another kind or amount than the cashier kept, it is
 * never refused as a conflict (the terminal's outbox would drop it and an
 * overcharge would vanish): the row takes the report's kind and amount and is
 * flagged `JOURNAL_CONFLICT`, so a person reconciles the sale with what the
 * terminal charged. Otherwise its state, sale and flag stay as they are.
 *
 * The write lands only while the row still awaits its report, so of two racing
 * reports only the first fills it; the other re-reads and is judged against
 * the filled row like any repeated report (equal: answered, else `CONFLICT`).
 * A report that carries none of `transactionId`, `authorizationCode` and
 * `terminalSerial` leaves the row awaiting, so a later contradicting report
 * may flag it again.
 */
export async function fillLegacyTrace(
  store: TerminalCaptureStore,
  input: RecordCaptureInput,
  now: Date,
): Promise<TerminalCaptureRecord> {
  for (let attempt = 0; attempt < MOVE_ATTEMPTS; attempt += 1) {
    const current = await store.find(input.clientId, input.transactionCode);
    if (!current) throw new CaptureError('NOT_FOUND', input.transactionCode, REFUSALS.NOT_FOUND);
    if (!awaitsItsReport(current)) return judgedAsRepeat(current, input);
    if (await store.writeIfUnchanged({ ...versionOf(current), awaitingReport: true }, reportPatch(current, input, now))) {
      const after = await store.find(input.clientId, input.transactionCode);
      if (after) return after;
    }
  }
  throw new CaptureError('CONTENDED', input.transactionCode, REFUSALS.CONTENDED);
}

/** A row already filled: the same report is answered, another one refused. */
function judgedAsRepeat(current: TerminalCaptureRecord, input: RecordCaptureInput): TerminalCaptureRecord {
  if (current.amountCents !== input.amountCents || current.kind !== input.kind) {
    throw new CaptureError('CONFLICT', input.transactionCode, 'This transaction code was already recorded with another amount or kind.');
  }
  return current;
}

/** The report's trace and terminal, and its kind and amount with the flag when it contradicts the row. */
function reportPatch(current: TerminalCaptureRecord, input: RecordCaptureInput, now: Date): CapturePatch {
  const contradicts = current.kind !== input.kind || current.amountCents !== input.amountCents;
  return {
    ...traceColumns(input),
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...(contradicts
      ? { kind: input.kind, amountCents: input.amountCents, refundFlaggedAt: now, refundReason: 'JOURNAL_CONFLICT', refundClearedAt: null }
      : {}),
  };
}
