import { describe, expect, it } from 'vitest';

import { emptyConfig } from '../config/enablement';
import { createSettingsService } from '../config/service';
import type { StoredProviderConfig } from '../config/types';
import { refusesSimulatedSandbox } from '../core/live-deployment';
import { defineProviders } from '../core/registry';
import type { PaymentEnvironment } from '../core/types';
import { createMemoryProviderConfigStore } from '../memory';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_INFINITEPAY_COPY, PT_BR_PAGBANK_COPY } from '../providers/pt-BR';
import { TENANT } from './fixtures';

/**
 * FUT-4432: the settings screen says what checkout does. On a LIVE deployment
 * each masked config whose active environment is its provider's SIMULATED
 * sandbox carries `sandboxRefused`, and the published chain leaves it out;
 * everywhere else the view is exactly as before.
 */

/** A proven, enabled row in `environment` at `priority`. */
function provenRow(provider: string, environment: PaymentEnvironment, priority: number): StoredProviderConfig {
  return {
    ...emptyConfig(provider),
    enabled: true,
    priority,
    environment,
    status: 'VERIFIED',
    chargeVerifiedAt: new Date('2026-11-01T12:00:00Z'),
    environments: { SANDBOX: { token: 'sandbox' }, PRODUCTION: { token: 'live' } },
  };
}

async function world(processEnv: Record<string, string | undefined>, rows: StoredProviderConfig[]) {
  const store = createMemoryProviderConfigStore();
  for (const row of rows) await store.save(TENANT, row);
  const providers = defineProviders({
    pagbank: pagbankProvider(PT_BR_PAGBANK_COPY),
    infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
  } as const);
  return createSettingsService(providers, store, { liveDeployment: processEnv });
}

const LIVE = { PAYMENTS_LIVE_DEPLOYMENT: '1' };
const flag = (configs: { provider: string; sandboxRefused?: boolean }[], name: string) =>
  configs.find((config) => config.provider === name)?.sandboxRefused;

describe('refusesSimulatedSandbox', () => {
  const simulated = { simulatedSandbox: true };

  it('refuses only a simulated sandbox, only while live', () => {
    expect(refusesSimulatedSandbox(simulated, 'SANDBOX', true)).toBe(true);
    expect(refusesSimulatedSandbox(simulated, 'PRODUCTION', true)).toBe(false);
    expect(refusesSimulatedSandbox(simulated, 'SANDBOX', false)).toBe(false);
    expect(refusesSimulatedSandbox({}, 'SANDBOX', true)).toBe(false);
  });
});

describe('the settings view on a LIVE deployment', () => {
  it('flags the PagBank sandbox row and leaves it out of the published chain', async () => {
    const settings = await world(LIVE, [provenRow('pagbank', 'SANDBOX', 0), provenRow('infinitepay', 'SANDBOX', 1)]);

    const view = await settings.getSettings(TENANT);

    expect(flag(view.configs, 'pagbank')).toBe(true);
    expect(flag(view.configs, 'infinitepay')).toBeUndefined();
    expect(view.providerChain).toEqual(['infinitepay']);
    expect(view.activeProvider).toBe('infinitepay');
  });

  it('reads nothing as active when the refused row is the only one', async () => {
    const settings = await world(LIVE, [provenRow('pagbank', 'SANDBOX', 0)]);

    const view = await settings.getSettings(TENANT);

    expect(view.providerChain).toEqual([]);
    expect(view.activeProvider).toBeNull();
  });

  it('does not flag a production row', async () => {
    const settings = await world(LIVE, [provenRow('pagbank', 'PRODUCTION', 0)]);

    const view = await settings.getSettings(TENANT);

    expect(flag(view.configs, 'pagbank')).toBeUndefined();
    expect(view.activeProvider).toBe('pagbank');
  });

  it('carries the flag on the configs the write routes return', async () => {
    const settings = await world(LIVE, [provenRow('pagbank', 'SANDBOX', 0)]);

    expect((await settings.setEnabled(TENANT, 'pagbank', false)).sandboxRefused).toBe(true);
    expect((await settings.applyChargeVerification(TENANT, 'pagbank', true)).sandboxRefused).toBe(true);
    const saved = await settings.saveCredentials(TENANT, 'pagbank', { environment: 'SANDBOX', fields: { token: 'new-sandbox' } });
    expect(saved.sandboxRefused).toBe(true);
  });
});

describe('the settings view on any other deployment', () => {
  it('is exactly as before: no flag, the sandbox row heads the chain', async () => {
    const settings = await world({ NODE_ENV: 'production' }, [provenRow('pagbank', 'SANDBOX', 0)]);

    const view = await settings.getSettings(TENANT);

    expect(view.configs[0]).not.toHaveProperty('sandboxRefused');
    expect(view.providerChain).toEqual(['pagbank']);
    expect(view.activeProvider).toBe('pagbank');
  });

  it('follows the environment per call', async () => {
    const processEnv: Record<string, string | undefined> = {};
    const settings = await world(processEnv, [provenRow('pagbank', 'SANDBOX', 0)]);
    expect((await settings.getSettings(TENANT)).activeProvider).toBe('pagbank');

    processEnv.PAYMENTS_LIVE_DEPLOYMENT = '1';

    expect((await settings.getSettings(TENANT)).activeProvider).toBeNull();
  });
});
