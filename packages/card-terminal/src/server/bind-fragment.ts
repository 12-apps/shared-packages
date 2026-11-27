import { bindDecision } from './decisions';
import type { BindTarget, CaptureErrorCode, TerminalCaptureRecord } from './model';

/**
 * The bind of one capture to a sale's payment row as ONE SQL statement the
 * host composes into its own claim (ADR 0344's binding, FUT-3764).
 *
 * `bind` (`./ledger.ts`) reads the capture, decides, and writes a
 * compare-and-set: two to four statements per capture, each a round trip. A
 * host that settles a sale in a single claim statement (a CTE that inserts the
 * payment row and flips the sale) cannot fit those in. This module states the
 * SAME decision ({@link bindDecision}) as the predicate of one `UPDATE`, so
 * the host appends it to its claim as a data-modifying CTE:
 *
 * ```sql
 * WITH paid AS (INSERT INTO payments … RETURNING id),
 *      bound AS (<captureBindSql(…).text>)
 * SELECT (SELECT count(*) FROM bound) AS bound …
 * ```
 *
 * The statement binds the capture only when the ledger's bind would: the
 * capture is the tenant's, UNBOUND or created for THIS sale, not held for
 * another, and not owed back (a live timeout flag is cleared, as the bind
 * clears it). It returns the bound row's code, kind and amount; no row means
 * it did not bind: the caller rolls its claim back, then reads the capture
 * and asks {@link explainUnbound} why (a replay of this very bind, or the
 * refusal).
 *
 * The record of the capture is NOT part of it: a data-modifying CTE does not
 * see a row a sibling CTE inserts, so the capture is recorded before the claim
 * (`ledger.record` / `recordFromDevice`, idempotent per code), as every other
 * transport records it.
 *
 * The ledger's SALE_MISMATCH guard (`SaleDirectory.paymentBelongs`) becomes
 * the caller's `saleGuardSql`, a REQUIRED predicate over its own claim, so the
 * payment row is tied to the sale and the tenant in the same statement.
 *
 * Host-agnostic: no database client, no host table name beyond the one the
 * Prisma store documents (`terminal_captures`, overridable). The host passes a
 * `param` callback that binds a value and answers its placeholder (`$3`, `?`;
 * called once per use), and the payment row as an SQL expression of its own
 * claim (`(SELECT id FROM paid)`). Postgres syntax.
 */

/**
 * Binds ONE value in the caller's statement and answers its placeholder. It
 * is called once per use — a value the statement needs twice is bound twice —
 * so numbered (`$3`) and positional (`?`) placeholders both line up.
 */
export type SqlParam = (value: string | number | Date | null) => string;

export interface CaptureBindSqlInput {
  clientId: string;
  transactionCode: string;
  /** The sale the payment row belongs to. */
  orderId: string;
  /**
   * The payment row's id as an SQL expression of the caller's statement: a
   * placeholder from `param`, or a CTE reference (`(SELECT id FROM paid)`).
   * Spliced into the statement as written, so it is NEVER built from input,
   * and with positional (`?`) placeholders it carries none of its own.
   * A NULL (the caller's insert returned no row: `ON CONFLICT DO NOTHING`, a
   * guarded insert that lost) binds nothing.
   */
  paymentIdSql: string;
  /**
   * REQUIRED, and the caller's obligation: a predicate of the caller's
   * statement that is true only when that payment row belongs to `orderId` at
   * `clientId` — the guard `ledger.bind` asks `SaleDirectory.paymentBelongs`
   * for (SALE_MISMATCH). Typically `EXISTS (SELECT 1 FROM paid WHERE …)` over
   * the caller's own insert. Never built from input (and, with positional
   * placeholders, carrying none of its own). When it is false nothing is bound.
   */
  saleGuardSql: string;
  /**
   * The sale context the capture may be held for (`ledger.hold`): a capture
   * held for THIS context binds, as `bindDecision` admits it; one held for
   * another never does. Only read with `{ holds: true }`.
   */
  holdKey?: string;
  /** When it binds: the timeout flag it clears is stamped cleared at this instant. */
  now: Date;
  param: SqlParam;
}

export interface CaptureBindSqlOptions {
  /** The capture table. Default `terminal_captures` (the Prisma store's). */
  table?: string;
  /**
   * The table maps `hold_key` (`{ holds: true }` on the Prisma store): a held
   * capture binds only to its own hold (`holdKey`). Default false — and a
   * table without the column must leave it false.
   */
  holds?: boolean;
  /** The table has an `updated_at` the statement must stamp (Prisma's `@updatedAt` is client-side). Default true. */
  updatedAt?: boolean;
}

