import { createOAuthConnectService, type RevokeFailure } from '../config/oauth';
import { createSettingsService, credentialStoreFrom } from '../config/service';
import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import { createPaymentsHttp, type PaymentsHttpHandlers } from '../http/handlers';
import type { WebhookEventHandler, WebhookInbox } from '../core/ports';
import type {
  ChargeInput,
  MerchantRef,
  NormalizedWebhookEvent,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';
import {
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
  createMemoryAttemptLedger,
  type MemoryChargeStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import type { PaymentProviderAdapter } from '../core/provider';
import { infinitePayProvider } from '../providers/infinitepay';
import {
  sharedSecretWebhook,
  stubCharge,
  stubChargeId,
  stubPendingSnapshot,
  stubRefund,
} from '../providers/shared';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';

/**
 * The adapter the GATEWAY tests run against.
 *
 * Deliberately a purpose-built fake rather than a real vendor adapter: these
 * tests exercise the gateway's own rules (dedup, inbox, ownership, capability
 * gating), and pinning them to a vendor's wire format means every future
 * change to that vendor's webhook shape breaks tests that were never about it.
 * It registers under the name `stone` only so the fixtures below read as a
 * concrete provider.
 */
function fakeAdapter(name = 'stone'): PaymentProviderAdapter {
  return {
    name,
    displayName: 'Fake',
    capabilities: {
      methods: ['PIX', 'CARD', 'BOLETO'],
      savedCards: true,
      refunds: true,
      partialRefunds: true,
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
    },
    credentialSchema: [
      { key: 'secretKey', label: 'Secret key', secret: true, required: true },
      { key: 'webhookSecret', label: 'Webhook secret', secret: true, required: true },
    ],
    async verifyCredentials(credentials) {
      return credentials.stub ? { ok: true, message: 'stub mode' } : { ok: false };
    },
    async createCharge(input, credentials) {
      if (credentials.stub) return stubCharge(name, input);
      throw new Error('fake adapter is stub-only');
    },
    async getCharge(providerChargeId) {
      return stubPendingSnapshot(name, providerChargeId);
    },
    async refund(input) {
      return stubRefund(name, input);
    },
    webhook: sharedSecretWebhook(name),
    clientConfig: () => ({ provider: name, tokenization: 'PUBLIC_KEY' }),
  };
}

/**
 * A fake that CAN run an activation charge — the only kind `requireProven`
 * actually gates, since an adapter with no browser tokenization could never
 * produce the proof and gating it would brick it instead of protecting it.
 */
function unprovenAdapter(name = 'unproven'): PaymentProviderAdapter {
  const base = fakeAdapter(name);
  return { ...base, capabilities: { ...base.capabilities, activationCharge: true } };
}

export const TENANT: MerchantRef = { kind: 'TENANT', id: 'tenant-1' };
export const OTHER_TENANT: MerchantRef = { kind: 'TENANT', id: 'tenant-2' };

export const STUB_CREDS: ResolvedCredentials = {
  environment: 'SANDBOX',
  fields: {},
  stub: true,
};

export function pixInput(reference = 'order-1'): ChargeInput {
  return {
    reference,
    amount: { amountCents: 12_50, currency: 'BRL' },
    method: 'PIX',
    customer: { name: 'Ana Buyer', email: 'ana@example.com', taxId: '12345678909' },
  };
}

export function cardInput(reference = 'order-2', token = 'tok_ok'): ChargeInput {
  return {
    reference,
    amount: { amountCents: 99_90, currency: 'BRL' },
    method: 'CARD',
    customer: { name: 'Ana Buyer', email: 'ana@example.com' },
    card: { token, installments: 1 },
  };
}

/**
 * A fresh, fully isolated gateway world. Tests call this INSIDE each `it`
 * so no state ever crosses test boundaries.
 */
export function setupGatewayWorld(onWebhookEvent?: WebhookEventHandler) {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const webhooks = createMemoryWebhookInbox();
  const attempts = createMemoryAttemptLedger();
  const seenEvents: NormalizedWebhookEvent[] = [];
  const adapter = fakeAdapter();
  // Returned as well as wired in: the replay sweep re-runs `webhook.verify`,
  // and a test about what happens when a PROVIDER changes its answer needs the
  // very adapter instance the gateway will consult. Built fresh per call, so
  // stubbing one leaks nothing into the next test.
  const providers = defineProviders({
    stone: adapter,
    infinitepay: infinitePayProvider(),
  } as const);
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges,
    webhooks,
    attempts,
    onWebhookEvent:
      onWebhookEvent ??
      (async (event) => {
        seenEvents.push(event);
      }),
  });
  credentials.set(TENANT, 'stone', STUB_CREDS);
  return { credentials, charges, webhooks, attempts, seenEvents, adapter, providers, gateway };
}

