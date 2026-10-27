import { describe, expect, it, vi } from 'vitest';

import { createChargeRaiser, type ChargeRaiseDeps } from '../core/charge-raise';
import { CredentialsError, UnsupportedOperationError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { landingProvider, type ChainMember } from '../core/hosted-landing';
import { retireMovedPast, type RetireDeps, type SupersededCharge } from '../core/hosted-retire';
import type { ProviderFailureReport } from '../core/provider-failure';
import { defineProviders } from '../core/registry';
import type { ChargeSnapshot, MerchantRef, Money } from '../core/types';
import { testAdapter } from '../checkout/__tests__/harness';
import { createMemoryAttemptLedger, createMemoryChargeStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';

/**
 * FUT-4072 at the host-facing raiser (`createChargeRaiser`) — the path an
 * adopting host's own pay route takes — and the two pieces it is built from.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'acme' };
const BRL = (amountCents: number): Money => ({ amountCents, currency: 'BRL' });
const BOTH = ['PIX', 'CARD'] as const;

function snapshot(over: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
  return {
    provider: 'hosted',
    providerChargeId: 'LINK',
    status: 'PENDING',
    amount: BRL(1000),
    method: 'PIX',
    hostedCheckoutUrl: 'https://pay.example/LINK',
    ...over,
  } as ChargeSnapshot;
}

const REQUEST = {
  merchant: TENANT,
  reference: 'ord_1',
  amount: BRL(1000),
  method: 'PIX' as const,
  customer: { name: 'Ana', email: 'a@x.com', taxId: '12345678909' },
};

function raiser(over: {
  chain: ChainMember[];
  parked?: ChargeSnapshot[];
  cancel?: () => Promise<ChargeSnapshot>;
  onSuperseded?: ChargeRaiseDeps['onSuperseded'];
  /** The walk that minted each parked link, as the ledger answers it. */
  walkedPast?: string[];
}) {
  const calls = { warn: [] as string[], error: [] as string[] };
  const d: ChargeRaiseDeps = {
    gateway: {
      charge: vi.fn(async (_m: MerchantRef, input: { idempotencyKey?: string }) => ({
        reference: 'ord_1',
        idempotencyKey: input.idempotencyKey ?? null,
        snapshot: snapshot({ provider: 'browser', providerChargeId: 'NEW', hostedCheckoutUrl: undefined }),
      })) as unknown as ChargeRaiseDeps['gateway']['charge'],
      cancelCharge: vi.fn(over.cancel ?? (async () => snapshot({ status: 'CANCELED' }))),
      clientConfigChain: vi.fn(async () => over.chain),
      ...(over.walkedPast ? { stillWalkedPast: vi.fn(async () => over.walkedPast ?? []) } : {}),
    },
    charges: {
      listPayable: vi.fn(async (q: { method?: string }) =>
        q.method ? [] : (over.parked ?? []).map((s) => ({ snapshot: s, idempotencyKey: 'ord_1:0' })),
      ),
      countByReference: vi.fn(async () => 1),
      latestByReference: vi.fn(async () => null),
      listPendingCharges: vi.fn(async () => []),
    } as unknown as ChargeRaiseDeps['charges'],
    log: { warn: (m) => calls.warn.push(m), error: (m) => calls.error.push(m) },
    ...(over.onSuperseded ? { onSuperseded: over.onSuperseded } : {}),
  };
  return { raise: createChargeRaiser(d), d, calls };
}

const HOSTED_FIRST: ChainMember[] = [
  { provider: 'hosted', methods: BOTH },
  { provider: 'browser', methods: BOTH },
];
const BROWSER_FIRST: ChainMember[] = [...HOSTED_FIRST].reverse();

