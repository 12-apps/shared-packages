import { describe, expect, it, vi } from 'vitest';

import { voidOtherLiveCharges } from '../core/balance-supersede';
import { ChargeIdentityError } from '../core/charge-identity';
import { createChargeRaiser, type ChargeRaiseDeps } from '../core/charge-raise';
import { UnsupportedOperationError } from '../core/errors';
import type { ChargeSnapshot, MerchantRef, Money } from '../core/types';

/**
 * A BALANCE RAISE (FUT-612): a reference that already holds a capture is asked
 * only for what is missing, and once the charge the buyer holds is good every
 * OTHER live charge on it is voided — the full-amount code, a card still in
 * 3-D Secure — so one difference charge is ever payable (I6).
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'acme' };
const BRL = (amountCents: number): Money => ({ amountCents, currency: 'BRL' });
const LATER = new Date(Date.now() + 3_600_000).toISOString();
const EARLIER = new Date(Date.now() - 3_600_000).toISOString();

function snap(id: string, over: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
  return {
    provider: 'pagbank',
    providerChargeId: id,
    status: 'PENDING',
    amount: BRL(2070),
    method: 'PIX',
    pix: { qrText: `QR-${id}`, expiresAt: LATER },
    ...over,
  } as ChargeSnapshot;
}

/** Every live charge of the reference, and which of them a query narrows to. */
function deps(live: ChargeSnapshot[], over: { cancelCharge?: ChargeRaiseDeps['gateway']['cancelCharge']; minted?: ChargeSnapshot } = {}) {
  const log = { warn: [] as string[], error: [] as string[] };
  const listPayable = vi.fn(async (q: { method?: string; amount?: Money; amountNot?: Money }) =>
    live
      .filter((s) => !q.method || s.method === q.method)
      .filter((s) => !q.amount || s.amount.amountCents === q.amount.amountCents)
      .filter((s) => !q.amountNot || s.amount.amountCents !== q.amountNot.amountCents)
      .map((snapshot) => ({ snapshot })),
  );
  const cancelCharge = over.cancelCharge ?? vi.fn(async (_m: MerchantRef, _p: string, id: string) => snap(id, { status: 'CANCELED' }));
  const d: ChargeRaiseDeps = {
    gateway: {
      charge: vi.fn(async (_m: MerchantRef, input: { idempotencyKey?: string }) => ({
        reference: 'ord_1',
        idempotencyKey: input.idempotencyKey ?? null,
        snapshot: over.minted ?? snap('DIFF', { amount: BRL(1380) }),
      })) as unknown as ChargeRaiseDeps['gateway']['charge'],
      cancelCharge,
      clientConfigChain: vi.fn(async () => [{ provider: 'pagbank', methods: ['PIX', 'CARD'] as const }]),
    },
    charges: {
      listPayable,
      countByReference: vi.fn(async () => 1),
      latestByReference: vi.fn(async () => null),
      listPendingCharges: vi.fn(async () => []),
    } as unknown as ChargeRaiseDeps['charges'],
    log: { warn: (m) => log.warn.push(m), error: (m) => log.error.push(m) },
  };
  return { d, log, cancelCharge };
}

const BALANCE = {
  merchant: TENANT,
  reference: 'ord_1',
  amount: BRL(1380),
  method: 'PIX' as const,
  customer: { name: 'Ana', email: 'a@x.com', taxId: '12345678909' },
  supersedeOthers: true as const,
};

const voided = (cancel: ReturnType<typeof vi.fn>) => cancel.mock.calls.map((call) => call[2]);

describe('a balance raise voids every other live charge', () => {
  it('voids the full-amount code AND a pending card, keeping the new difference code', async () => {
    const full = snap('FULL');
    const card = snap('CARD3DS', { method: 'CARD', pix: undefined });
    const { d, cancelCharge } = deps([full, card]);

    const { answer } = await createChargeRaiser(d)(BALANCE);

    expect(answer.providerChargeId).toBe('DIFF');
    expect(voided(cancelCharge as ReturnType<typeof vi.fn>).sort()).toEqual(['CARD3DS', 'FULL']);
  });

  it('on a reuse hands back the live difference code and voids the rest (I6)', async () => {
    const diff = snap('DIFF', { amount: BRL(1380) });
    const full = snap('FULL');
    const { d, cancelCharge } = deps([diff, full]);

    const { answer } = await createChargeRaiser(d)(BALANCE);

    expect(answer).toBe(diff);
    expect(d.gateway.charge).not.toHaveBeenCalled();
    expect(voided(cancelCharge as ReturnType<typeof vi.fn>)).toEqual(['FULL']);
  });

  it('leaves a lapsed code alone: it cannot be paid, so a cancel buys nothing', async () => {
    const { d, cancelCharge } = deps([snap('OLD', { pix: { qrText: 'QR', expiresAt: EARLIER } as never })]);
    await createChargeRaiser(d)(BALANCE);
    expect(cancelCharge).not.toHaveBeenCalled();
  });

  it('voids nothing when the minted charge is not the one asked for', async () => {
    const { d, cancelCharge } = deps([snap('FULL')]);
    (d.gateway.charge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      reference: 'someone_else',
      idempotencyKey: 'x',
      snapshot: snap('STRANGER'),
    });
    await expect(createChargeRaiser(d)(BALANCE)).rejects.toBeInstanceOf(ChargeIdentityError);
    // The buyer must never be left with the old code voided and none to pay.
    expect(cancelCharge).not.toHaveBeenCalled();
  });
});

describe('a reprice is untouched when the flag is absent', () => {
  it('voids only the PIX codes at another price, never a pending card', async () => {
    const full = snap('FULL');
    const card = snap('CARD3DS', { method: 'CARD', pix: undefined, amount: BRL(1000) });
    const { d, cancelCharge } = deps([full, card]);
    await createChargeRaiser(d)({ ...BALANCE, supersedeOthers: undefined });

    expect(voided(cancelCharge as ReturnType<typeof vi.fn>)).toEqual(['FULL']);
  });
});

describe('voidOtherLiveCharges is best effort and never silent', () => {
  it('logs an unsupported void by name and goes on', async () => {
    const cancel = vi.fn(async () => {
      throw new UnsupportedOperationError('cancelCharge', 'pixmanual');
    });
    const { d, log } = deps([snap('A'), snap('B')], { cancelCharge: cancel as never });

    await voidOtherLiveCharges(d, { merchant: TENANT, reference: 'ord_1', keep: new Set() });

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(log.warn.join('\n')).toContain('stays payable until it expires');
  });

  it('logs a failed void as an error and never throws', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('503 from provider');
    });
    const { d, log } = deps([snap('A')], { cancelCharge: cancel as never });

    await expect(
      voidOtherLiveCharges(d, { merchant: TENANT, reference: 'ord_1', keep: new Set() }),
    ).resolves.toBeUndefined();
    expect(log.error.join('\n')).toContain('503 from provider');
  });

  it('logs a listing failure and voids nothing', async () => {
    const { d, log, cancelCharge } = deps([]);
    (d.charges.listPayable as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));
    await voidOtherLiveCharges(d, { merchant: TENANT, reference: 'ord_1', keep: new Set() });
    expect(cancelCharge).not.toHaveBeenCalled();
    expect(log.error.join('\n')).toContain('db down');
  });
});