/**
 * A gateway whose SECOND provider can vault — for the removal path (FUT-340).
 *
 * Separate from `setupGatewayWorld` rather than an option on it, because that
 * world's provider deliberately has no vault at all: that absence is what
 * proves the capability gate, and handing it one would delete the subject of
 * another test.
 *
 * The merchant's ACTIVE provider is the one that CANNOT vault. That is the
 * point of the fixture: a card is bound to the provider that minted it, so
 * removal has to follow the provider it is handed, and a gateway that resolved
 * the chain head instead would be caught by landing on `stone`.
 */
export function setupVaultingWorld(vault: NonNullable<PaymentProviderAdapter['vault']>) {
  const credentials = createMemoryCredentialStore();
  const providers = defineProviders({
    stone: fakeAdapter(),
    vaulting: { ...fakeAdapter('vaulting'), vault },
  } as const);
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
  });
  credentials.set(TENANT, 'stone', STUB_CREDS);
  return { credentials, gateway };
}

/**
 * A gateway whose SECOND provider can void a charge (FUT-379).
 *
 * Separate from `setupGatewayWorld` for the same reason the vaulting world is:
 * that world's provider deliberately has NO `cancelCharge`, and that absence is
 * what proves the capability gate. This one keeps `stone` un-cancellable beside
 * a `cancelling` provider so both halves stay testable from one registry.
 *
 * The charge store is returned because the void is only half-done at the
 * provider: a host that cannot see its own row stop saying PENDING has learned
 * nothing, so the persistence is part of the contract under test.
 */
export function setupCancellingWorld(
  cancelCharge: NonNullable<PaymentProviderAdapter['cancelCharge']>,
) {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const providers = defineProviders({
    stone: fakeAdapter(),
    cancelling: { ...fakeAdapter('cancelling'), cancelCharge },
  } as const);
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
  });
  // `cancelling` is deliberately left UNCONNECTED, like the vaulting world: a
  // test about voiding on a disconnected provider needs that to be the default.
  credentials.set(TENANT, 'stone', STUB_CREDS);
  return { credentials, charges, gateway };
}

/** Vault steps a removal test never reaches — present only to be un-called. */
export const UNUSED_VAULT_STEPS = {
  begin: () => Promise.reject(new Error('not part of this test')),
  complete: () => Promise.reject(new Error('not part of this test')),
};

/**
 * A gateway wired to a CUSTOM inbox — for the replay races the in-memory fake
 * cannot stage honestly (a row that settles between the listing query and the
 * replay of it). Everything else stays the memory stack.
 */
export function setupCustomInboxWorld(
  webhooks: WebhookInbox,
  onWebhookEvent?: WebhookEventHandler,
) {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const gateway = createPaymentsGateway({
    providers: defineProviders({ stone: fakeAdapter() } as const),
    credentials,
    charges,
    webhooks,
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent,
  });
  credentials.set(TENANT, 'stone', STUB_CREDS);
  return { charges, gateway };
}

/**
 * An InfinitePay callback, in the wire shape their adapter reads: `order_nsu`
 * is the correlation key (and the charge id), `transaction_nsu` the dedup key.
 * Unsigned, because InfinitePay's deliveries are — which is exactly why that
 * adapter's `verify` is a live call back to them rather than a hash.
 */
export function infinitePayDelivery(orderNsu: string, transactionNsu: string): WebhookDelivery {
  return {
    provider: 'infinitepay',
    rawBody: JSON.stringify({
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      amount: 12_50,
      paid: true,
    }),
    headers: {},
  };
}

/** A stub-format Stone webhook delivery for the charge of `order-1`. */
export function stoneDelivery(
  eventId: string,
  status: 'PAID' | 'PENDING' | 'DECLINED',
): WebhookDelivery {
  return {
    provider: 'stone',
    rawBody: JSON.stringify({
      eventId,
      charge: {
        provider: 'stone',
        providerChargeId: stubChargeId('stone', 'order-1'),
        status,
        amount: { amountCents: 12_50, currency: 'BRL' },
        method: 'PIX',
      },
    }),
    headers: {},
  };
}

/** Fresh settings-service world (providers + config store), per test. */
export function setupSettingsWorld() {
  const store = createMemoryProviderConfigStore();
  const providers = defineProviders({ stone: stoneProvider(), stripe: stripeProvider() } as const);
  const settings = createSettingsService(providers, store, { allowStubMode: true });
  return { store, providers, settings };
}

