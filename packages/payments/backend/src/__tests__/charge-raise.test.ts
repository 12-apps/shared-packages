import { describe, expect, it, vi } from 'vitest';

import { ChargeIdentityError } from '../core/charge-identity';
import { createChargeRaiser, type ChargeRaiseDeps } from '../core/charge-raise';
import { UnsupportedOperationError } from '../core/errors';
import type { ChargeSnapshot, MerchantRef, Money } from '../core/types';

/**
 * THE ORDER THE PIECES GO IN (FUT-760). Each case below pins one of the four
 * rules the module's docstring states, because each has a failure mode that
 * ends with a buyer charged twice or a payment nobody can settle.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'acme' };
const BRL = (amountCents: number): Money => ({ amountCents, currency: 'BRL' });
const CUSTOMER = { name: 'Ana', email: 'a@x.com', taxId: '12345678909' };

function snapshot(over: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
  return {
    provider: 'pagbank',
    providerChargeId: 'CHAR_1',
    status: 'PENDING',
    amount: BRL(1000),
    method: 'PIX',
    ...over,
  } as ChargeSnapshot;
}

/** `listPayable` answers from a queue keyed by the clauses it was given. */
function deps(over: {
  payable?: Array<{ snapshot: ChargeSnapshot }>;
  pixPayable?: Array<{ snapshot: ChargeSnapshot }>;
  superseded?: Array<{ snapshot: ChargeSnapshot }>;
  count?: number;
  charge?: ChargeRaiseDeps['gateway']['charge'];
  cancelCharge?: ChargeRaiseDeps['gateway']['cancelCharge'];
}): { d: ChargeRaiseDeps; calls: { warn: string[]; error: string[] } } {
  const calls = { warn: [] as string[], error: [] as string[] };
  const listPayable = vi.fn(async (q: { method?: string; amountNot?: Money }) => {
    if (q.amountNot) return over.superseded ?? [];
    if (q.method === 'PIX') return over.pixPayable ?? [];
    return over.payable ?? [];
  });
  const d: ChargeRaiseDeps = {
    gateway: {
      charge:
        over.charge ??
        // An honest gateway echoes the identity it was asked for; the
        // mismatch cases below override this to return a dishonest one.
        (vi.fn(async (_m: MerchantRef, input: { idempotencyKey?: string }) => ({
          reference: 'ord_1',
          idempotencyKey: input.idempotencyKey ?? null,
          snapshot: snapshot({ providerChargeId: 'NEW' }),
        })) as unknown as ChargeRaiseDeps['gateway']['charge']),
      cancelCharge: over.cancelCharge ?? vi.fn(async () => snapshot()),
    },
    charges: {
      listPayable,
      countByReference: vi.fn(async () => over.count ?? 0),
      latestByReference: vi.fn(async () => null),
      listPendingCharges: vi.fn(async () => []),
    } as unknown as ChargeRaiseDeps['charges'],
    log: { warn: (m) => calls.warn.push(m), error: (m) => calls.error.push(m) },
  };
  return { d, calls };
}

const REQUEST = {
  merchant: TENANT,
  reference: 'ord_1',
  amount: BRL(1000),
  method: 'PIX' as const,
  customer: CUSTOMER,
};

describe('rule 1 — reuse is checked before the ordinal is read', () => {
  it('hands back the live PIX code without touching the attempt count', async () => {
    const live = snapshot({ providerChargeId: 'LIVE', pix: { qrText: 'QR' } } as never);
    const { d } = deps({ pixPayable: [{ snapshot: live }] });

    expect(await createChargeRaiser(d)(REQUEST)).toBe(live);
    // Bumping here would hand the NEXT real attempt a key one ahead of its row.
    expect(d.charges.countByReference).not.toHaveBeenCalled();
    expect(d.gateway.charge).not.toHaveBeenCalled();
  });

  it('raises with the ordinal as the key when nothing is reusable', async () => {
    const { d } = deps({ count: 2 });

    await createChargeRaiser(d)(REQUEST);

    const call = (d.gateway.charge as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      { idempotencyKey: string; reference: string },
    ];
    expect(call[1].idempotencyKey).toBe('ord_1:2');
    expect(call[1].reference).toBe('ord_1--2');
  });
});

