import { CredentialsError, ProviderRequestError } from '../../core/errors';
import { createPaymentsGateway } from '../../core/gateway';
import type { SupersededCharge } from '../../core/hosted-retire';
import type { CredentialStore } from '../../core/ports';
import type { ProviderFailureReport } from '../../core/provider-failure';
import { defineProviders } from '../../core/registry';
import type { ChargeSnapshot, ChargeStatus, ProviderName } from '../../core/types';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from '../../memory';
import { createMemoryWebhookInbox } from '../../memory-webhook-inbox';
import { raiseCharge } from '../raise';
import type { CheckoutCard } from '../reuse';
import type { Payable } from '../types';

import { BRL, MERCHANT, testAdapter } from './harness';

/**
 * A two-provider world for FUT-4072, driven through the checkout's own
 * `raiseCharge` over a REAL gateway and the in-memory stores.
 *
 * `alpha` mints HOSTED links (a redirect provider, like the one whose parked
 * link trapped a payable in production); `beta` tokenizes in the browser. A
 * link is parked at `alpha` while the chain reads `[alpha, beta]`, then the
 * owner's state changes — reorder, disable, remove — and the buyer pays again.
 */

export type ProviderState = 'enabled' | 'disabled' | 'removed';
export type PriorAttempt = 'none' | 'parked' | 'expired' | 'paid' | 'failed';
export type Instrument = 'none' | 'tokenAlpha' | 'tokenBeta';

/** The stored status a non-payable prior attempt is left in. */
const PRIOR_STATUS: Record<Exclude<PriorAttempt, 'none' | 'parked'>, ChargeStatus> = {
  expired: 'EXPIRED',
  paid: 'PAID',
  failed: 'DECLINED',
};

export function cardOf(instrument: Instrument): CheckoutCard | undefined {
  if (instrument === 'tokenAlpha') return { tokensByProvider: { alpha: 'tok_alpha' } };
  if (instrument === 'tokenBeta') return { tokensByProvider: { beta: 'tok_beta' } };
  return undefined;
}

/**
 * The host's credential store with an owner's switches on it. A DISABLED member
 * is out of the chain and refuses credentials (a connected-but-off row throws,
 * as the port documents); a REMOVED one is out of the chain and not connected.
 */
function switchableCredentials() {
  const memory = createMemoryCredentialStore();
  const state = { chain: ['alpha', 'beta'] as ProviderName[], alpha: 'enabled' as ProviderState };
  const store: CredentialStore = {
    providerChain: async () => state.chain.filter((p) => p !== 'alpha' || state.alpha === 'enabled'),
    defaultProvider: async () => (await store.providerChain(MERCHANT))[0] ?? null,
    getCredentials: async (merchant, provider) => {
      if (provider === 'alpha' && state.alpha === 'disabled') {
        throw new CredentialsError('alpha', 'alpha is connected but disabled');
      }
      if (provider === 'alpha' && state.alpha === 'removed') return null;
      return memory.getCredentials(merchant, provider);
    },
  };
  for (const name of ['alpha', 'beta']) {
    memory.set(MERCHANT, name, { environment: 'SANDBOX', fields: {}, stub: true });
  }
  return { store, state };
}

/** `alpha` with the void behaviour a case asks for: none, a working one, or a refusing one. */
function alphaAdapter(voids: boolean | 'fails') {
  const adapter = testAdapter('alpha', { tokenization: 'REDIRECT', hosted: true, cancelable: voids === true });
  if (voids !== 'fails') return adapter;
  return {
    ...adapter,
    async cancelCharge(): Promise<ChargeSnapshot> {
      throw new ProviderRequestError('alpha', 'alpha refused the void', { httpStatus: 502 });
    },
  };
}

export function parkedHostedWorld(options: { alphaVoids: boolean | 'fails' }) {
  const credentials = switchableCredentials();
  const charges = createMemoryChargeStore();
  const reports: ProviderFailureReport[] = [];
  const gateway = createPaymentsGateway({
    providers: defineProviders({
      alpha: alphaAdapter(options.alphaVoids),
      beta: testAdapter('beta', { tokenization: 'PUBLIC_KEY' }),
    }),
    credentials: credentials.store,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
    onProviderFailure: (report) => {
      reports.push(report);
    },
  });
  const superseded: SupersededCharge[] = [];
  const logs = { warn: [] as string[], error: [] as string[] };
  const deps = {
    gateway,
    charges,
    log: {
      warn: (line: string) => logs.warn.push(line),
      error: (line: string) => logs.error.push(line),
      providerFailure: () => undefined,
    },
    onSuperseded: (charge: SupersededCharge) => {
      superseded.push(charge);
    },
  };
  const payable: Payable = {
    ref: 'inv_4072',
    merchant: MERCHANT,
    amount: BRL(4200),
    method: 'PIX',
    customer: { name: 'Ana Buyer', email: 'ana@example.com', taxId: '12345678909' },
    state: 'OPEN',
  };

  return {
    charges,
    credentials: credentials.state,
    superseded,
    reports,
    logs,
    payable,
    pay: (method: 'PIX' | 'CARD', card?: CheckoutCard) => raiseCharge(deps, payable, { method, card }),
    /** Park an `alpha` link under `[alpha, beta]`, left in the prior's state. */
    async park(prior: PriorAttempt): Promise<ChargeSnapshot | null> {
      if (prior === 'none') return null;
      const parked = await raiseCharge(deps, payable, { method: 'PIX' });
      if (prior === 'parked') return parked;
      const moved = { ...parked, status: PRIOR_STATUS[prior] };
      await charges.upsertByProviderChargeId(MERCHANT, moved);
      return moved;
    },
    statusOf: (snapshot: ChargeSnapshot) =>
      charges.all().find((row) => row.providerChargeId === snapshot.providerChargeId)?.snapshot.status,
  };
}
