import { describe, expect, it, vi } from 'vitest';

import { ChargeIdentityError } from '../core/charge-identity';
import { createChargeRaiser, type ChargeRaiseDeps } from '../core/charge-raise';
import { UnsupportedOperationError } from '../core/errors';
import type { SupersededCharge } from '../core/hosted-retire';
import type { ChargeSnapshot, ChargeStatus, MerchantRef, Money } from '../core/types';

/**
 * A BALANCE RAISE (FUT-612): a reference that already holds a capture is asked
 * only for what is missing, and every OTHER live charge on it — the full-amount
 * code, a card still in 3-D Secure — is retired with the moved-past links, so
 * one difference charge is ever payable (I6). Retired only while the held
 * charge is live, and a charge its void finds PAID is settled or recorded.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'acme' };
const BRL = (amountCents: number): Money => ({ amountCents, currency: 'BRL' });
const LATER = '2999-01-01T00:00:00.000Z';
const EARLIER = '2000-01-01T00:00:00.000Z';

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

/** What the provider answers a void of each charge with; CANCELED unless named. */
type VoidAnswers = Record<string, ChargeStatus | 'UNSUPPORTED'>;

/** Every live charge of the reference, the answers its voids get, and what a raise mints. */
function deps(live: ChargeSnapshot[], over: { voids?: VoidAnswers; minted?: ChargeSnapshot } = {}) {
  const log = { warn: [] as string[], error: [] as string[] };
  const recorded: SupersededCharge[] = [];
  const listPayable = vi.fn(async (q: { method?: string; amount?: Money; amountNot?: Money }) =>
    live
      .filter((s) => !q.method || s.method === q.method)
      .filter((s) => !q.amount || s.amount.amountCents === q.amount.amountCents)
      .filter((s) => !q.amountNot || s.amount.amountCents !== q.amountNot.amountCents)
      .map((snapshot) => ({ snapshot })),
  );
  const cancelCharge = vi.fn(async (_m: MerchantRef, _p: string, id: string) => {
    const answer = over.voids?.[id] ?? 'CANCELED';
    if (answer === 'UNSUPPORTED') throw new UnsupportedOperationError('pagbank', 'cancelCharge');
    return snap(id, { status: answer });
  });
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
      markSuperseded: vi.fn(async () => undefined),
    } as unknown as ChargeRaiseDeps['charges'],
    log: { warn: (m) => log.warn.push(m), error: (m) => log.error.push(m) },
    onSuperseded: (charge) => {
      recorded.push(charge);
    },
  };
  return { d, log, cancelCharge, recorded };
}

const BALANCE = {
  merchant: TENANT,
  reference: 'ord_1',
  amount: BRL(1380),
  method: 'PIX' as const,
  customer: { name: 'Ana', email: 'a@x.com', taxId: '12345678909' },
  supersedeOthers: true as const,
};
const CARD_BALANCE = { ...BALANCE, method: 'CARD' as const, card: { token: 'tok_1' } };

const voided = (cancel: ReturnType<typeof vi.fn>) => cancel.mock.calls.map((call) => call[2]);

describe('a balance raise retires every other live charge', () => {
  it('voids the full-amount code AND a pending card, keeping the new difference code', async () => {
    const { d, cancelCharge } = deps([snap('FULL'), snap('CARD3DS', { method: 'CARD', pix: undefined })]);

    const { answer, paidEarlier } = await createChargeRaiser(d)(BALANCE);

    expect(answer.providerChargeId).toBe('DIFF');
    expect(paidEarlier).toBe(false);
    expect(voided(cancelCharge).sort()).toEqual(['CARD3DS', 'FULL']);
  });

  it('on a reuse hands back the live difference code and voids the rest (I6)', async () => {
    const diff = snap('DIFF', { amount: BRL(1380) });
    const { d, cancelCharge } = deps([diff, snap('FULL')]);

    const { answer } = await createChargeRaiser(d)(BALANCE);

    expect(answer).toBe(diff);
    expect(d.gateway.charge).not.toHaveBeenCalled();
    expect(voided(cancelCharge)).toEqual(['FULL']);
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
    expect(cancelCharge).not.toHaveBeenCalled();
  });
});

