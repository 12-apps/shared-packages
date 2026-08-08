// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MaskedProviderConfig,
  MerchantSettingsView,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { connectionBadge, expiryProximity, isConnected } from '../components/connection-state';
import { ProviderConnection } from '../components/ProviderConnection';
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

describe('expiryProximity', () => {
  const NOW = new Date('2026-08-08T12:00:00Z');

  it('is null for a connection that cannot expire', () => {
    expect(expiryProximity(null, NOW)).toBeNull();
  });

  it('reads a distant expiry as SAFE', () => {
    expect(expiryProximity('2026-12-01T12:00:00Z', NOW)).toBe('SAFE');
  });

  /** Inside the window means the renewal sweep has been failing for days. */
  it('flags an expiry inside the warning window as NEAR', () => {
    expect(expiryProximity('2026-08-10T12:00:00Z', NOW)).toBe('NEAR');
  });

  it('flags a lapsed expiry as PAST, even before the status catches up', () => {
    expect(expiryProximity('2026-08-08T11:59:00Z', NOW)).toBe('PAST');
  });

  it('treats an unparseable timestamp as unknowable, never as an alarm', () => {
    expect(expiryProximity('not-a-date', NOW)).toBeNull();
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

const DESCRIPTOR = {
  name: 'pagbank',
  displayName: 'PagBank',
  authMode: 'oauth',
  credentialSchema: [],
} as unknown as ProviderDescriptor;

function renderConnection(over: Partial<MaskedProviderConfig>) {
  render(
    <ProviderConnection
      descriptor={DESCRIPTOR}
      config={config(over)}
      client={{} as unknown as PaymentsSettingsClient}
      prepareConnect={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}

/**
 * The expiry caption's proximity emphasis (FUT-683). The renewal sweep
 * normally moves `expiresAt` long before it gets close, so a near expiry means
 * renewal has been failing quietly — and this caption is the only warning the
 * owner gets before checkout starts refusing.
 *
 * The component reads the real clock, so the NEAR case pins the clock with
 * fake timers; SAFE and PAST use timestamps that stay on their side of any
 * plausible run date.
 */
describe('ProviderConnection — the expiry caption', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a distant expiry as a neutral caption', () => {
    renderConnection({ status: 'VERIFIED', expiresAt: '2099-01-01T12:00:00Z' });
    expect(screen.getByText(/Autorização válida até/).textContent).toContain(
      'Autorização válida até',
    );
  });

  it('emphasizes an expiry the renewal sweep should already have moved', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00Z'));
    renderConnection({ status: 'VERIFIED', expiresAt: '2026-08-09T12:00:00Z' });
    expect(screen.getByTestId('payments-expiry-warning').textContent).toContain(
      'A autorização expira em',
    );
  });

  it('reads an already-lapsed expiry as an outage, not a date', () => {
    renderConnection({
      status: 'RECONNECT_REQUIRED',
      enabled: true,
      expiresAt: '2000-01-01T12:00:00Z',
    });
    expect(screen.getByTestId('payments-expiry-warning').textContent).toContain(
      'A autorização expirou em',
    );
  });
});