/** Settings world with stub mode DISALLOWED (the production default). */
export function setupStrictSettings() {
  const store = createMemoryProviderConfigStore();
  const providers = defineProviders({ stone: stoneProvider(), stripe: stripeProvider() } as const);
  return { store, providers, settings: createSettingsService(providers, store) };
}

/** Full wired-up HTTP stack over memory stores, as a host would mount it. */
export async function setupHttpWorld(): Promise<{
  http: PaymentsHttpHandlers;
  charges: MemoryChargeStore;
}> {
  const configStore = createMemoryProviderConfigStore();
  const providers = defineProviders({
    stone: fakeAdapter(),
    // Connected, never proven, deliberately left OUT of the chain: the state a
    // chain rewrite used to activate silently (FUT-693). It carries
    // `activationCharge` because the proof gate binds only where the proof is
    // obtainable, so `stone` — which does not — cannot stand in for it.
    unproven: unprovenAdapter(),
  } as const);
  const settings = createSettingsService(providers, configStore, { allowStubMode: true });
  const charges = createMemoryChargeStore();
  const gateway = createPaymentsGateway({
    providers,
    credentials: credentialStoreFrom(configStore),
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
  });
  const http = createPaymentsHttp({
    gateway,
    settings,
    charges,
    // Server-authoritative resolution: the draft's method/customer are
    // honoured, the amount and reference come from the "host".
    resolveChargeRequest: async (_merchant, draft) => ({
      reference: draft.orderRef ?? 'order-1',
      amount: { amountCents: 12_50, currency: 'BRL' },
      method: draft.method,
      customer: { name: 'Ana', email: 'ana@example.com', ...draft.customer },
      card: draft.card,
    }),
  });
  await settings.saveCredentials(TENANT, 'stone', {
    environment: 'SANDBOX',
    fields: {},
  });
  await settings.applyChargeVerification(TENANT, 'stone', true);
  // Configured but never proven and never enabled — so a chain naming it is a
  // request to ENABLE, which is what the settings surface must refuse.
  await settings.saveCredentials(TENANT, 'unproven', { environment: 'SANDBOX', fields: {} });
  return { http, charges };
}

/** A minimal OAuth-mode adapter, for exercising the connect flow. */
function fakeOAuthAdapter(
  overrides: { failRefresh?: boolean; failRevoke?: boolean; revoked?: string[] } = {},
) {
  const base = fakeAdapter();
  return {
    ...base,
    name: 'oauthy',
    displayName: 'Oauthy',
    authMode: 'oauth' as const,
    credentialSchema: [],
    oauth: {
      async buildAuthorizeUrl(_app: unknown, ctx: { state: string; redirectUri: string }) {
        return { url: `https://oauthy.test/authorize?state=${ctx.state}`, state: ctx.state };
      },
      async exchangeCode(code: string) {
        return {
          fields: { accessToken: `at_${code}`, refreshToken: 'rt_1' },
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        };
      },
      async refresh() {
        if (overrides.failRefresh) throw new Error('refresh rejected');
        return {
          fields: { accessToken: 'at_refreshed', refreshToken: 'rt_2' },
          expiresAt: new Date('2031-01-01T00:00:00Z'),
        };
      },
      async revoke(current: { environment: string }) {
        if (overrides.failRevoke) throw new Error('provider did not revoke every token');
        overrides.revoked?.push(current.environment);
      },
    },
  };
}

/** Settings + OAuth connect world over an oauth-mode provider. */
export function setupOAuthWorld(
  overrides: {
    failRefresh?: boolean;
    failRevoke?: boolean;
    missingAppCredentials?: boolean;
    /** Made to throw, to prove a broken reporter cannot break a disconnect. */
    reporterThrows?: boolean;
  } = {},
) {
  const store = createMemoryProviderConfigStore();
  const revoked: string[] = [];
  // A CONTAINER, not a reassigned binding: the reporter below writes from
  // inside a stub, and the flakiness lane errors on closing over a `let`.
  const reported: RevokeFailure[] = [];
  const providers = defineProviders({
    oauthy: fakeOAuthAdapter({ ...overrides, revoked }),
  } as const);
  const settings = createSettingsService(providers, store);
  const oauth = createOAuthConnectService(
    providers,
    store,
    () =>
      overrides.missingAppCredentials
        ? null
        : { environment: 'PRODUCTION', fields: { clientId: 'cid', clientSecret: 'csecret' } },
    (failure) => {
      reported.push(failure);
      if (overrides.reporterThrows) throw new Error('the log transport is down');
    },
  );
  return { store, providers, settings, oauth, revoked, reported };
}
