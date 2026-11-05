import { describe, expect, it } from 'vitest';

import { buyerCheckoutConfig } from '../checkout/config';
import { CredentialsError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { liveOnlyCredentials, readLiveDeployment, type LiveDeploymentEnv } from '../core/live-deployment';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import type { CredentialStore } from '../core/credential-store';
import type { PaymentEnvironment, ResolvedCredentials } from '../core/types';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { TENANT, pixInput } from './fixtures';

/**
 * FUT-4432: on a LIVE deployment a SANDBOX connection offers buyers nothing —
 * no method in the buyer config and no charge in the walk — while every other
 * deployment keeps sandbox exactly as it was.
 */

const creds = (environment: PaymentEnvironment): ResolvedCredentials => ({ environment, fields: {} });

function adapter(name: string, sent: string[]): PaymentProviderAdapter {
  return {
    name,
    displayName: name,
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

/** A gateway over `liveOnlyCredentials`, with one connection per named environment, in chain order. */
function world(env: LiveDeploymentEnv, connections: Record<string, PaymentEnvironment>) {
  const store = createMemoryCredentialStore();
  const sent: string[] = [];
  const registry: Record<string, PaymentProviderAdapter> = {};
  for (const [name, environment] of Object.entries(connections)) {
    registry[name] = adapter(name, sent);
    store.set(TENANT, name, creds(environment));
  }
  const credentials = liveOnlyCredentials(store, env);
  const gateway = createPaymentsGateway({
    providers: defineProviders(registry),
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
  return { gateway, credentials, config, sent };
}

const LIVE: LiveDeploymentEnv = { PAYMENTS_LIVE_DEPLOYMENT: '1' };

describe('readLiveDeployment', () => {
  it.each(['1', 'true', 'TRUE', ' yes ', 'on'])('reads %j as live', (value) => {
    expect(readLiveDeployment({ PAYMENTS_LIVE_DEPLOYMENT: value })).toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'production'])('reads %j as not live', (value) => {
    expect(readLiveDeployment({ PAYMENTS_LIVE_DEPLOYMENT: value })).toBe(false);
  });
});

describe('a sandbox connection on a LIVE deployment', () => {
  it('leaves the buyer config with no provider and no method', async () => {
    const w = world(LIVE, { alpha: 'SANDBOX' });

    const config = await w.config();

    expect(config.provider).toBeNull();
    expect(config.methods).toEqual([]);
    expect(config.chain).toEqual([]);
  });

  it('reads as no provider configured, and the walk sends nothing', async () => {
    const w = world(LIVE, { alpha: 'SANDBOX' });

    expect(await w.credentials.defaultProvider(TENANT)).toBeNull();
    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toBeInstanceOf(CredentialsError);
    expect(w.sent).toEqual([]);
  });

  it('keeps a production connection, and drops only the sandbox one from a mixed chain', async () => {
    const w = world(LIVE, { alpha: 'SANDBOX', beta: 'PRODUCTION' });

    const config = await w.config();

    expect(config.provider).toBe('beta');
    expect(config.chain.map((link) => link.provider)).toEqual(['beta']);
    expect(await w.credentials.defaultProvider(TENANT)).toBe('beta');
    await w.gateway.charge(TENANT, pixInput());
    expect(w.sent).toEqual(['beta']);
  });

  it('keeps reading a sandbox connection by name, so money already moved is still heard', async () => {
    const w = world(LIVE, { alpha: 'SANDBOX' });

    expect(await w.credentials.getCredentials(TENANT, 'alpha')).toEqual(creds('SANDBOX'));
  });

  it('drops a connection whose credential read throws', async () => {
    const inner: CredentialStore = {
      providerChain: async () => ['alpha'],
      defaultProvider: async () => 'alpha',
      getCredentials: async () => {
        throw new Error('decrypt failed');
      },
    };

    expect(await liveOnlyCredentials(inner, LIVE).providerChain(TENANT)).toEqual([]);
  });
});

describe('a sandbox connection on any other deployment', () => {
  it('offers its methods and takes the charge exactly as before', async () => {
    const w = world({}, { alpha: 'SANDBOX' });

    const config = await w.config();

    expect(config.provider).toBe('alpha');
    expect(config.methods).toEqual(['PIX', 'CARD']);
    expect(await w.credentials.defaultProvider(TENANT)).toBe('alpha');
    await w.gateway.charge(TENANT, pixInput());
    expect(w.sent).toEqual(['alpha']);
  });

  it('follows the environment per call rather than when the store was built', async () => {
    const env: Record<string, string | undefined> = {};
    const w = world(env, { alpha: 'SANDBOX' });
    expect(await w.credentials.providerChain(TENANT)).toEqual(['alpha']);

    env.PAYMENTS_LIVE_DEPLOYMENT = '1';

    expect(await w.credentials.providerChain(TENANT)).toEqual([]);
  });
});

describe('the environment a host hands over', () => {
  it('takes a process environment as it is', async () => {
    const processEnv: NodeJS.ProcessEnv = { PAYMENTS_LIVE_DEPLOYMENT: '1', NODE_ENV: 'production' };
    const w = world(processEnv, { alpha: 'SANDBOX' });

    expect(await w.credentials.providerChain(TENANT)).toEqual([]);
  });
});
