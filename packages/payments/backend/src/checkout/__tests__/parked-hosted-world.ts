import { CredentialsError, ProviderRequestError } from '../../core/errors';
import { createPaymentsGateway } from '../../core/gateway';
import type { SupersededCharge } from '../../core/hosted-retire';
import type { CredentialStore } from '../../core/ports';
import type { ProviderFailureReport } from '../../core/provider-failure';
import { defineProviders } from '../../core/registry';
import type { ChargeSnapshot, ChargeStatus, ProviderName } from '../../core/types';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from '../../memory';
import { createMemoryWebhookInbox } from '../../memory-webhook-inbox';
import { stubPendingSnapshot } from '../../providers/shared';
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
/**
 * `parked`: a live `alpha` link minted with `alpha` heading the chain.
 * `failover`: a live `alpha` link minted while `beta` headed the chain and was
 * DOWN — the walk failed over onto `alpha` (FUT-563).
 */
export type PriorAttempt = 'none' | 'parked' | 'failover' | 'expired' | 'paid' | 'failed';
/** What `alpha` does when asked to void: nothing, void, refuse, or answer PAID / PENDING. */
type AlphaVoid = boolean | 'fails' | 'paid' | 'pending';
export type Instrument = 'none' | 'tokenAlpha' | 'tokenBeta';

/** The stored status a non-payable prior attempt is left in. */
const PRIOR_STATUS: Record<Exclude<PriorAttempt, 'none' | 'parked' | 'failover'>, ChargeStatus> = {
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

/** `alpha` with the void behaviour a case asks for. */
function alphaAdapter(voids: AlphaVoid) {
  const adapter = testAdapter('alpha', { tokenization: 'REDIRECT', hosted: true, cancelable: voids === true });
  if (typeof voids === 'boolean') return adapter;
  return {
    ...adapter,
    async cancelCharge(providerChargeId: string): Promise<ChargeSnapshot> {
      if (voids === 'fails') throw new ProviderRequestError('alpha', 'alpha refused the void', { httpStatus: 502 });
      const status: ChargeStatus = voids === 'paid' ? 'PAID' : 'PENDING';
      return { ...stubPendingSnapshot('alpha', providerChargeId), status, amount: BRL(4200) };
    },
  };
}

/** `beta`, switchable DOWN: a refused connection, which provably created nothing. */
function betaAdapter(state: { down: boolean }) {
  const adapter = testAdapter('beta', { tokenization: 'PUBLIC_KEY' });
  return {
    ...adapter,
    async createCharge(...args: Parameters<typeof adapter.createCharge>) {
      if (state.down) throw new TypeError('fetch failed: beta is down', { cause: { code: 'ECONNREFUSED' } });
      return adapter.createCharge(...args);
    },
  };
}

export function parkedHostedWorld(options: { alphaVoids: AlphaVoid }) {
  const credentials = switchableCredentials();
  const beta = { down: false };
  const charges = createMemoryChargeStore();
  const reports: ProviderFailureReport[] = [];
  const gateway = createPaymentsGateway({
    providers: defineProviders({
      alpha: alphaAdapter(options.alphaVoids),
      beta: betaAdapter(beta),
    }),
    credentials: credentials.store,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
    onProviderFailure: (report: ProviderFailureReport) => {
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
    // The same reporter the gateway was handed, as a host passes both.
    onProviderFailure: (report: ProviderFailureReport) => {
      reports.push(report);
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

  /** `[beta, alpha]` with `beta` down: the walk fails over and mints at `alpha`. */
  async function parkAfterFailover(): Promise<ChargeSnapshot> {
    credentials.state.chain = ['beta', 'alpha'];
    beta.down = true;
    const parked = await raiseCharge(deps, payable, { method: 'PIX' });
    beta.down = false;
    credentials.state.chain = ['alpha', 'beta'];
    return parked;
  }

  return {
    charges,
    credentials: credentials.state,
    beta,
    superseded,
    reports,
    logs,
    payable,
    pay: (method: 'PIX' | 'CARD', card?: CheckoutCard) => raiseCharge(deps, payable, { method, card }),
    /** Park an `alpha` link under `[alpha, beta]`, left in the prior's state. */
    async park(prior: PriorAttempt): Promise<ChargeSnapshot | null> {
      if (prior === 'none') return null;
      if (prior === 'failover') return parkAfterFailover();
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
