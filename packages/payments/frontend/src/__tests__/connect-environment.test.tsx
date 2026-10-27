// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './settings-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { ProviderConnection } from '../components/ProviderConnection';

/**
 * Choosing the environment on the connect card (FUT-4071).
 *
 * The button used to connect in whatever environment the row was stored as,
 * and the only selector lived in the manual-credentials disclosure without
 * reaching the button — so a store stored as SANDBOX could only ever reach the
 * provider's test consent page. Now the card offers the choice while nothing
 * is connected, starting on Produção, and connects where the owner chose.
 */

function descriptor(environments?: ('SANDBOX' | 'PRODUCTION')[]): ProviderDescriptor {
  return {
    name: 'pagbank',
    displayName: 'PagBank',
    authMode: 'oauth',
    credentialSchema: [],
    ...(environments ? { capabilities: { environments } } : {}),
  } as unknown as ProviderDescriptor;
}

function config(over: Partial<MaskedProviderConfig>): MaskedProviderConfig {
  return {
    provider: 'pagbank',
    status: 'UNVERIFIED',
    enabled: false,
    environment: 'SANDBOX',
    environments: { SANDBOX: {}, PRODUCTION: {} },
    ...over,
  } as MaskedProviderConfig;
}

function renderCard(cfg: MaskedProviderConfig | null, desc = descriptor()) {
  const prepareConnect = vi.fn().mockResolvedValue({ state: 's', redirectUri: 'https://cb' });
  const beginOAuth = vi.fn().mockResolvedValue({ url: 'https://provider/consent', state: 's' });
  const client = { beginOAuth } as unknown as PaymentsSettingsClient;
  render(
    <ProviderConnection
      descriptor={desc}
      config={cfg}
      client={client}
      prepareConnect={prepareConnect}
      onChanged={vi.fn()}
    />,
  );
  return { prepareConnect, beginOAuth };
}

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function connectButton() {
  return within(screen.getByTestId('payments-connection-bar')).getByRole('button', {
    name: 'Conectar com PagBank',
  });
}

describe('the connect card — environment', () => {
  it('offers the selector while not connected, on Produção even for a SANDBOX-stored row', () => {
    renderCard(config({ environment: 'SANDBOX' }));
    expect(screen.getByTestId('payments-environment-tabs')).toBeTruthy();
    expect(screen.getByTestId('payments-environment-PRODUCTION').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('payments-environment-SANDBOX').getAttribute('aria-selected')).toBe('false');
  });

  it('starts on Produção when there is no row at all', () => {
    renderCard(null);
    expect(screen.getByTestId('payments-environment-PRODUCTION').getAttribute('aria-selected')).toBe('true');
  });

  it('connects in PRODUCTION by default', async () => {
    const { prepareConnect, beginOAuth } = renderCard(config({ environment: 'SANDBOX' }));
    fireEvent.click(connectButton());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://provider/consent'));
    expect(prepareConnect).toHaveBeenCalledWith('pagbank', 'PRODUCTION');
    expect(beginOAuth).toHaveBeenCalledWith(
      'pagbank',
      expect.objectContaining({ environment: 'PRODUCTION', state: 's' }),
    );
  });

  it('connects in SANDBOX once the owner switches to it', async () => {
    const { prepareConnect, beginOAuth } = renderCard(config({ environment: 'PRODUCTION' }));
    fireEvent.click(screen.getByTestId('payments-environment-SANDBOX'));
    expect(screen.getByTestId('payments-environment-SANDBOX').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(connectButton());
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(prepareConnect).toHaveBeenCalledWith('pagbank', 'SANDBOX');
    expect(beginOAuth).toHaveBeenCalledWith('pagbank', expect.objectContaining({ environment: 'SANDBOX' }));
  });

  it('offers no selector once connected, and reconnects in the grant’s own environment', async () => {
    const { prepareConnect } = renderCard(config({ status: 'VERIFIED', environment: 'SANDBOX' }));
    await waitFor(() => expect(screen.queryByTestId('payments-environment-tabs')).toBeNull());
    expect(screen.getByTestId('payments-connected-environment').textContent).toMatch(/Sandbox/);
    fireEvent.click(
      within(screen.getByTestId('payments-connection-bar')).getByRole('button', { name: 'Reconectar' }),
    );
    await waitFor(() => expect(prepareConnect).toHaveBeenCalledWith('pagbank', 'SANDBOX'));
  });

  it('offers no selector for a provider with a single environment, and connects there', async () => {
    const { prepareConnect } = renderCard(null, descriptor(['SANDBOX']));
    await waitFor(() => expect(screen.queryByTestId('payments-environment-tabs')).toBeNull());
    fireEvent.click(connectButton());
    await waitFor(() => expect(prepareConnect).toHaveBeenCalledWith('pagbank', 'SANDBOX'));
  });
});