describe('only a live held charge retires the others (B3)', () => {
  it('a DECLINED card leaves the live difference Pix untouched', async () => {
    const diff = snap('DIFF_PIX', { amount: BRL(1380) });
    const declined = snap('CARD_NO', { method: 'CARD', pix: undefined, status: 'DECLINED', amount: BRL(1380) });
    const { d, cancelCharge } = deps([diff], { minted: declined });

    const { answer } = await createChargeRaiser(d)(CARD_BALANCE);

    expect(answer.status).toBe('DECLINED');
    expect(cancelCharge).not.toHaveBeenCalled();
    // Not even listed: a decline retires nothing.
    expect(d.charges.listPayable).not.toHaveBeenCalledWith({ merchant: TENANT, reference: 'ord_1' });
  });

  it('an approved card voids the difference Pix it replaces', async () => {
    const paidCard = snap('CARD_OK', { method: 'CARD', pix: undefined, status: 'PAID', amount: BRL(1380) });
    const { d, cancelCharge } = deps([snap('DIFF_PIX', { amount: BRL(1380) })], { minted: paidCard });

    const { answer } = await createChargeRaiser(d)(CARD_BALANCE);

    expect(answer.providerChargeId).toBe('CARD_OK');
    expect(voided(cancelCharge)).toEqual(['DIFF_PIX']);
  });
});

describe('a charge captured in the race with the void (B2)', () => {
  it('is the answer when the void finds it PAID, and the new code is retired against it', async () => {
    const { d, cancelCharge, log } = deps([snap('FULL')], { voids: { FULL: 'PAID' } });

    const { answer, paidEarlier } = await createChargeRaiser(d)(BALANCE);

    // The caller SETTLES it (FUT-4072's paidEarlier), never loses it.
    expect(answer.providerChargeId).toBe('FULL');
    expect(answer.status).toBe('PAID');
    expect(paidEarlier).toBe(true);
    expect(voided(cancelCharge)).toEqual(['FULL', 'DIFF']);
    expect(log.error.join('\n')).toContain('PAID_BEFORE_VOID');
  });

  it('is recorded DOUBLE_PAID when the held card was paid too', async () => {
    const paidCard = snap('CARD_OK', { method: 'CARD', pix: undefined, status: 'PAID', amount: BRL(1380) });
    const world = deps([snap('FULL')], { voids: { FULL: 'AUTHORIZED' }, minted: paidCard });

    const { answer, paidEarlier } = await createChargeRaiser(world.d)(CARD_BALANCE);

    expect(answer.providerChargeId).toBe('CARD_OK');
    expect(paidEarlier).toBe(false);
    expect(world.recorded.map((r) => [r.snapshot.providerChargeId, r.why])).toEqual([['FULL', 'DOUBLE_PAID']]);
  });
});

describe('a charge the provider cannot void', () => {
  it('is marked superseded and recorded, never left silent', async () => {
    const world = deps([snap('FULL')], { voids: { FULL: 'UNSUPPORTED' } });

    await createChargeRaiser(world.d)(BALANCE);

    expect(world.d.charges.markSuperseded).toHaveBeenCalledTimes(1);
    expect(world.recorded.map((r) => [r.snapshot.providerChargeId, r.why, r.replacedBy.providerChargeId])).toEqual([
      ['FULL', 'VOID_UNSUPPORTED', 'DIFF'],
    ]);
  });

  it('logs a listing failure and still answers the new code', async () => {
    const { d, log, cancelCharge } = deps([]);
    (d.charges.listPayable as ReturnType<typeof vi.fn>).mockImplementation(async (q: { amount?: Money; method?: string }) => {
      if (!q.amount && !q.method) throw new Error('db down');
      return [];
    });
    const { answer } = await createChargeRaiser(d)(BALANCE);
    expect(answer.providerChargeId).toBe('DIFF');
    expect(cancelCharge).not.toHaveBeenCalled();
    expect(log.error.join('\n')).toContain('db down');
  });
});

describe('a reprice is untouched when the flag is absent', () => {
  it('voids only the PIX codes at another price, never a pending card', async () => {
    const card = snap('CARD3DS', { method: 'CARD', pix: undefined, amount: BRL(1000) });
    const { d, cancelCharge } = deps([snap('FULL'), card]);

    await createChargeRaiser(d)({ ...BALANCE, supersedeOthers: undefined });

    expect(voided(cancelCharge)).toEqual(['FULL']);
  });
});