describe('createChargeRaiser — a parked link against the current chain', () => {
  it('reuses the link while its provider is still first (FUT-604)', async () => {
    const { raise, d } = raiser({ chain: HOSTED_FIRST, parked: [snapshot()] });

    expect((await raise(REQUEST)).providerChargeId).toBe('LINK');
    expect(d.gateway.charge).not.toHaveBeenCalled();
  });

  it('walks the current chain once the link provider is no longer first, and voids the link', async () => {
    const { raise, d } = raiser({ chain: BROWSER_FIRST, parked: [snapshot()] });

    expect((await raise({ ...REQUEST, method: 'CARD' })).providerChargeId).toBe('NEW');
    expect(d.gateway.cancelCharge).toHaveBeenCalledWith(TENANT, 'hosted', 'LINK');
  });

  it('walks when the link provider left the chain (disabled or removed)', async () => {
    const { raise, d } = raiser({ chain: [BROWSER_FIRST[0] as ChainMember], parked: [snapshot()] });

    expect((await raise(REQUEST)).providerChargeId).toBe('NEW');
    expect(d.gateway.charge).toHaveBeenCalledTimes(1);
  });

  it('hands an unvoidable link to the host recorder', async () => {
    const recorded: SupersededCharge[] = [];
    const { raise } = raiser({
      chain: BROWSER_FIRST,
      parked: [snapshot()],
      cancel: async () => {
        throw new UnsupportedOperationError('hosted', 'cancelling a charge');
      },
      onSuperseded: (charge) => {
        recorded.push(charge);
      },
    });

    await raise(REQUEST);

    expect(recorded.map((r) => [r.reference, r.snapshot.providerChargeId, r.replacedBy.providerChargeId, r.why]))
      .toEqual([['ord_1', 'LINK', 'NEW', 'VOID_UNSUPPORTED']]);
  });

  it('skips a store-confirmed member ahead of the link on an AUTOMATIC lane', async () => {
    const { raise, d } = raiser({
      chain: [{ provider: 'manual', methods: BOTH, confirmation: 'MANUAL' }, ...HOSTED_FIRST],
      parked: [snapshot()],
    });

    expect((await raise({ ...REQUEST, confirmation: 'AUTOMATIC' })).providerChargeId).toBe('LINK');
    expect(d.gateway.charge).not.toHaveBeenCalled();
  });

  it('does not read the chain when nothing is parked', async () => {
    const { raise, d } = raiser({ chain: BROWSER_FIRST });

    await raise(REQUEST);

    expect(d.gateway.clientConfigChain).not.toHaveBeenCalled();
  });
});

describe('createChargeRaiser — the ledger and the links not reused', () => {
  it('reuses a link minted while the head was down, per the walk ledger', async () => {
    const { raise, d } = raiser({ chain: BROWSER_FIRST, parked: [snapshot()], walkedPast: ['browser'] });

    expect((await raise(REQUEST)).providerChargeId).toBe('LINK');
    expect(d.gateway.stillWalkedPast).toHaveBeenCalledWith(TENANT, 'ord_1:0');
    expect(d.gateway.charge).not.toHaveBeenCalled();
  });

  it('does not reuse it when the ledger shows the head was never tried', async () => {
    const { raise } = raiser({ chain: BROWSER_FIRST, parked: [snapshot()], walkedPast: [] });

    expect((await raise(REQUEST)).providerChargeId).toBe('NEW');
  });

  it('retires the other parked links against the one it reuses', async () => {
    const older = snapshot({ provider: 'elsewhere', providerChargeId: 'OLDER' });
    const { raise, d } = raiser({ chain: HOSTED_FIRST, parked: [snapshot(), older] });

    expect((await raise(REQUEST)).providerChargeId).toBe('LINK');
    expect(d.gateway.cancelCharge).toHaveBeenCalledWith(TENANT, 'elsewhere', 'OLDER');
    expect(d.gateway.cancelCharge).toHaveBeenCalledTimes(1);
  });
});