describe('rule 2 — hosted is checked first, and for either method', () => {
  it('reuses a hosted link for a CARD request, which the PIX clause would skip', async () => {
    const link = snapshot({ providerChargeId: 'LINK', hostedCheckoutUrl: 'https://pay/x' });
    const { d } = deps({ payable: [{ snapshot: link }] });

    const got = await createChargeRaiser(d)({ ...REQUEST, method: 'CARD' });

    expect(got).toBe(link);
    expect(d.gateway.charge).not.toHaveBeenCalled();
  });

  it('ignores the link when the buyer brought a card for that same provider', async () => {
    const link = snapshot({ providerChargeId: 'LINK', hostedCheckoutUrl: 'https://pay/x' });
    const { d } = deps({ payable: [{ snapshot: link }] });

    await createChargeRaiser(d)({
      ...REQUEST,
      method: 'CARD',
      card: { token: 'tok_1', provider: 'pagbank' } as never,
    });

    // Silently reusing here would ignore the card the buyer just typed.
    expect(d.gateway.charge).toHaveBeenCalled();
  });
});

describe('rule 3 — the returned row is not taken on trust', () => {
  it('throws rather than returning a charge stored under another attempt', async () => {
    const { d } = deps({
      count: 1,
      charge: vi.fn(async () => ({
        reference: 'ord_1',
        idempotencyKey: 'ord_1:0', // the PREVIOUS attempt's key
        snapshot: snapshot(),
      })) as unknown as ChargeRaiseDeps['gateway']['charge'],
    });

    await expect(createChargeRaiser(d)(REQUEST)).rejects.toBeInstanceOf(ChargeIdentityError);
  });

  /**
   * A row stored under NO key cannot be proved to be this attempt's. It is the
   * shape a pre-idempotency charge has, and the one a store returns when the
   * key never reached it — neither is evidence, so it is refused like any other
   * mismatch.
   */
  it('refuses a charge stored under no key at all', async () => {
    const { d } = deps({
      charge: vi.fn(async () => ({
        reference: 'ord_1',
        idempotencyKey: null,
        snapshot: snapshot(),
      })) as unknown as ChargeRaiseDeps['gateway']['charge'],
    });

    await expect(createChargeRaiser(d)(REQUEST)).rejects.toBeInstanceOf(ChargeIdentityError);
  });

  it('does not void anything when identity failed', async () => {
    const stale = snapshot({ providerChargeId: 'OLD', amount: BRL(800) });
    const { d } = deps({
      count: 1,
      superseded: [{ snapshot: stale }],
      charge: vi.fn(async () => ({
        reference: 'ord_OTHER',
        idempotencyKey: 'ord_1:1',
        snapshot: snapshot(),
      })) as unknown as ChargeRaiseDeps['gateway']['charge'],
    });

    await expect(createChargeRaiser(d)(REQUEST)).rejects.toBeInstanceOf(ChargeIdentityError);
    expect(d.gateway.cancelCharge).not.toHaveBeenCalled();
  });
});

describe('rule 4 — superseded codes are voided only after the new charge is good', () => {
  it('voids the reprice leftover once the charge is proven', async () => {
    const stale = snapshot({ providerChargeId: 'OLD', amount: BRL(800) });
    const { d } = deps({ superseded: [{ snapshot: stale }] });

    await createChargeRaiser(d)(REQUEST);

    expect(d.gateway.cancelCharge).toHaveBeenCalledWith(TENANT, 'pagbank', 'OLD');
  });

  /**
   * The accepted trade of FUT-379: a provider with no `cancelCharge` leaves the
   * old code payable until it expires. What must not happen is silence.
   */
  it('warns by name when the provider cannot void, and still returns the charge', async () => {
    const stale = snapshot({ providerChargeId: 'OLD', amount: BRL(800) });
    const { d, calls } = deps({
      superseded: [{ snapshot: stale }],
      cancelCharge: vi.fn(async () => {
        throw new UnsupportedOperationError('pagbank', 'cancelCharge');
      }) as unknown as ChargeRaiseDeps['gateway']['cancelCharge'],
    });

    const got = await createChargeRaiser(d)(REQUEST);

    expect(got.providerChargeId).toBe('NEW');
    expect(calls.warn.join()).toContain('OLD');
    expect(calls.error).toEqual([]);
  });

  it('errors — never throws — when the void itself fails', async () => {
    const stale = snapshot({ providerChargeId: 'OLD', amount: BRL(800) });
    const { d, calls } = deps({
      superseded: [{ snapshot: stale }],
      cancelCharge: vi.fn(async () => {
        throw new Error('network');
      }) as unknown as ChargeRaiseDeps['gateway']['cancelCharge'],
    });

    // Failing the buyer's checkout because an OLD code could not be voided
    // turns a stale-code risk into an outage of the payment path.
    await expect(createChargeRaiser(d)(REQUEST)).resolves.toBeTruthy();
    expect(calls.error.join()).toContain('network');
  });
});
