// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, MerchantSettingsView } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { connectionBadge, isConnected } from '../components/connection-state';
import { ProviderList } from '../components/ProviderList';

/**
 * What "connected" means, in exactly one place.
 *
 * The screen shipped with two answers. Disconnecting does not delete the
 * provider row — it empties every environment's credentials and resets the
 * status — so the list, which only asked whether a row existed, kept reporting
 * `Conectado` for a store that had just disconnected, while the panel one click
 * away correctly offered `Conectar com PagBank`.
 */

function config(over: Partial<MaskedProviderConfig>): MaskedProviderConfig {
  return { provider: 'pagbank', status: 'UNVERIFIED', enabled: false, ...over } as MaskedProviderConfig;
}

describe('isConnected', () => {
  /** The reported bug: the row survives a disconnect, emptied. */
  it('is false for the emptied row a disconnect leaves behind', () => {
    expect(isConnected(config({ status: 'UNVERIFIED', enabled: false }))).toBe(false);
  });

  it('is false when no row exists at all', () => {
    expect(isConnected(null)).toBe(false);
  });

  it('is true once the provider is verified', () => {
    expect(isConnected(config({ status: 'VERIFIED' }))).toBe(true);
  });

  /** That store worked and still holds credentials; the grant is what lapsed. */
  it('is true when a working connection needs reauthorizing', () => {
    expect(isConnected(config({ status: 'RECONNECT_REQUIRED', enabled: true }))).toBe(true);
  });
});

describe('connectionBadge', () => {
  it('names a disconnected store as not connected', () => {
    expect(connectionBadge(config({ status: 'UNVERIFIED' })).label).toBe('Não conectado');
  });

  it('leads with Ativo, the only state where money can move', () => {
    expect(connectionBadge(config({ status: 'VERIFIED', enabled: true })).label).toBe('Ativo');
  });

  /**
   * A lapsed grant is its own state. Folding it into `Conectado` hid the one
   * card an owner needs to open.
   */
  it('calls out a lapsed authorization instead of calling it connected', () => {
    expect(connectionBadge(config({ status: 'RECONNECT_REQUIRED' })).label).toBe('Reconectar');
  });
});

const VIEW = (configs: MaskedProviderConfig[]): MerchantSettingsView =>
  ({
    providers: [{ name: 'pagbank', displayName: 'PagBank', authMode: 'oauth', credentialSchema: [] }],
    configs,
    activeProvider: null,
  }) as unknown as MerchantSettingsView;

afterEach(cleanup);

describe('ProviderList — the card badge', () => {
  it('reports a disconnected provider as not connected', () => {
    render(
      <ProviderList
        view={VIEW([config({ status: 'UNVERIFIED', enabled: false })])}
        client={{} as unknown as PaymentsSettingsClient}
        reload={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('payments-provider-badge-pagbank').textContent).toBe('Não conectado');
  });
});
