// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  credentialSchemaOf,
  PT_BR_PIX_MANUAL_COPY,
  type MerchantSettingsView,
  type ProviderDescriptor,
} from '@12-apps/payments-backend';
import { pixManualProvider } from '@12-apps/payments-backend/providers/pixmanual';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * A provider with ONE environment — the store's own Pix key has no sandbox,
 * every code is real money. The screen used to offer a "Sandbox" tab with a
 * notice promising that no money moves, which was false for it. It now offers
 * no selector and no notice, and saves where the provider actually lives.
 *
 * Asserted on the shipped adapter, so the declaration and the screen cannot
 * drift apart.
 */

function descriptor(): ProviderDescriptor {
  const adapter = pixManualProvider(PT_BR_PIX_MANUAL_COPY);
  return {
    name: adapter.name,
    displayName: adapter.displayName,
    urlSlug: adapter.name,
    authMode: 'credentials',
    capabilities: adapter.capabilities,
    credentialSchema: credentialSchemaOf(adapter),
  };
}

function renderPanel(configs: unknown[] = []) {
  const view = { providers: [descriptor()], configs, activeProvider: null } as unknown as MerchantSettingsView;
  const client = {
    baseUrl: '/api/admin/acme/payments',
    getSettings: vi.fn().mockResolvedValue(view),
    getSetupGuide: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue({ probe: { ok: true, environment: 'PRODUCTION' } }),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn().mockResolvedValue({
      provider: 'pixmanual',
      status: 'UNVERIFIED',
      enabled: false,
      chargeVerifiedAt: null,
      environment: 'PRODUCTION',
      environments: { SANDBOX: {}, PRODUCTION: { pixKey: { configured: true, hint: 'loja@example.com' } } },
    }),
  } as unknown as PaymentsSettingsClient;
  render(<PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={client} initialProvider="pixmanual" />);
  return client;
}

afterEach(cleanup);

describe('a provider with a single environment', () => {
  it('offers no environment selector and no sandbox notice', async () => {
    renderPanel();
    await screen.findByLabelText(/Chave Pix da loja/);

    await waitFor(() => {
      expect(screen.queryByTestId('payments-environment-tabs')).toBeNull();
      expect(screen.queryByTestId('payments-environment-notice-SANDBOX')).toBeNull();
    });
  });

  it('saves into the environment it has', async () => {
    const client = renderPanel();
    fireEvent.change(await screen.findByLabelText(/Chave Pix da loja/), { target: { value: 'loja@example.com' } });
    fireEvent.change(screen.getByLabelText(/Nome do recebedor/), { target: { value: 'Padaria Boa' } });
    fireEvent.change(screen.getByLabelText(/^Cidade/), { target: { value: 'Recife' } });
    fireEvent.click(screen.getByTestId('payments-save'));
    fireEvent.click(await screen.findByRole('button', { name: /salvar/i, hidden: false }));

    await vi.waitFor(() => expect(client.saveCredentials).toHaveBeenCalled());
    expect(vi.mocked(client.saveCredentials).mock.calls[0]?.[1]).toMatchObject({ environment: 'PRODUCTION' });
  });
});

describe('a provider checked locally', () => {
  it('promises a check of the details, never a test with a provider', async () => {
    renderPanel();
    fireEvent.change(await screen.findByLabelText(/Chave Pix da loja/), { target: { value: 'loja@example.com' } });
    fireEvent.change(screen.getByLabelText(/Nome do recebedor/), { target: { value: 'Padaria Boa' } });
    fireEvent.change(screen.getByLabelText(/^Cidade/), { target: { value: 'Recife' } });

    const bar = await screen.findByTestId('payments-form-bar');
    expect(bar.textContent).toContain(PT_BR_PAYMENTS_SETTINGS_COPY.credentials.probeLocalSaveNote);
    expect(bar.textContent).not.toContain(PT_BR_PAYMENTS_SETTINGS_COPY.credentials.probeSaveNote);
    expect(screen.getByTestId('payments-save').textContent).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.credentials.saveAndCheck);
  });

  it('calls a passing check DADOS OK, not a connection', async () => {
    renderPanel([
      {
        provider: 'pixmanual',
        status: 'VERIFIED',
        enabled: false,
        chargeVerifiedAt: null,
        environment: 'PRODUCTION',
        environments: { SANDBOX: {}, PRODUCTION: { pixKey: { configured: true, hint: 'loja@example.com' } } },
      },
    ]);

    expect(await screen.findByText(PT_BR_PAYMENTS_SETTINGS_COPY.status.detailsOk as string)).toBeTruthy();
    expect(screen.queryAllByText(PT_BR_PAYMENTS_SETTINGS_COPY.status.connectionOk)).toHaveLength(0);
  });
});
