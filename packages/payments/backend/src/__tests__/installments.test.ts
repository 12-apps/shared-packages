import { describe, expect, it, vi } from 'vitest';

import { createCycleCollector, type CollectableCycle, type CycleStore } from '../core/cycle-collection';
import { AdapterContractError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { simulatedInstallments, type InstallmentCapability } from '../core/installments';
import { defineProviders } from '../core/registry';
import type { MerchantRef } from '../core/types';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';
import { STUB_CREDS, chargelessAdapter } from './fixtures';

/**
 * INSTALMENTS the buyer pays the interest on (FUT-4382), through a REAL
 * gateway: the quote it answers a host, the deterministic simulated table, and
 * the PagBank refusal the cycle collector must give until its buyer-interest
 * contract is proven in a sandbox.
 */

const PLATFORM: MerchantRef = { kind: 'PLATFORM', id: 'platform' };
const BRL = (amountCents: number) => ({ amountCents, currency: 'BRL' });
const CARD = { savedCardToken: 'CARD_A' };

function world(quoting: InstallmentCapability | undefined = simulatedInstallments()) {
  const stores = { credentials: createMemoryCredentialStore(), charges: createMemoryChargeStore() };
  const providers = defineProviders({
    quoting: { ...chargelessAdapter('quoting'), installments: quoting },
    plain: chargelessAdapter('plain'),
    pagbank: pagbankProvider(PT_BR_PAGBANK_COPY),
  } as const);
  return {
    ...stores,
    gateway: createPaymentsGateway({
      providers,
      ...stores,
      webhooks: createMemoryWebhookInbox(),
      attempts: createMemoryAttemptLedger(),
    }),
  };
}

describe('simulatedInstallments — the deterministic table', () => {
  it('charges no interest in one payment', async () => {
    expect(await simulatedInstallments().quote({ amount: BRL(10_000), installments: 1, card: CARD }, STUB_CREDS)).toEqual({
      installments: 1,
      perInstallment: BRL(10_000),
      total: BRL(10_000),
      interest: BRL(0),
    });
  });

  it.each([
    [2, 5225, 10_450],
    [3, 3535, 10_605],
    [12, 1004, 12_048],
  ])('prices %ix of R$100 on 2.99%% a month', async (installments, per, total) => {
    expect(await simulatedInstallments().quote({ amount: BRL(10_000), installments, card: CARD }, STUB_CREDS)).toEqual({
      installments,
      perInstallment: BRL(per),
      total: BRL(total),
      interest: BRL(total - 10_000),
    });
  });

  it('splits interest-free at a zero rate, the principal untouched', async () => {
    const free = simulatedInstallments({ monthlyRateBps: 0 });
    const quote = await free.quote({ amount: BRL(10_000), installments: 3, card: CARD }, STUB_CREDS);
    expect(quote).toMatchObject({ total: BRL(10_000), interest: BRL(0), perInstallment: BRL(3334) });
  });
});

describe('gateway.quoteInstallments', () => {
  it("answers the provider's own price for the count", async () => {
    const { credentials, gateway } = world();
    credentials.set(PLATFORM, 'quoting', STUB_CREDS);

    const result = await gateway.quoteInstallments(PLATFORM, { amount: BRL(10_000), installments: 3, card: CARD });

    expect(result).toEqual({
      ok: true,
      provider: 'quoting',
      quote: { installments: 3, perInstallment: BRL(3535), total: BRL(10_605), interest: BRL(605) },
    });
  });

  it('answers one payment at the principal on a provider that quotes nothing', async () => {
    const { credentials, gateway } = world();
    credentials.set(PLATFORM, 'plain', STUB_CREDS);

    const result = await gateway.quoteInstallments(PLATFORM, { amount: BRL(10_000), installments: 1, card: CARD });

    expect(result).toMatchObject({ ok: true, quote: { total: BRL(10_000), interest: BRL(0) } });
  });

  it('refuses a split on a provider with no quote, as a value rather than a throw', async () => {
    const { credentials, gateway } = world();
    credentials.set(PLATFORM, 'plain', STUB_CREDS);

    expect(await gateway.quoteInstallments(PLATFORM, { amount: BRL(10_000), installments: 2, card: CARD })).toEqual({
      ok: false,
      provider: 'plain',
      refusal: 'installments-unsupported',
    });
  });

  it.each([0, 13, 2.5])('refuses a count of %s as out of range', async (installments) => {
    const { credentials, gateway } = world();
    credentials.set(PLATFORM, 'quoting', STUB_CREDS);

    const result = await gateway.quoteInstallments(PLATFORM, { amount: BRL(10_000), installments, card: CARD });

    expect(result).toMatchObject({ ok: false, refusal: 'installments-out-of-range' });
  });

  it("refuses a count past the provider's own maximum", async () => {
    const { credentials, gateway } = world(simulatedInstallments({ maxInstallments: 6 }));
    credentials.set(PLATFORM, 'quoting', STUB_CREDS);

    const result = await gateway.quoteInstallments(PLATFORM, { amount: BRL(10_000), installments: 7, card: CARD });

    expect(result).toMatchObject({ ok: false, refusal: 'installments-out-of-range' });
  });

  it('refuses a merchant-initiated split where the provider takes none', async () => {
    const { credentials, gateway } = world(simulatedInstallments({ merchantInitiated: false }));
    credentials.set(PLATFORM, 'quoting', STUB_CREDS);
    const request = { amount: BRL(10_000), installments: 3, card: CARD };

    expect(await gateway.quoteInstallments(PLATFORM, { ...request, merchantInitiated: true })).toMatchObject({
      ok: false,
      refusal: 'installments-merchant-initiated',
    });
    // The cardholder at the screen is still offered it.
    expect(await gateway.quoteInstallments(PLATFORM, request)).toMatchObject({ ok: true });
  });

  it('throws on a quote that does not price the principal — never charges a made-up total', async () => {
    const broken: InstallmentCapability = {
      maxInstallments: 12,
      merchantInitiated: true,
      quote: async ({ installments }) => ({
        installments,
        perInstallment: BRL(1000),
        total: BRL(3000),
        interest: BRL(0),
      }),
    };
    const { credentials, gateway } = world(broken);
    credentials.set(PLATFORM, 'quoting', STUB_CREDS);

    await expect(
      gateway.quoteInstallments(PLATFORM, { amount: BRL(10_000), installments: 3, card: CARD }),
    ).rejects.toBeInstanceOf(AdapterContractError);
  });
});

const CYCLE: CollectableCycle = {
  id: 'cycle-9',
  groupId: 'group-9',
  amount: BRL(10_000),
  customer: { name: 'Acme Ltda', email: 'fin@acme.example', taxId: '11222333000181' },
};

function collectorOn(provider: 'quoting' | 'pagbank') {
  const w = world();
  w.credentials.set(PLATFORM, provider, STUB_CREDS);
  const record = vi.fn<CycleStore['recordRaised']>(async () => undefined);
  const built = createCycleCollector({
    gateway: w.gateway,
    credentials: w.credentials,
    cycles: { read: async () => ({ cycle: CYCLE, providerChargeId: null }), recordRaised: record },
    instruments: async () => ({
      instrument: { provider, providerInstrumentId: 'CARD_A', providerCustomerId: null },
      hasAny: true,
    }),
    merchant: PLATFORM,
    enabled: async () => true,
  });
  return { ...w, collector: built, recordRaised: record };
}

describe('collectByCard in instalments through a real gateway', () => {
  it('charges the simulated total in N and records principal and total apart', async () => {
    const { collector, recordRaised, charges } = collectorOn('quoting');

    const result = await collector.collectByCard('cycle-9', { installments: 3 });

    expect(result.skipped).toBeNull();
    expect(result.snapshot).toMatchObject({ amount: BRL(10_605), installments: 3, principal: BRL(10_000) });
    expect(charges.all()[0]?.snapshot.amount).toEqual(BRL(10_605));
    expect(recordRaised).toHaveBeenCalledWith('cycle-9', expect.objectContaining({
      provider: 'quoting',
      installments: { count: 3, principal: BRL(10_000), total: BRL(10_605) },
    }));
  });

  it('refuses PagBank above one payment: nothing charged, nothing recorded', async () => {
    // PagBank's buyer-interest contract waits for a sandbox run, so it quotes
    // nothing. Charging once, or the principal in N, would both be wrong.
    const { collector, recordRaised, charges } = collectorOn('pagbank');

    expect(await collector.collectByCard('cycle-9', { installments: 3 })).toEqual({
      skipped: 'installments-unsupported',
      snapshot: null,
    });
    expect(charges.all()).toHaveLength(0);
    expect(recordRaised).not.toHaveBeenCalled();
  });
});
