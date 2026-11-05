import { describe, expect, it, vi } from 'vitest';

import { buyerCheckoutConfig } from '../checkout/config';
import { CredentialsError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { liveOnlyCredentials, readLiveDeployment, type LiveDeploymentEnv } from '../core/live-deployment';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders, type ProviderRegistry } from '../core/registry';
import type { CredentialStore } from '../core/credential-store';
import type { MerchantRef, PaymentEnvironment, ResolvedCredentials } from '../core/types';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { infinitePayProvider } from '../providers/infinitepay';
import { itauProvider } from '../providers/itau';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PIX_MANUAL_COPY } from '../providers/pix-manual/pt-BR';
import { pixManualProvider } from '../providers/pixmanual';
import {
  PT_BR_INFINITEPAY_COPY,
  PT_BR_ITAU_COPY,
  PT_BR_PAGBANK_COPY,
  PT_BR_STONE_COPY,
  PT_BR_STRIPE_COPY,
} from '../providers/pt-BR';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import { TENANT, pixInput } from './fixtures';

/**
 * FUT-4432: on a LIVE deployment a connection whose SANDBOX is the provider's
 * simulator (an adapter declaring `simulatedSandbox`) offers buyers nothing —
 * no method in the buyer config and no charge in the walk — while a provider
 * that takes real money whatever the stored environment keeps selling, and
 * every other deployment keeps sandbox exactly as it was.
 */

const creds = (environment: PaymentEnvironment): ResolvedCredentials => ({ environment, fields: {} });

function adapter(name: string, sent: string[], simulatedSandbox: boolean): PaymentProviderAdapter {
  return {
    name,
    displayName: name,
    ...(simulatedSandbox ? { simulatedSandbox } : {}),
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
    },
    credentialSchema: [],
    verifyCredentials: async () => ({ ok: true }),
    createCharge: async (input) => {
      sent.push(name);
      return {
        provider: name,
        providerChargeId: `${name}_${input.reference}`,
        status: 'PENDING',
        amount: input.amount,
        method: input.method,
        pix: { qrText: `qr-${name}` },
      };
    },
    getCharge: async (id) => ({ provider: name, providerChargeId: id, status: 'PENDING', amount: pixInput().amount, method: 'PIX' }),
    webhook: { verify: async () => true, parse: async () => [] },
    clientConfig: () => ({ provider: name, tokenization: 'PUBLIC_KEY', publicKey: `pk-${name}` }),
  };
}

interface Connection {
  environment: PaymentEnvironment;
  /** The adapter declares its SANDBOX a simulator. Default true. */
  simulated?: boolean;
}

/** A gateway over `liveOnlyCredentials`, with one connection per name, in chain order. */
function world(processEnv: LiveDeploymentEnv, connections: Record<string, Connection>) {
  const store = createMemoryCredentialStore();
  const sent: string[] = [];
  const registry: Record<string, PaymentProviderAdapter> = {};
  for (const [name, connection] of Object.entries(connections)) {
    registry[name] = adapter(name, sent, connection.simulated ?? true);
    store.set(TENANT, name, creds(connection.environment));
  }
  const providers = defineProviders(registry);
  const credentials = liveOnlyCredentials(store, processEnv, providers);
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
  });
  const config = () =>
    buyerCheckoutConfig(
      { gateway, credentials, connections: { get: async () => null, save: async () => undefined } },
      TENANT,
    );
  return { gateway, credentials, config, sent, providers };
}

const LIVE: LiveDeploymentEnv = { PAYMENTS_LIVE_DEPLOYMENT: '1' };
const SANDBOX: Connection = { environment: 'SANDBOX' };

/** A one-entry chain whose credential read does `read`. */
function failingStore(read: () => Promise<ResolvedCredentials | null>): CredentialStore {
  return { providerChain: async () => ['alpha'], defaultProvider: async () => 'alpha', getCredentials: read };
}

/** A memory store holding every named provider, in order, as SANDBOX. */
function allSandbox(names: readonly string[]): CredentialStore {
  const store = createMemoryCredentialStore();
  for (const name of names) store.set(TENANT, name, creds('SANDBOX'));
  return store;
}

/** A memory store holding one SANDBOX `alpha` connection for `merchant`. */
function sandboxFor(merchant: MerchantRef): CredentialStore {
  const store = createMemoryCredentialStore();
  store.set(merchant, 'alpha', creds('SANDBOX'));
  return store;
}

const simulatedRegistry = (): ProviderRegistry => defineProviders({ alpha: adapter('alpha', [], true) });

describe('readLiveDeployment', () => {
  it.each(['1', 'true', 'TRUE', ' yes ', 'on'])('reads %j as live', (value) => {
    expect(readLiveDeployment({ PAYMENTS_LIVE_DEPLOYMENT: value })).toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'production'])('reads %j as not live', (value) => {
    expect(readLiveDeployment({ PAYMENTS_LIVE_DEPLOYMENT: value })).toBe(false);
  });
});

