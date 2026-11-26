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
 * it did not bind — the host then reads the capture and asks
 * {@link explainUnbound} why (a replay of this very bind, or the refusal), on
 * the path where nothing was settled.
 *
 * The record of the capture is NOT part of it: a data-modifying CTE does not
 * see a row a sibling CTE inserts, so the capture is recorded before the claim
 * (`ledger.record` / `recordFromDevice`, idempotent per code), as every other
 * transport records it.
 *
 * Host-agnostic: no database client, no host table name beyond the one the
 * Prisma store documents (`terminal_captures`, overridable). The host passes a
 * `param` callback that binds a value and answers its placeholder (`$3`, `?`),
 * and the payment row as an SQL expression of its own claim (`(SELECT id FROM
 * paid)`). Postgres syntax.
 */

/** Binds a value in the host's statement and answers its placeholder. */
export type SqlParam = (value: string | number | Date | null) => string;

export interface CaptureBindSqlInput {
  clientId: string;
  transactionCode: string;
  /** The sale the payment row belongs to. */
  orderId: string;
  /** The payment row's id as an SQL expression of the host's statement — a placeholder, or `(SELECT id FROM paid)`. */
  paymentIdSql: string;
  /** When it binds: the timeout flag it clears is stamped cleared at this instant. */
  now: Date;
  param: SqlParam;
}

export interface CaptureBindSqlOptions {
  /** The capture table. Default `terminal_captures` (the Prisma store's). */
  table?: string;
  /** The table maps `hold_key` (`{ holds: true }` on the Prisma store): a held capture binds only to its hold. Default false. */
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

/**
 * `UPDATE … SET state = 'BOUND' … WHERE <the bind's decision> RETURNING …` for
 * one capture of one sale. Compose it as a CTE of the claim, in the claim's
 * transaction, AFTER the payment row exists in the same statement.
 */
export function captureBindSql(input: CaptureBindSqlInput, options: CaptureBindSqlOptions = {}): CaptureBindSql {
  const table = quoted(options.table ?? 'terminal_captures');
  const p = input.param;
  const order = p(input.orderId);
  const now = p(input.now);
  const sets = [
    `"state" = 'BOUND'`,
    `"order_id" = ${order}`,
    `"payment_id" = ${input.paymentIdSql}`,
    // A live UNBOUND_TIMEOUT flag is the only one a bind may pass, and it clears it (bindDecision's clearFlag).
    `"refund_cleared_at" = CASE WHEN c."refund_flagged_at" IS NOT NULL AND c."refund_cleared_at" IS NULL THEN ${now} ELSE c."refund_cleared_at" END`,
    ...(options.holds ? [`"hold_key" = NULL`] : []),
    ...(options.updatedAt === false ? [] : [`"updated_at" = ${now}`]),
  ];
  const where = [
    `c."client_id" = ${p(input.clientId)}`,
    `c."transaction_code" = ${p(input.transactionCode)}`,
    `c."state" IN ('UNBOUND', 'ORDER_CREATED')`,
    `(c."order_id" IS NULL OR c."order_id" = ${order})`,
    `(c."refund_flagged_at" IS NULL OR c."refund_cleared_at" IS NOT NULL OR c."refund_reason" = 'UNBOUND_TIMEOUT')`,
    ...(options.holds ? [`c."hold_key" IS NULL`] : []),
  ];
  return {
    text: `UPDATE ${table} AS c SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING c."transaction_code", c."kind", c."amount_cents"`,
    returns: ['transaction_code', 'kind', 'amount_cents'],
  };
}

/**
 * Why {@link captureBindSql} bound nothing, read off the capture after the
 * claim: `"replay"` when it is already BOUND to this sale's payment (the other
 * transport, or a resend, won), or the refusal code the ledger's bind gives.
 * `"missing"` when the capture was never recorded.
 */
export function explainUnbound(current: TerminalCaptureRecord | null, target: BindTarget): 'replay' | 'missing' | CaptureErrorCode {
  if (current === null) return 'missing';
  const decision = bindDecision(current, target);
  // The statement's predicate says yes where the decision does; a row it skipped yet the decision admits was moved under it.
  return typeof decision === 'object' ? 'CONTENDED' : decision;
}
