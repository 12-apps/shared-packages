import type { ActivationContext } from '../activation/context';
import type { PendingVerification, StoredProviderConfig } from '../config/types';
import type {
  DeliveryPaymentProof,
  PaymentProviderAdapter,
  PaymentProviderAdapterBase,
} from '../core/provider';
import type { ProviderRegistry } from '../core/registry';
import { defineProviders } from '../core/registry';
import type { MerchantRef } from '../core/types';

/**
 * Purpose-built fakes for the activation suites (FUT-558) — kept apart from
 * `fixtures.ts`, whose fakes serve the gateway's walk/webhook rules. These
 * tests exercise the activation flow's own decisions, so the adapter is
 * whatever each case scripts and the stores are plain maps.
 */

/**
 * A full adapter whose behaviour each test overrides per case.
 *
 * The payment-proof pair is a THIRD argument rather than two more overrides:
 * it is one declaration on the contract (FUT-726), and a fake that could set
 * `verifyConfirmsPayment` on its own would be a shape no real adapter is
 * allowed to have — the case it fakes could never happen in production.
 */
export function activationAdapter(
  name: string,
  overrides: Partial<PaymentProviderAdapterBase> = {},
  proof: DeliveryPaymentProof = {},
): PaymentProviderAdapter {
  return {
    ...proof,
    name,
    displayName: overrides.displayName ?? 'Fake',
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: false,
      refunds: true,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
    },
    credentialSchema: [{ key: 'token', label: 'Token', secret: true, required: true }],
    async verifyCredentials() {
      return { ok: true };
    },
    async createCharge() {
      throw new Error('createCharge not scripted for this case');
    },
    async getCharge() {
      throw new Error('getCharge not scripted for this case');
    },
    webhook: {
      verify: async () => true,
      parse: async () => [],
    },
    clientConfig: () => ({ provider: name, tokenization: 'PUBLIC_KEY' }),
    ...overrides,
  };
}

/** A registry of exactly the adapters a case cares about. */
export function activationRegistry(
  adapters: Record<string, PaymentProviderAdapter>,
): ProviderRegistry {
  return defineProviders(adapters);
}

/** A connected (but deliberately NOT enabled) stored config. */
export function connectedConfig(
  overrides: Partial<StoredProviderConfig> = {},
): StoredProviderConfig {
  return {
    provider: 'pagbank',
    // Off on purpose: verification runs BEFORE activation, so the flow must
    // read credentials of a provider that is still disabled.
    enabled: false,
    priority: 0,
    environment: 'PRODUCTION',
    status: 'VERIFIED',
    lastVerifiedAt: null,
    chargeVerifiedAt: null,
    pendingVerification: null,
    expiresAt: null,
    stub: false,
    environments: { SANDBOX: {}, PRODUCTION: { token: 'live-token' } },
    ...overrides,
  };
}

/** In-memory pending-verification rows, keyed per (merchant, provider). */
export interface FakeSettings {
  getPendingVerification: ActivationContext['settings']['getPendingVerification'];
  setPendingVerification: ActivationContext['settings']['setPendingVerification'];
  pendingOf(merchant: MerchantRef, provider: string): PendingVerification | null;
}

export function fakeSettings(): FakeSettings {
  const rows = new Map<string, PendingVerification>();
  const keyOf = (merchant: MerchantRef, provider: string): string =>
    JSON.stringify([merchant.kind, merchant.id, provider]);
  return {
    async getPendingVerification(merchant, provider) {
      return rows.get(keyOf(merchant, provider)) ?? null;
    },
    async setPendingVerification(merchant, provider, pending) {
      if (pending === null) rows.delete(keyOf(merchant, provider));
      else rows.set(keyOf(merchant, provider), pending);
    },
    pendingOf(merchant, provider) {
      return rows.get(keyOf(merchant, provider)) ?? null;
    },
  };
}

/** A context over one adapter and one stored config — the common case. */
export function activationContextFor(options: {
  providers: ProviderRegistry;
  config?: StoredProviderConfig | null;
  settings?: FakeSettings;
  webhookUrl?: ActivationContext['webhookUrl'];
  returnUrl?: ActivationContext['returnUrl'];
  mintCardPublicKey?: ActivationContext['mintCardPublicKey'];
}): ActivationContext {
  const stored = options.config ?? null;
  return {
    providers: options.providers,
    config: { get: async () => stored },
    settings: options.settings ?? fakeSettings(),
    ...(options.webhookUrl ? { webhookUrl: options.webhookUrl } : {}),
    ...(options.returnUrl ? { returnUrl: options.returnUrl } : {}),
    ...(options.mintCardPublicKey ? { mintCardPublicKey: options.mintCardPublicKey } : {}),
  };
}

export const ACME: MerchantRef = { kind: 'TENANT', id: 'client-1' };
