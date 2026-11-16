import { describe, expect, it, vi } from 'vitest';

import {
  checkoutStatusBody,
  shortfallFact,
  type CheckoutStatusFacts,
  type PaymentShortfall,
} from '../status-facts';

import { BRL, call, setupCheckoutWorld, testAdapter } from './harness';

const REF = 'inv_2024_0043';
const STATUS = `/status?orderId=${REF}`;

/** The contract's own figures (FUT-612 T1): a 2070 payable, 690 captured. */
const SHORT: PaymentShortfall = {
  totalCents: 2070,
  paidCents: 690,
  dueCents: 1380,
  paidMethod: 'PIX',
  resolution: null,
};

/**
 * A SHORT CAPTURE IS A FACT THE SERVER STATES (FUT-612, I10). The token stays
 * the host's and stays terminal; the shortfall rides beside it, and a payable
 * with no fact answers exactly what it always did.
 */
describe('the /status answer of a terminal payable', () => {
  it('carries the shortfall beside the token', async () => {
    const world = setupCheckoutWorld({
      payable: { state: 'CLOSED' },
      config: { payables: payablesWith(async () => ({ shortfall: SHORT })) },
    });
    const { status, body } = await call(world.routes, 'GET', STATUS);
    expect(status).toBe(200);
    expect(body).toEqual({ data: 'CLOSED', shortfall: SHORT });
  });

  it('answers the bare token when the host states no fact (a decline)', async () => {
    const world = setupCheckoutWorld({
      payable: { state: 'CLOSED' },
      config: { payables: payablesWith(async () => null) },
    });
    const { body } = await call(world.routes, 'GET', STATUS);
    // No `shortfall` key at all: the client must not be able to infer one.
    expect(body).toEqual({ data: 'CLOSED' });
  });

  it('answers the bare token for a host that never implemented the port', async () => {
    const world = setupCheckoutWorld({ payable: { state: 'CLOSED' } });
    const { body } = await call(world.routes, 'GET', STATUS);
    expect(body).toEqual({ data: 'CLOSED' });
  });

  it('never asks for facts on an OPEN poll, the waiting loop', async () => {
    const statusFacts = vi.fn(async (): Promise<CheckoutStatusFacts | null> => ({ shortfall: SHORT }));
    const world = setupCheckoutWorld({ config: { payables: payablesWith(statusFacts, 'OPEN') } });
    const { body } = await call(world.routes, 'GET', STATUS);
    expect(body).toEqual({ data: 'OPEN' });
    expect(statusFacts).not.toHaveBeenCalled();
  });

  it('sends the body through the host responder when it has a status envelope', async () => {
    const world = setupCheckoutWorld({
      payable: { state: 'CLOSED' },
      config: {
        payables: payablesWith(async () => ({ shortfall: SHORT })),
        respond: {
          ok: (data) => Response.json({ result: data }),
          fail: (failure, status) => Response.json({ problem: failure.code }, { status }),
          status: (answer) => Response.json({ result: answer.data, facts: answer }),
        },
      },
    });
    const { body } = await call(world.routes, 'GET', STATUS);
    expect(body).toEqual({ result: 'CLOSED', facts: { data: 'CLOSED', shortfall: SHORT } });
  });
});

describe('checkoutStatusBody', () => {
  it('lets the stock-gone fact win: nothing is missing, so nothing is asked', () => {
    const body = checkoutStatusBody('FAILED', {
      shortfall: SHORT,
      stockGone: { receivedCents: 2070, missing: ['Pão de queijo'] },
    });
    expect(body).toEqual({ data: 'FAILED', stockGone: { receivedCents: 2070, missing: ['Pão de queijo'] } });
  });

  it('sends a balance at or below zero as 0 (the store is checking it)', () => {
    expect(shortfallFact({ ...SHORT, dueCents: -310 }).dueCents).toBe(0);
  });

  it('keeps each resolution the host states', () => {
    for (const resolution of ['REFUNDED', 'REFUND_PENDING', 'SETTLED', null] as const) {
      expect(shortfallFact({ ...SHORT, resolution }).resolution).toBe(resolution);
    }
  });

  it.each([
    ['a fractional amount', { totalCents: 20.7 }],
    ['a negative capture', { paidCents: -1 }],
    ['no capture at all', { paidCents: 0 }],
    ['an unknown resolution', { resolution: 'MAYBE' as never }],
  ])('throws on %s rather than answering the decline screen', (_what, over) => {
    expect(() => checkoutStatusBody('FAILED', { shortfall: { ...SHORT, ...over } })).toThrow(TypeError);
  });
});