describe('a simulated-sandbox connection on a LIVE deployment', () => {
  it('leaves the buyer config with no provider and no method', async () => {
    const w = world(LIVE, { alpha: SANDBOX });

    const config = await w.config();

    expect(config.provider).toBeNull();
    expect(config.methods).toEqual([]);
    expect(config.chain).toEqual([]);
  });

  it('reads as no provider configured, and the walk sends nothing', async () => {
    const w = world(LIVE, { alpha: SANDBOX });

    expect(await w.credentials.defaultProvider(TENANT)).toBeNull();
    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toBeInstanceOf(CredentialsError);
    expect(w.sent).toEqual([]);
  });

  it('keeps a production connection, and drops only the sandbox one from a mixed chain', async () => {
    const w = world(LIVE, { alpha: SANDBOX, beta: { environment: 'PRODUCTION' } });

    const config = await w.config();

    expect(config.provider).toBe('beta');
    expect(config.chain.map((link) => link.provider)).toEqual(['beta']);
    expect(await w.credentials.defaultProvider(TENANT)).toBe('beta');
    await w.gateway.charge(TENANT, pixInput());
    expect(w.sent).toEqual(['beta']);
  });

  it('keeps reading a sandbox connection by name, so money already moved is still heard', async () => {
    const w = world(LIVE, { alpha: SANDBOX });

    expect(await w.credentials.getCredentials(TENANT, 'alpha')).toEqual(creds('SANDBOX'));
  });

  it('leaves out a connection the store refuses as not connected (CredentialsError)', async () => {
    const store = failingStore(async () => {
      throw new CredentialsError('alpha', 'configured but disabled');
    });

    expect(await liveOnlyCredentials(store, LIVE, simulatedRegistry()).providerChain(TENANT)).toEqual([]);
  });

  it('lets any other credential-read failure propagate instead of quietly selling less', async () => {
    const store = failingStore(async () => {
      throw new Error('decrypt failed');
    });

    await expect(liveOnlyCredentials(store, LIVE, simulatedRegistry()).providerChain(TENANT)).rejects.toThrow(
      'decrypt failed',
    );
    await expect(liveOnlyCredentials(store, LIVE, simulatedRegistry()).defaultProvider(TENANT)).rejects.toThrow(
      'decrypt failed',
    );
  });
});

describe('a provider whose SANDBOX row can take real money, on a LIVE deployment', () => {
  it('keeps selling: its methods stay and the walk charges it', async () => {
    const w = world(LIVE, { alpha: { environment: 'SANDBOX', simulated: false } });

    const config = await w.config();

    expect(config.provider).toBe('alpha');
    expect(config.methods).toEqual(['PIX', 'CARD']);
    await w.gateway.charge(TENANT, pixInput());
    expect(w.sent).toEqual(['alpha']);
  });

  it('is never asked for its credentials by the live rule', async () => {
    const read = vi.fn<() => Promise<ResolvedCredentials | null>>().mockRejectedValue(new Error('must not be read'));
    const providers = defineProviders({ alpha: adapter('alpha', [], false) });

    expect(await liveOnlyCredentials(failingStore(read), LIVE, providers).providerChain(TENANT)).toEqual(['alpha']);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('the shipped adapters, each stored as SANDBOX, on a LIVE deployment', () => {
  const shipped = () => defineProviders({
    pagbank: pagbankProvider(PT_BR_PAGBANK_COPY),
    itau: itauProvider(PT_BR_ITAU_COPY),
    infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
    stone: stoneProvider(PT_BR_STONE_COPY),
    stripe: stripeProvider(PT_BR_STRIPE_COPY),
    pixmanual: pixManualProvider(PT_BR_PIX_MANUAL_COPY),
  });

  it('drops PagBank and Itaú, whose sandbox is a simulator, and keeps every other one', async () => {
    const registry = shipped();

    const chain = await liveOnlyCredentials(allSandbox(registry.names), LIVE, registry).providerChain(TENANT);

    expect(chain).toEqual(['infinitepay', 'stone', 'stripe', 'pixmanual']);
  });
});

describe('the platform\'s own account on a LIVE deployment', () => {
  it('keeps its sandbox in routing: which environment it bills in is the platform\'s call', async () => {
    const platform = { kind: 'PLATFORM', id: 'platform' } as const;

    const routing = liveOnlyCredentials(sandboxFor(platform), LIVE, simulatedRegistry());

    expect(await routing.providerChain(platform)).toEqual(['alpha']);
    expect(await routing.defaultProvider(platform)).toBe('alpha');
  });
});

describe('a sandbox connection on any other deployment', () => {
  it('offers its methods and takes the charge exactly as before', async () => {
    const w = world({}, { alpha: SANDBOX });

    const config = await w.config();

    expect(config.provider).toBe('alpha');
    expect(config.methods).toEqual(['PIX', 'CARD']);
    expect(await w.credentials.defaultProvider(TENANT)).toBe('alpha');
    await w.gateway.charge(TENANT, pixInput());
    expect(w.sent).toEqual(['alpha']);
  });

  it('follows the environment per call rather than when the store was built', async () => {
    const processEnv: Record<string, string | undefined> = {};
    const w = world(processEnv, { alpha: SANDBOX });
    expect(await w.credentials.providerChain(TENANT)).toEqual(['alpha']);

    processEnv.PAYMENTS_LIVE_DEPLOYMENT = '1';

    expect(await w.credentials.providerChain(TENANT)).toEqual([]);
  });
});

describe('the environment a host hands over', () => {
  it('takes a process environment as it is', async () => {
    const processEnv: NodeJS.ProcessEnv = { PAYMENTS_LIVE_DEPLOYMENT: '1', NODE_ENV: 'production' };
    const w = world(processEnv, { alpha: SANDBOX });

    expect(await w.credentials.providerChain(TENANT)).toEqual([]);
  });

  it('is not switched on by NODE_ENV=production alone', async () => {
    const processEnv: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    const w = world(processEnv, { alpha: SANDBOX });

    expect(await w.credentials.providerChain(TENANT)).toEqual(['alpha']);
  });
});
