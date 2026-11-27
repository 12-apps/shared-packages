import { PGlite } from '@electric-sql/pglite';

import { captureBindSql, type SqlParam } from '../../server/bind-fragment';
import type { TerminalCaptureRecord } from '../../server/model';

/**
 * A PGlite engine holding the two tables the bind fragment runs against, with
 * the raw SQL its tests need kept here, beside them (FUT-3764).
 */

export const NOW = new Date('2026-11-26T20:00:00.000Z');

export interface Seed {
  code: string;
  state?: string;
  orderId?: string;
  paymentId?: string;
  holdKey?: string;
  flagged?: string;
  cleared?: boolean;
  client?: string;
}

export interface ClaimOptions {
  /** The sale context the claim binds under (a held capture binds only to its own). */
  holdKey?: string;
  /** The payment row is inserted for this sale instead: the caller's sale guard must refuse it. */
  paidForOrder?: string;
  /** The insert lost its race (`ON CONFLICT DO NOTHING`) and returns no row. */
  conflict?: boolean;
  /** Replaces the sale guard (TRUE: prove a predicate holds on its own, not through the guard). */
  saleGuardSql?: string;
}

export interface BindDb {
  seed(rows: readonly Seed[]): Promise<void>;
  /** The bind composed beside the payment insert, as a host's claim would: the codes it bound. */
  claim(code: string, orderId: string, paymentId: string, options?: ClaimOptions): Promise<string[]>;
  read(code: string): Promise<TerminalCaptureRecord>;
  clearPayments(): Promise<void>;
  /** Empties both tables: the state a freshly opened engine starts from, at a fraction of a boot's cost. */
  reset(): Promise<void>;
  /** Runs a statement written with `?` placeholders, numbered left to right as a positional driver binds them. */
  runPositional(text: string, values: readonly unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

/** A `param` that numbers placeholders and collects their values. */
function numberedParams(): { param: SqlParam; values: unknown[] } {
  const values: unknown[] = [];
  return {
    values,
    param: (value) => {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

/** A `param` that writes `?` and collects the values in text order. */
export function positionalParams(): { param: SqlParam; values: unknown[] } {
  const values: unknown[] = [];
  return {
    values,
    param: (value) => {
      values.push(value);
      return '?';
    },
  };
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const instant = (value: unknown): Date | null => (value === null || value === undefined ? null : new Date(value as string));

export async function openBindDb(): Promise<BindDb> {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE terminal_captures (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, transaction_code TEXT NOT NULL, kind TEXT NOT NULL,
      amount_cents INT NOT NULL, state TEXT NOT NULL, order_id TEXT, payment_id TEXT, hold_key TEXT,
      refund_flagged_at TIMESTAMPTZ, refund_reason TEXT, refund_cleared_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
      UNIQUE (client_id, transaction_code));
    CREATE TABLE payments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE);
  `);

  async function seed(rows: readonly Seed[]): Promise<void> {
    for (const row of rows) {
      await db.query(
        `INSERT INTO terminal_captures (id, client_id, transaction_code, kind, amount_cents, state, order_id, payment_id, hold_key,
           refund_flagged_at, refund_reason, refund_cleared_at)
         VALUES ($1, $2, $3, 'CREDIT', 8990, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.code,
          row.client ?? 't',
          row.code,
          row.state ?? 'UNBOUND',
          row.orderId ?? null,
          row.paymentId ?? null,
          row.holdKey ?? null,
          row.flagged ? NOW : null,
          row.flagged ?? null,
          row.cleared ? NOW : null,
        ],
      );
    }
  }

  async function claim(code: string, orderId: string, paymentId: string, options: ClaimOptions = {}): Promise<string[]> {
    const { param, values } = numberedParams();
    const paymentParam = param(paymentId);
    const paidOrderParam = param(options.paidForOrder ?? orderId);
    const insert = `INSERT INTO payments (id, order_id) VALUES (${paymentParam}, ${paidOrderParam})${options.conflict ? ' ON CONFLICT (order_id) DO NOTHING' : ''} RETURNING id, order_id`;
    // The guard's own placeholder is taken where it appears in the text: after the bind's.
    const bind = captureBindSql(
      {
        clientId: 't',
        transactionCode: code,
        orderId,
        paymentIdSql: '(SELECT id FROM paid)',
        saleGuardSql: options.saleGuardSql ?? `EXISTS (SELECT 1 FROM paid WHERE paid.order_id = ${param(orderId)})`,
        ...(options.holdKey === undefined ? {} : { holdKey: options.holdKey }),
        now: NOW,
        param,
      },
      { holds: true },
    );
    const result = await db.query<{ transaction_code: string }>(`WITH paid AS (${insert}), bound AS (${bind.text}) SELECT transaction_code FROM bound`, values);
    return result.rows.map((row) => row.transaction_code);
  }

  async function read(code: string): Promise<TerminalCaptureRecord> {
    const result = await db.query<Record<string, unknown>>(`SELECT * FROM terminal_captures WHERE transaction_code = $1`, [code]);
    const row = result.rows[0] ?? {};
    return {
      id: String(row.id),
      clientId: String(row.client_id),
      transactionCode: String(row.transaction_code),
      kind: 'CREDIT',
      amountCents: Number(row.amount_cents),
      state: row.state as TerminalCaptureRecord['state'],
      source: 'DEVICE',
      deviceId: null,
      orderId: text(row.order_id),
      paymentId: text(row.payment_id),
      holdKey: text(row.hold_key),
      transactionId: null,
      hostNsu: null,
      authorizationCode: null,
      cardBrand: null,
      installments: null,
      terminalSerial: null,
      entryMode: null,
      capturedAt: NOW,
      refundFlaggedAt: instant(row.refund_flagged_at),
      refundReason: text(row.refund_reason),
      refundClearedAt: instant(row.refund_cleared_at),
    };
  }

  return {
    seed,
    claim,
    read,
    clearPayments: async () => {
      await db.query(`TRUNCATE payments`);
    },
    reset: async () => {
      await db.query(`TRUNCATE terminal_captures, payments`);
    },
    runPositional: async (statement, values) => {
      const numbered = statement.split('?').reduce((out, part, index) => (index === 0 ? part : `${out}$${index}${part}`), '');
      const result = await db.query<Record<string, unknown>>(numbered, [...values]);
      return result.rows;
    },
    close: () => db.close(),
  };
}