describe('a BALANCE payable', () => {
  it('settles with only what this charge captured, and the same input an ordinary payable gets', async () => {
    const seen: Record<string, unknown>[] = [];
    const balanceWorld = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { settledAmount: BRL(1380) }) }],
      payable: { amount: BRL(1380), balance: true },
      config: {
        correlation: {
          attachPending: async () => undefined,
          recordCardOutcome: async () => 'SETTLED',
          settle: async (input) => {
            seen.push({ ...input });
            return 'SETTLED';
          },
        },
      },
    });
    await call(balanceWorld.routes, 'POST', '/', {});
    await call(balanceWorld.routes, 'GET', STATUS);
    // No balance mark (B4): the webhook and the sweep could never carry one, so
    // the host tells the difference charge from its own record.
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['capturedAmount', 'charge', 'method', 'ref']);
    expect(seen[0]?.capturedAmount).toEqual(BRL(1380));
  });

  it('asks for its facts even while OPEN, and an ordinary OPEN payable does not (NB1)', async () => {
    const balanceFacts = vi.fn(async (): Promise<CheckoutStatusFacts | null> => ({ shortfall: SHORT }));
    const balance = setupCheckoutWorld({
      config: { payables: { ...payablesWith(balanceFacts, 'OPEN'), load: balanceLoad } },
    });
    const { body } = await call(balance.routes, 'GET', STATUS);
    expect(body).toEqual({ data: 'OPEN', shortfall: SHORT });
    expect(balanceFacts).toHaveBeenCalledTimes(1);
  });

  it('voids the full-amount code a balance raise leaves behind', async () => {
    const world = setupCheckoutWorld({ chain: [{ name: 'alpha', adapter: testAdapter('alpha', { cancelable: true }) }] });
    const cancel = vi.spyOn(world.gateway, 'cancelCharge');
    await call(world.routes, 'POST', '/', {});
    const [full] = await world.charges.listPayable({ merchant: world.world.payable.merchant, reference: REF });
    expect(full?.snapshot.amount).toEqual(BRL(7500));

    world.world.payable = { ...world.world.payable, amount: BRL(1380), balance: true };
    await call(world.routes, 'POST', '/', {});

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]?.[2]).toBe(full?.snapshot.providerChargeId);
  });

  it('hands back the live difference code on a second raise, and voids nothing it holds', async () => {
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { cancelable: true }) }],
      payable: { amount: BRL(1380), balance: true },
    });
    const cancel = vi.spyOn(world.gateway, 'cancelCharge');
    await call(world.routes, 'POST', '/', {});
    await call(world.routes, 'POST', '/', {});
    const live = await world.charges.listPayable({ merchant: world.world.payable.merchant, reference: REF });
    // One difference charge per short (I6), still payable.
    expect(live).toHaveLength(1);
    expect(cancel).not.toHaveBeenCalled();
  });
});

/** The harness's payable port, plus a `statusFacts` answer. */
function payablesWith(
  statusFacts: () => Promise<CheckoutStatusFacts | null>,
  state: 'OPEN' | 'CLOSED' = 'CLOSED',
) {
  return {
    load: async (_caller: unknown, ref: string) =>
      ref === REF
        ? {
            ref: REF,
            merchant: { kind: 'TENANT' as const, id: 'merchant-1' },
            amount: BRL(2070),
            method: 'PIX' as const,
            customer: {},
            state,
          }
        : null,
    stateToken: (payable: { state: string }) => payable.state,
    statusFacts,
  };
}

/** A parked short loaded for its difference: OPEN, its amount the balance. */
async function balanceLoad(_caller: unknown, ref: string) {
  return ref === REF
    ? {
        ref: REF,
        merchant: { kind: 'TENANT' as const, id: 'merchant-1' },
        amount: BRL(1380),
        method: 'PIX' as const,
        customer: {},
        state: 'OPEN' as const,
        balance: true as const,
      }
    : null;
}