/** One SQL statement: its text (placeholders from `param`) and the columns it returns. */
export interface CaptureBindSql {
  text: string;
  /** What `RETURNING` answers for a bound capture. */
  returns: readonly ['transaction_code', 'kind', 'amount_cents'];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function quoted(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Not a table name: ${name}`);
  return `"${name}"`;
}

/** The SET list: every value bound at its own use. */
function setsOf(input: CaptureBindSqlInput, options: CaptureBindSqlOptions): string[] {
  const p = input.param;
  return [
    `"state" = 'BOUND'`,
    `"order_id" = ${p(input.orderId)}`,
    `"payment_id" = ${input.paymentIdSql}`,
    // A live UNBOUND_TIMEOUT flag is the only one a bind may pass, and it clears it (bindDecision's clearFlag).
    `"refund_cleared_at" = CASE WHEN c."refund_flagged_at" IS NOT NULL AND c."refund_cleared_at" IS NULL THEN ${p(input.now)} ELSE c."refund_cleared_at" END`,
    // A bind releases the hold it was held under (the ledger's releaseHold).
    ...(options.holds ? [`"hold_key" = NULL`] : []),
    ...(options.updatedAt === false ? [] : [`"updated_at" = ${p(input.now)}`]),
  ];
}

/** The WHERE list: the ledger's bind decision, the caller's sale guard, and a payment that exists. */
function predicatesOf(input: CaptureBindSqlInput, options: CaptureBindSqlOptions): string[] {
  const p = input.param;
  // Every `p(...)` runs in the order its placeholder appears in the text (positional `?` placeholders).
  const hold = (): string => (input.holdKey === undefined ? `c."hold_key" IS NULL` : `(c."hold_key" IS NULL OR c."hold_key" = ${p(input.holdKey)})`);
  return [
    `c."client_id" = ${p(input.clientId)}`,
    `c."transaction_code" = ${p(input.transactionCode)}`,
    `c."state" IN ('UNBOUND', 'ORDER_CREATED')`,
    `(c."order_id" IS NULL OR c."order_id" = ${p(input.orderId)})`,
    `(c."refund_flagged_at" IS NULL OR c."refund_cleared_at" IS NOT NULL OR c."refund_reason" = 'UNBOUND_TIMEOUT')`,
    ...(options.holds ? [hold()] : []),
    `${input.paymentIdSql} IS NOT NULL`,
    `(${input.saleGuardSql})`,
  ];
}

/**
 * `UPDATE … SET state = 'BOUND' … WHERE <the bind's decision> RETURNING …` for
 * one capture of one sale. Compose it as a CTE of the claim, in the claim's
 * transaction, AFTER the payment row exists in the same statement.
 *
 * ZERO rows returned means nothing was bound, and the caller MUST roll back
 * (or throw out of) its claim: the payment insert and the sale's flip in the
 * sibling CTEs were written by the same statement.
 */
export function captureBindSql(input: CaptureBindSqlInput, options: CaptureBindSqlOptions = {}): CaptureBindSql {
  const table = quoted(options.table ?? 'terminal_captures');
  // Each part is built in the order it appears in the text, so positional placeholders line up.
  const sets = setsOf(input, options);
  const where = predicatesOf(input, options);
  return {
    text: `UPDATE ${table} AS c SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING c."transaction_code", c."kind", c."amount_cents"`,
    returns: ['transaction_code', 'kind', 'amount_cents'],
  };
}

/**
 * Why {@link captureBindSql} bound nothing, read off the capture after the
 * claim: `"replay"` when it is already BOUND to this sale's payment (the other
 * transport, or a resend, won), or the refusal code the ledger's bind gives.
 * `"missing"` when the capture was never recorded. A replay is recognised only
 * when `target.paymentId` is the ORIGINAL payment row's id (the one the first
 * bind wrote), not a fresh id minted by the resend.
 */
export function explainUnbound(current: TerminalCaptureRecord | null, target: BindTarget): 'replay' | 'missing' | CaptureErrorCode {
  if (current === null) return 'missing';
  const decision = bindDecision(current, target);
  // The statement's predicate says yes where the decision does; a row it skipped yet the decision admits was moved under it.
  return typeof decision === 'object' ? 'CONTENDED' : decision;
}
