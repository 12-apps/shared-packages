import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { captureBindSql, explainUnbound } from '../bind-fragment';
import { bindDecision } from '../decisions';
import { NOW, openBindDb, positionalParams, type BindDb, type Seed } from '../../tests/integration/bind-db';

/**
 * The bind as ONE statement (FUT-3764): on a real Postgres engine (PGlite),
 * the statement binds exactly the captures the ledger's own `bindDecision`
 * admits, composes as a CTE beside the caller's payment insert, and leaves
 * every other capture as it was — with `explainUnbound` naming why.
 */

/** Every call is a fresh list: nothing is shared between tests. */
function cases(): readonly Seed[] {
  return [
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
}

describe('captureBindSql', () => {
  let opened: BindDb | undefined;

  beforeEach(async () => {
    opened = await openBindDb();
  });

  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });

  function bound(): BindDb {
    if (!opened) throw new Error('the bind database is not open');
    return opened;
  }

  it('binds exactly what the ledger bind admits, case by case', async () => {
    const { seed, claim, read, clearPayments } = bound();
    const rows = cases();
    await seed(rows);
    for (const [index, row] of rows.entries()) {
      const before = await read(row.code);
      const admits = typeof bindDecision(before, { orderId: 'o-1', paymentId: `p-${index}` }) === 'object';
      // Each case is a sale of its own: one payment row per sale.
      const codes = await claim(row.code, 'o-1', `p-${index}`);
      expect({ code: row.code, bound: codes.length === 1 }).toEqual({ code: row.code, bound: admits });
      const after = await read(row.code);
      if (admits) expect(after).toMatchObject({ state: 'BOUND', orderId: 'o-1', paymentId: `p-${index}` });
      else expect(after).toEqual(before);
      await clearPayments();
    }
  });

  it('clears a timeout flag as the bind clears it', async () => {
    const { seed, claim, read } = bound();
    await seed([{ code: 'timeout-flag', flagged: 'UNBOUND_TIMEOUT' }]);
    await claim('timeout-flag', 'o-1', 'p-1');
    expect((await read('timeout-flag')).refundClearedAt).toEqual(NOW);
  });

  it("never binds another tenant's capture", async () => {
    const { seed, claim } = bound();
    await seed([{ code: 'theirs', client: 'other' }]);
    expect(await claim('theirs', 'o-1', 'p-1')).toEqual([]);
  });

  it('binds once: a second claim binds nothing and is explained as a replay or a refusal', async () => {
    const { seed, claim, read } = bound();
    await seed([{ code: 'unbound' }]);
    expect(await claim('unbound', 'o-1', 'p-1')).toEqual(['unbound']);
    expect(await claim('unbound', 'o-2', 'p-9')).toEqual([]);
    const current = await read('unbound');
    expect(explainUnbound(current, { orderId: 'o-1', paymentId: 'p-1' })).toBe('replay');
    expect(explainUnbound(current, { orderId: 'o-1', paymentId: 'p-9' })).toBe('BOUND_ELSEWHERE');
    expect(explainUnbound(null, { orderId: 'o-1', paymentId: 'p-1' })).toBe('missing');
  });

  it('a payment insert that returned no row (a lost race) binds nothing and leaves the capture as it was', async () => {
    const { seed, claim, read } = bound();
    await seed([{ code: 'first' }, { code: 'second' }]);
    expect(await claim('first', 'o-1', 'p-1')).toEqual(['first']);
    const before = await read('second');
    // The guard is TRUE here, so it is the fragment's own NULL check that refuses.
    expect(await claim('second', 'o-1', 'p-2', { conflict: true, saleGuardSql: 'TRUE' })).toEqual([]);
    expect(await read('second')).toEqual(before);
  });

  it('a capture held for this sale context binds, one held for another never does, as bindDecision says', async () => {
    const { seed, claim, read } = bound();
    const held: readonly Seed[] = [{ code: 'held-here', holdKey: 'h-1' }, { code: 'held-there', holdKey: 'h-2' }, { code: 'not-held' }];
    await seed(held);
    for (const [index, row] of held.entries()) {
      const target = { orderId: `o-${index}`, paymentId: `p-${index}`, holdKey: 'h-1' };
      const admits = typeof bindDecision(await read(row.code), target) === 'object';
      const codes = await claim(row.code, target.orderId, target.paymentId, { holdKey: 'h-1' });
      expect({ code: row.code, bound: codes.length === 1 }).toEqual({ code: row.code, bound: row.code !== 'held-there' });
      expect({ code: row.code, bound: codes.length === 1 }).toEqual({ code: row.code, bound: admits });
    }
    expect((await read('held-here')).holdKey).toBeNull();
    expect(explainUnbound(await read('held-there'), { orderId: 'o-1', paymentId: 'p-1', holdKey: 'h-1' })).toBe('BOUND_ELSEWHERE');
  });

  it('with no holdKey a held capture never binds, as bindDecision says', async () => {
    const { seed, claim, read } = bound();
    await seed([{ code: 'held', holdKey: 'h-1' }]);
    expect(typeof bindDecision(await read('held'), { orderId: 'o-1', paymentId: 'p-1' })).toBe('string');
    expect(await claim('held', 'o-1', 'p-1')).toEqual([]);
  });

  it("refuses a payment row of another sale through the caller's sale guard", async () => {
    const { seed, claim, read } = bound();
    await seed([{ code: 'unbound' }]);
    expect(await claim('unbound', 'o-1', 'p-1', { paidForOrder: 'o-other' })).toEqual([]);
    expect((await read('unbound')).state).toBe('UNBOUND');
  });

  it('lines up positional placeholders: every value is bound once per use, in text order', async () => {
    const { seed, read, runPositional } = bound();
    await seed([{ code: 'unbound', flagged: 'UNBOUND_TIMEOUT' }]);
    const { param, values } = positionalParams();
    const input = { clientId: 't', transactionCode: 'unbound', orderId: 'o-1', paymentIdSql: `'p-1'`, saleGuardSql: 'TRUE', holdKey: 'h-1', now: NOW, param };
    const bind = captureBindSql(input, { holds: true });
    expect(bind.text.split('?').length - 1).toBe(values.length);
    // Number the `?` left to right, as a positional driver binds them, and run it on Postgres.
    const rows = await runPositional(bind.text, values);
    expect(rows).toEqual([{ transaction_code: 'unbound', kind: 'CREDIT', amount_cents: 8990 }]);
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
