import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { captureBindSql, explainUnbound, type SqlParam } from '../bind-fragment';
import { bindDecision } from '../decisions';
import type { TerminalCaptureRecord } from '../model';

/**
 * The bind as ONE statement (FUT-3764): on a real Postgres engine (PGlite),
 * the statement binds exactly the captures the ledger's own `bindDecision`
 * admits, composes as a CTE beside the caller's payment insert, and leaves
 * every other capture as it was — with `explainUnbound` naming why.
 */

let db: PGlite;

const NOW = new Date('2026-11-26T20:00:00.000Z');

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE terminal_captures (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, transaction_code TEXT NOT NULL, kind TEXT NOT NULL,
      amount_cents INT NOT NULL, state TEXT NOT NULL, order_id TEXT, payment_id TEXT, hold_key TEXT,
      refund_flagged_at TIMESTAMPTZ, refund_reason TEXT, refund_cleared_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
      UNIQUE (client_id, transaction_code));
    CREATE TABLE payments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE);
  `);
});

afterEach(async () => {
  await db.close();
});

interface Seed {
  code: string;
  state?: string;
  orderId?: string;
  paymentId?: string;
  holdKey?: string;
  flagged?: string;
  cleared?: boolean;
  client?: string;
}

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

/** A `param` that numbers placeholders and collects their values. */
function params(): { param: SqlParam; values: unknown[] } {
  const values: unknown[] = [];
  return {
    values,
    param: (value) => {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

interface ClaimOptions {
  /** The sale context the claim binds under (a held capture binds only to its own). */
  holdKey?: string;
  /** The payment row is inserted for this sale instead: the caller's sale guard must refuse it. */
  paidForOrder?: string;
  /** The insert lost its race (`ON CONFLICT DO NOTHING`) and returns no row. */
  conflict?: boolean;
  /** Replaces the sale guard (TRUE: prove a predicate holds on its own, not through the guard). */
  saleGuardSql?: string;
}

/** The bind composed beside the payment insert, as a host's claim would: the codes it bound. */
async function claim(code: string, orderId: string, paymentId: string, options: ClaimOptions = {}): Promise<string[]> {
  const { param, values } = params();
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

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const instant = (value: unknown): Date | null => (value === null || value === undefined ? null : new Date(value as string));

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

const CASES: readonly Seed[] = [
  { code: 'unbound' },
  { code: 'created-here', state: 'ORDER_CREATED', orderId: 'o-1' },
  { code: 'created-elsewhere', state: 'ORDER_CREATED', orderId: 'o-2' },
  { code: 'bound-elsewhere', state: 'BOUND', orderId: 'o-2', paymentId: 'p-2' },
  { code: 'held', holdKey: 'h-1' },
  { code: 'timeout-flag', flagged: 'UNBOUND_TIMEOUT' },
  { code: 'cancelled-flag', flagged: 'SALE_CANCELLED' },
  { code: 'cleared-flag', flagged: 'SALE_CANCELLED', cleared: true },
  { code: 'twice-flag', flagged: 'RECEIVED_TWICE' },
];

describe('captureBindSql', () => {
  it('binds exactly what the ledger bind admits, case by case', async () => {
    await seed(CASES);
    for (const [index, row] of CASES.entries()) {
      const before = await read(row.code);
      const admits = typeof bindDecision(before, { orderId: 'o-1', paymentId: `p-${index}` }) === 'object';
      // Each case is a sale of its own: one payment row per sale.
      const bound = await claim(row.code, 'o-1', `p-${index}`);
      expect({ code: row.code, bound: bound.length === 1 }).toEqual({ code: row.code, bound: admits });
      const after = await read(row.code);
      if (admits) expect(after).toMatchObject({ state: 'BOUND', orderId: 'o-1', paymentId: `p-${index}` });
      else expect(after).toEqual(before);
      await db.query(`TRUNCATE payments`);
    }
  });

  it('clears a timeout flag as the bind clears it', async () => {
    await seed([{ code: 'timeout-flag', flagged: 'UNBOUND_TIMEOUT' }]);
    await claim('timeout-flag', 'o-1', 'p-1');
    expect((await read('timeout-flag')).refundClearedAt).toEqual(NOW);
  });

  it("never binds another tenant's capture", async () => {
    await seed([{ code: 'theirs', client: 'other' }]);
    expect(await claim('theirs', 'o-1', 'p-1')).toEqual([]);
  });

  it('binds once: a second claim binds nothing and is explained as a replay or a refusal', async () => {
    await seed([{ code: 'unbound' }]);
    expect(await claim('unbound', 'o-1', 'p-1')).toEqual(['unbound']);
    expect(await claim('unbound', 'o-2', 'p-9')).toEqual([]);
    const current = await read('unbound');
    expect(explainUnbound(current, { orderId: 'o-1', paymentId: 'p-1' })).toBe('replay');
    expect(explainUnbound(current, { orderId: 'o-1', paymentId: 'p-9' })).toBe('BOUND_ELSEWHERE');
    expect(explainUnbound(null, { orderId: 'o-1', paymentId: 'p-1' })).toBe('missing');
  });

  it('a payment insert that returned no row (a lost race) binds nothing and leaves the capture as it was', async () => {
    await seed([{ code: 'first' }, { code: 'second' }]);
    expect(await claim('first', 'o-1', 'p-1')).toEqual(['first']);
    const before = await read('second');
    // The guard is TRUE here, so it is the fragment's own NULL check that refuses.
    expect(await claim('second', 'o-1', 'p-2', { conflict: true, saleGuardSql: 'TRUE' })).toEqual([]);
    expect(await read('second')).toEqual(before);
  });

  it('a capture held for this sale context binds, one held for another never does, as bindDecision says', async () => {
    const held: readonly Seed[] = [{ code: 'held-here', holdKey: 'h-1' }, { code: 'held-there', holdKey: 'h-2' }, { code: 'not-held' }];
    await seed(held);
    for (const [index, row] of held.entries()) {
      const target = { orderId: `o-${index}`, paymentId: `p-${index}`, holdKey: 'h-1' };
      const admits = typeof bindDecision(await read(row.code), target) === 'object';
      const bound = await claim(row.code, target.orderId, target.paymentId, { holdKey: 'h-1' });
      expect({ code: row.code, bound: bound.length === 1 }).toEqual({ code: row.code, bound: row.code !== 'held-there' });
      expect({ code: row.code, bound: bound.length === 1 }).toEqual({ code: row.code, bound: admits });
    }
    expect((await read('held-here')).holdKey).toBeNull();
    expect(explainUnbound(await read('held-there'), { orderId: 'o-1', paymentId: 'p-1', holdKey: 'h-1' })).toBe('BOUND_ELSEWHERE');
  });

  it('with no holdKey a held capture never binds, as bindDecision says', async () => {
    await seed([{ code: 'held', holdKey: 'h-1' }]);
    expect(typeof bindDecision(await read('held'), { orderId: 'o-1', paymentId: 'p-1' })).toBe('string');
    expect(await claim('held', 'o-1', 'p-1')).toEqual([]);
  });

  it("refuses a payment row of another sale through the caller's sale guard", async () => {
    await seed([{ code: 'unbound' }]);
    expect(await claim('unbound', 'o-1', 'p-1', { paidForOrder: 'o-other' })).toEqual([]);
    expect((await read('unbound')).state).toBe('UNBOUND');
  });

  it('lines up positional placeholders: every value is bound once per use, in text order', async () => {
    await seed([{ code: 'unbound', flagged: 'UNBOUND_TIMEOUT' }]);
    const values: unknown[] = [];
    const positional: SqlParam = (value) => {
      values.push(value);
      return '?';
    };
    const input = { clientId: 't', transactionCode: 'unbound', orderId: 'o-1', paymentIdSql: `'p-1'`, saleGuardSql: 'TRUE', holdKey: 'h-1', now: NOW, param: positional };
    const bind = captureBindSql(input, { holds: true });
    expect(bind.text.split('?').length - 1).toBe(values.length);
    // Number the `?` left to right, as a positional driver binds them, and run it on Postgres.
    let n = 0;
    const numbered = bind.text.replace(/\?/g, () => `$${(n += 1)}`);
    const result = await db.query<Record<string, unknown>>(numbered, values);
    expect(result.rows).toEqual([{ transaction_code: 'unbound', kind: 'CREDIT', amount_cents: 8990 }]);
    expect(await read('unbound')).toMatchObject({ state: 'BOUND', orderId: 'o-1', paymentId: 'p-1', refundClearedAt: NOW });
  });

  it('names no hold or stamp column when the table has none, and refuses a table name that is not an identifier', () => {
    const input = { clientId: 't', transactionCode: 'x', orderId: 'o', paymentIdSql: '$9', saleGuardSql: 'TRUE', now: NOW, param: () => '$1' };
    const sql = captureBindSql(input, { holds: false, updatedAt: false });
    expect(sql.text).not.toContain('hold_key');
    expect(sql.text).not.toContain('updated_at');
    expect(() => captureBindSql(input, { table: 'Bad-Name' })).toThrow();
  });
});