describe('createChargeRaiser — a moved-past link the buyer already paid', () => {
  it('answers with the PAID link and retires the charge it just raised', async () => {
    const recorded: SupersededCharge[] = [];
    const { raise, d } = raiser({
      chain: BROWSER_FIRST,
      parked: [snapshot()],
      // The parked link comes back PAID; the fresh charge cannot be voided.
      cancel: vi
        .fn()
        .mockResolvedValueOnce(snapshot({ status: 'PAID' }))
        .mockRejectedValueOnce(new UnsupportedOperationError('browser', 'cancelling a charge')),
      onSuperseded: (charge) => {
        recorded.push(charge);
      },
    });

    const got = await raise(REQUEST);

    expect([got.providerChargeId, got.status]).toEqual(['LINK', 'PAID']);
    expect(d.gateway.cancelCharge).toHaveBeenNthCalledWith(2, TENANT, 'browser', 'NEW');
    expect(recorded.map((r) => [r.snapshot.providerChargeId, r.replacedBy.providerChargeId, r.why])).toEqual([
      ['NEW', 'LINK', 'VOID_UNSUPPORTED'],
    ]);
  });
});

describe('landingProvider', () => {
  it('is the first member able to take the method', () => {
    const chain: ChainMember[] = [
      { provider: 'card-only', methods: ['CARD'] },
      { provider: 'hosted', methods: BOTH },
    ];
    expect(landingProvider(chain, 'PIX')).toBe('hosted');
    expect(landingProvider(chain, 'CARD')).toBe('card-only');
    expect(landingProvider([], 'PIX')).toBeNull();
  });
});

