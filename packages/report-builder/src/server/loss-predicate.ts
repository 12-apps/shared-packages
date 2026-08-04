import type { StockReasonKind } from '@12-apps/stock-domain';

import type { DateWindowWhere, ReportWindow } from './adapter-shared';
import { windowWhere } from './adapter-shared';

/**
 * The canonical "this ledger row is a loss" predicate (FUT-654).
 *
 * WHY THIS EXISTS AT ALL: the `perdas` report used to read the `loss_events`
 * table, which is written by exactly ONE of the two paths that record a loss —
 * the loss captured alongside a purchase/production entry. A standalone
 * negative Ajuste, which is how losses are actually registered in practice,
 * writes a `stock_movements` row carrying `lossReasonId` and never creates a
 * `loss_event`. Measured end to end through the MCP surface: a loss registered
 * that way moved the ledger by 600 cents and moved the report by nothing, while
 * the same loss registered the other way moved the report by exactly its value.
 *
 * Reading the LEDGER instead covers both paths, which is why this predicate
 * deliberately does not mention `type`. That is not an oversight:
 *
 *  - `ADJUST` is an overloaded type. The same value carries genuine losses,
 *    internal consumption, inventory reconciliation, opening stock and
 *    accounting corrections. Selecting on it would sweep reconciliation and
 *    opening stock into the loss report — both of which carry NO
 *    `lossReasonId`, so filtering on the reason excludes them for free.
 *  - Losses recorded through the entry path land as `SPOILAGE`. A `type`
 *    filter would have to name both, and would still break the next time a
 *    path records a loss under a third type.
 *
 * SWITCH, DO NOT UNION. The entry path writes BOTH a `loss_event` and its
 * `SPOILAGE` ledger rows, so a source that unioned the table with the ledger
 * would count every loss recorded that way twice.
 *
 * @see REPORT_ENTITY_DATE_FIELD — the window still applies on `createdAt`.
 */

/**
 * The tenant + window + loss scope, as a Prisma `where` over `stock_movements`.
 *
 * Deliberately NOT exported: callers take it as `ReturnType<typeof
 * lossLedgerWhere>`. FUT-202's `onlyLosses` is meant to consume this same
 * predicate rather than restate it — export the name when that consumer lands,
 * not before (an export with no importer is what the knip gate rejects).
 */
interface LossLedgerWhere {
  clientId: string;
  /**
   * Cancelled rows are not losses. This is the half of the fix that the old
   * source could not express at all: `loss_events` has no cancellation column,
   * so cancelling a loss reversed the stock and left the report still counting
   * it. Measured: cancelling the movement left the report unchanged at 5740.
   */
  canceledAt: null;
  createdAt: DateWindowWhere;
  /** A loss removes stock. Positive rows are receipts and surpluses. */
  quantityDelta: { lt: number };
  /**
   * Attributed to the gain/loss taxonomy. Negative rows WITHOUT a reason are
   * reconciliation, opening stock, sales and recipe consumption — plus a
   * handful of genuine but unattributed write-offs, which is why the caller
   * should surface a count of them rather than let the total look complete.
   */
  lossReasonId: { not: null };
}

/** Build {@link LossLedgerWhere} for one tenant and reporting window. */
export function lossLedgerWhere(clientId: string, window: ReportWindow): LossLedgerWhere {
  return {
    clientId,
    canceledAt: null,
    createdAt: windowWhere(window),
    quantityDelta: { lt: 0 },
    lossReasonId: { not: null },
  };
}

/**
 * The taxonomy axis a loss must sit on.
 *
 * `lossReasonId != null` does NOT mean loss: the same taxonomy models surpluses
 * ("Encontrei" is `kind: GAIN`), because a positive Ajuste has to be attributed
 * too. Without this filter a found surplus is reported as a loss and the number
 * lies. `StockMovement` has no relation to `LossReason` — only a scalar FK — so
 * this cannot ride in the `where` and is applied after resolving the reasons.
 */
const LOSS_REASON_KIND: StockReasonKind = 'LOSS';

/** Whether a resolved taxonomy row marks its movements as real losses. */
export function isLossReason(reason: { kind: string } | undefined): boolean {
  return reason?.kind === LOSS_REASON_KIND;
}
