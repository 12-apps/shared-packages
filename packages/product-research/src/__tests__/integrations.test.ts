import { describe, expect, it } from 'vitest';

import { ConnectorRegistry } from '../connectors/registry';
import type { PriceSourceConnector } from '../connectors/types';
import {
  CREDENTIALS_KEY,
  credentialsOf,
  INTEGRATION_SOURCE_TYPES,
  isIntegrationSourceType,
  NAMED_SOURCE_TYPES,
} from '../integrations';

/**
 * Unit (FUT-434): the paid-integration seam — the type split every host UI
 * derives from, the run-time credential accessor connectors rely on, and the
 * optional validateCredentials capability resolving through the registry so
 * a connector landing later plugs its validator in with no host change.
 */

describe('integration source types', () => {
  it('splits the closed set into singleton integrations and named types', () => {
    expect([...INTEGRATION_SOURCE_TYPES, ...NAMED_SOURCE_TYPES].sort()).toEqual(
      ['AMAZON', 'MANUAL', 'MERCADO_LIVRE', 'SERP', 'VTEX'].sort(),
    );
    expect(isIntegrationSourceType('SERP')).toBe(true);
    expect(isIntegrationSourceType('VTEX')).toBe(false);
    expect(isIntegrationSourceType('EBAY')).toBe(false);
  });
});

describe('credentialsOf', () => {
  it('reads only string values from the injected credential record', () => {
    const source = {
      config: { [CREDENTIALS_KEY]: { apiKey: 'sk-123', junk: 42, nested: { a: 1 } } },
    };
    expect(credentialsOf(source)).toEqual({ apiKey: 'sk-123' });
  });

  it('answers an empty record when the host injected nothing usable', () => {
    expect(credentialsOf({ config: {} })).toEqual({});
    expect(credentialsOf({ config: { [CREDENTIALS_KEY]: 'not-a-record' } })).toEqual({});
    expect(credentialsOf({ config: { [CREDENTIALS_KEY]: ['a'] } })).toEqual({});
  });
});

describe('validateCredentials capability', () => {
  const searchless = async (): Promise<{ ok: false; error: string }> => ({
    ok: false,
    error: 'unused',
  });

  it('resolves through the registry only for connectors that declare it', () => {
    const withValidator: PriceSourceConnector = {
      type: 'SERP',
      search: searchless,
      validateCredentials: async (credentials) =>
        credentials['apiKey'] === 'good' ? { ok: true } : { ok: false, error: 'invalid key' },
    };
    const without: PriceSourceConnector = { type: 'AMAZON', search: searchless };

    const registry = new ConnectorRegistry().register(withValidator).register(without);

    expect(registry.get('SERP')?.validateCredentials).toBeDefined();
    // No validator mounted — the host saves the credential as unverified.
    expect(registry.get('AMAZON')?.validateCredentials).toBeUndefined();
    expect(registry.get('MERCADO_LIVRE')?.validateCredentials).toBeUndefined();
  });

  it('answers the connector verdict for the credential it was handed', async () => {
    const connector: PriceSourceConnector = {
      type: 'SERP',
      search: searchless,
      validateCredentials: async (credentials) =>
        credentials['apiKey'] === 'good' ? { ok: true } : { ok: false, error: 'invalid key' },
    };
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      fetchJson: async () => null,
    };

    await expect(connector.validateCredentials?.({ apiKey: 'good' }, ctx)).resolves.toEqual({
      ok: true,
    });
    await expect(connector.validateCredentials?.({ apiKey: 'bad' }, ctx)).resolves.toEqual({
      ok: false,
      error: 'invalid key',
    });
  });
});