describe('retireMovedPast', () => {
  function retireDeps(over: Partial<RetireDeps> = {}) {
    const calls = { warn: [] as string[], error: [] as string[] };
    const deps: RetireDeps = {
      gateway: { cancelCharge: vi.fn(async () => snapshot({ status: 'CANCELED' })) },
      charges: { markSuperseded: vi.fn(async () => undefined) },
      log: { warn: (m) => calls.warn.push(m), error: (m) => calls.error.push(m) },
      ...over,
    };
    return { deps, calls };
  }
  const NEW = snapshot({ provider: 'browser', providerChargeId: 'NEW', hostedCheckoutUrl: undefined });
  const input = (raised: ChargeSnapshot) => ({ merchant: TENANT, reference: 'ord_1', movedPast: [snapshot()], raised });

  it('keeps the link when the new charge is not live', async () => {
    const { deps, calls } = retireDeps();

    await retireMovedPast(deps, input({ ...NEW, status: 'DECLINED' }));

    expect(deps.gateway.cancelCharge).not.toHaveBeenCalled();
    expect(calls.warn.join()).toContain('DECLINED');
  });

  it('never retires the charge it was handed back as the new one', async () => {
    const { deps } = retireDeps();

    await retireMovedPast(deps, input(snapshot()));

    expect(deps.gateway.cancelCharge).not.toHaveBeenCalled();
  });

  it('logs an error by name when no recorder is wired', async () => {
    const { deps, calls } = retireDeps({
      gateway: {
        cancelCharge: vi.fn(async () => {
          throw new UnsupportedOperationError('hosted', 'cancelling a charge');
        }),
      },
    });

    await retireMovedPast(deps, input(NEW));

    expect(calls.error.join()).toContain('payments.superseded hosted charge LINK');
  });

  it('contains a recorder that throws', async () => {
    const { deps, calls } = retireDeps({
      gateway: {
        cancelCharge: vi.fn(async () => {
          throw new Error('timeout');
        }),
      },
      onSuperseded: () => {
        throw new Error('db down');
      },
    });

    await expect(retireMovedPast(deps, input(NEW))).resolves.toBeNull();
    expect(calls.error.join()).toContain('could not record');
  });
  it('counts a void as done only when the provider answers a state nobody can pay', async () => {
    const { deps } = retireDeps({ gateway: { cancelCharge: vi.fn(async () => snapshot({ status: 'EXPIRED' })) } });

    await retireMovedPast(deps, input(NEW));

    expect(deps.charges.markSuperseded).not.toHaveBeenCalled();
  });

  it('answers a link the void found PAID (PAID_BEFORE_VOID): logged, reported, never marked', async () => {
    const recorded: SupersededCharge[] = [];
    const reports: ProviderFailureReport[] = [];
    const { deps, calls } = retireDeps({
      gateway: { cancelCharge: vi.fn(async () => snapshot({ status: 'PAID' })) },
      onSuperseded: (charge) => {
        recorded.push(charge);
      },
      onProviderFailure: (report) => {
        reports.push(report);
      },
    });

    const paid = await retireMovedPast(deps, input(NEW));

    expect([paid?.providerChargeId, paid?.status]).toEqual(['LINK', 'PAID']);
    expect(recorded).toEqual([]);
    expect(deps.charges.markSuperseded).not.toHaveBeenCalled();
    expect(reports.map((r) => [r.path, r.severity, r.provider])).toEqual([['CANCEL', 'error', 'hosted']]);
    expect(calls.error.join()).toContain('PAID_BEFORE_VOID');
  });

  it('records VOID_NOT_CONFIRMED when the void comes back still PENDING', async () => {
    const recorded: SupersededCharge[] = [];
    const { deps } = retireDeps({
      gateway: { cancelCharge: vi.fn(async () => snapshot()) },
      onSuperseded: (charge) => {
        recorded.push(charge);
      },
    });

    await retireMovedPast(deps, input(NEW));

    expect(recorded.map((r) => r.why)).toEqual(['VOID_NOT_CONFIRMED']);
  });

  it('marks the row even when the recorder throws', async () => {
    const { deps } = retireDeps({
      gateway: {
        cancelCharge: vi.fn(async () => {
          throw new UnsupportedOperationError('hosted', 'cancelling a charge');
        }),
      },
      onSuperseded: () => {
        throw new Error('db down');
      },
    });

    await retireMovedPast(deps, input(NEW));

    expect(deps.charges.markSuperseded).toHaveBeenCalledTimes(1);
  });

  it('says so by name when the store cannot mark', async () => {
    const { deps, calls } = retireDeps({
      charges: {},
      gateway: {
        cancelCharge: vi.fn(async () => {
          throw new UnsupportedOperationError('hosted', 'cancelling a charge');
        }),
      },
    });

    await retireMovedPast(deps, input(NEW));

    expect(calls.error.join()).toContain('has no markSuperseded');
  });
});
describe('clientConfigChain — the chain the reuse rule reads', () => {
  function gatewayWith(getCredentials: () => Promise<null>) {
    return createPaymentsGateway({
      providers: defineProviders({ hosted: testAdapter('hosted'), browser: testAdapter('browser') }),
      credentials: {
        providerChain: async () => ['hosted', 'browser'],
        defaultProvider: async () => 'hosted',
        getCredentials: async (_merchant, provider) =>
          provider === 'hosted' ? getCredentials() : { environment: 'SANDBOX', fields: {}, stub: true },
      },
      charges: createMemoryChargeStore(),
      webhooks: createMemoryWebhookInbox(),
      attempts: createMemoryAttemptLedger(),
      onWebhookEvent: async () => undefined,
    });
  }

  it('leaves out a member whose credentials are refused (disabled), as the walk does', async () => {
    const gateway = gatewayWith(async () => {
      throw new CredentialsError('hosted', 'disabled');
    });

    expect((await gateway.clientConfigChain(TENANT)).map((entry) => entry.provider)).toEqual(['browser']);
  });

  it('propagates any other failure instead of reading it as absence', async () => {
    const gateway = gatewayWith(async () => {
      throw new Error('database unreachable');
    });

    await expect(gateway.clientConfigChain(TENANT)).rejects.toThrow('database unreachable');
  });
});
