import { describe, expect, it } from 'vitest';

import { pixManualProvider } from '../pixmanual';
import { PT_BR_PIX_MANUAL_COPY } from '../pix-manual/pt-BR';

/**
 * A static Pix code's transaction id (FUT-2239): the txid tag 62/05 carries,
 * which the payer's bank echoes back — the id a fiscal document links.
 */

const CONFIGURED = { pixKey: 'loja@example.com', merchantName: 'Padaria Boa', merchantCity: 'Recife' };

function charge(reference: string) {
  return pixManualProvider(PT_BR_PIX_MANUAL_COPY, { now: () => 0 }).createCharge(
    { reference, amount: { amountCents: 4250, currency: 'BRL' }, method: 'PIX', customer: {} },
    { environment: 'PRODUCTION', fields: CONFIGURED },
  );
}

describe('pixmanual transaction', () => {
  it.each(['order123', 'order-123--2'])('reports the txid the code carries for %s', async (reference) => {
    const snapshot = await charge(reference);
    const txid = snapshot.transaction?.txid ?? '';

    expect(txid).toMatch(/^[a-zA-Z0-9]{1,25}$/);
    expect(snapshot.pix?.qrText).toContain(`05${String(txid.length).padStart(2, '0')}${txid}`);
    expect(snapshot.providerChargeId).toBe(`pixmanual_${txid}`);
  });

  it('names no PSP: the store bank is not this adapter to know', async () => {
    expect((await charge('order123')).transaction).toEqual({ txid: 'order123' });
  });
});
