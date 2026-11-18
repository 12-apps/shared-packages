import { describe, expect, it } from 'vitest';

import type { ChargeSnapshot } from '../core/types';
import { allProviderAdapters } from '../providers/catalog';
import { snapshotFromCob } from '../providers/itau-pix';
import { orderSnapshot } from '../providers/pagbank-snapshots';
import { PT_BR_PROVIDER_COPY } from '../providers/pt-BR';

/**
 * The `refundReadBack` selftest (FUT-4951): an adapter that declares it sets
 * `refundedAmount` on every snapshot of a CAPTURED charge — PAID,
 * PARTIALLY_REFUNDED and REFUNDED — because the store refund retrier reads an
 * absent figure as "cannot say" and gives the part up to a person. Each
 * declaring adapter brings its three read-backs here; a new one cannot declare
 * the capability without them.
 */

const CAPTURE = 11_050;

const pagbank = (status: string, refunded?: number): ChargeSnapshot =>
  orderSnapshot(
    {
      id: 'ORDE_1',
      reference_id: 'order-1',
      charges: [
        {
          id: 'CHAR_1',
          status,
          amount: { value: CAPTURE, ...(refunded === undefined ? {} : { summary: { total: CAPTURE, paid: CAPTURE, refunded } }) } as never,
          payment_method: { type: 'CREDIT_CARD' },
        },
      ],
    },
    'CHAR_1',
  );

const itau = (devolvido: string[]): ChargeSnapshot =>
  snapshotFromCob({
    txid: 'tx1',
    status: 'CONCLUIDA',
    valor: { original: '110.50' },
    pix: [{ endToEndId: 'E1', valor: '110.50', devolucoes: devolvido.map((valor, i) => ({ id: `d${i}`, valor, status: 'DEVOLVIDO' })) }],
  });

/** Each declaring adapter's PAID, PARTIALLY_REFUNDED and REFUNDED read-backs, with the figure each must carry. */
const READ_BACKS: Record<string, Array<[ChargeSnapshot, number]>> = {
  pagbank: [
    [pagbank('PAID'), 0],
    [pagbank('PAID', 509), 509],
    [pagbank('CANCELED', CAPTURE), CAPTURE],
  ],
  itau: [
    [itau([]), 0],
    [itau(['5.09']), 509],
    [itau(['110.50']), CAPTURE],
  ],
};

describe('refundReadBack: a declaring adapter reports the refunded total on every captured charge (FUT-4951)', () => {
  const declaring = allProviderAdapters(PT_BR_PROVIDER_COPY)
    .filter((adapter) => adapter.capabilities.refundReadBack === true)
    .map((adapter) => adapter.name);

  it('every adapter that declares it has its read-backs below', () => {
    expect([...declaring].sort()).toEqual(Object.keys(READ_BACKS).sort());
  });

  for (const [name, cases] of Object.entries(READ_BACKS)) {
    it(`${name}: PAID, PARTIALLY_REFUNDED and REFUNDED each carry refundedAmount`, () => {
      expect(cases.map(([snapshot]) => snapshot.status)).toEqual(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
      for (const [snapshot, cents] of cases) {
        expect(snapshot.refundedAmount, `${name} ${snapshot.status}`).toEqual({ amountCents: cents, currency: 'BRL' });
      }
    });
  }

  it('a charge not captured yet carries no figure: absent means "cannot say"', () => {
    expect(pagbank('WAITING').refundedAmount).toBeUndefined();
    expect(snapshotFromCob({ txid: 'tx1', status: 'ATIVA', valor: { original: '110.50' } }).refundedAmount).toBeUndefined();
  });
});
