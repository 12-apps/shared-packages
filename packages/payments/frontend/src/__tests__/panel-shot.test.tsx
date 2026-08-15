// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  MaskedProviderConfig,
  MerchantSettingsView,
  ProviderDescriptor,
} from '@12-apps/payments-backend';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';

/**
 * The rendered SHAPE of the redesigned panel, asserted where a screenshot
 * cannot be: that each piece the prototype specifies actually reaches the DOM.
 *
 * Not a pixel diff — jsdom computes no layout — but the pieces a restyle
 * silently drops are exactly these: a bar that stopped being rendered, a step
 * icon that lost its tick, a done row that reverted to grey.
 */

function descriptorOf(): ProviderDescriptor {
  const adapter = stripeProvider();
  return {
    name: adapter.name,
    displayName: adapter.displayName,
    urlSlug: adapter.name,
    authMode: 'oauth',
    credentialSchema: adapter.credentialSchema,
  } as unknown as ProviderDescriptor;
}

function renderPanel() {
  const config = {
    provider: 'stripe',
    status: 'VERIFIED',
    enabled: false,
    chargeVerifiedAt: null,
    environment: 'SANDBOX',
    environments: { SANDBOX: { secretKey: { configured: true, hint: '••••42' } }, PRODUCTION: {} },
  } as unknown as MaskedProviderConfig;

  const guide = stripeProvider().setupGuide?.({
    brandName: 'Quitanda Digital',
    webhookUrl: 'https://loja.example/api/webhooks/payments/stripe/x',
    progress: { configured: {}, connected: true, proven: false },
  });

  const client = {
    baseUrl: '/api/admin/acme/payments',
    getSettings: vi.fn().mockResolvedValue({
      providers: [descriptorOf()],
      configs: [config],
      activeProvider: null,
    } as unknown as MerchantSettingsView),
    getSetupGuide: vi.fn().mockResolvedValue(guide),
    verify: vi.fn(),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;

  render(
    <PaymentProviderSettings
      client={client}
      initialProvider="stripe"
      prepareConnect={async () => ({ state: 's', redirectUri: 'https://h.test/cb' })}
    />,
  );
}

describe('the redesigned provider panel', () => {
  it('renders the step panel with its action bar last', async () => {
    renderPanel();

    const section = await screen.findByTestId('payments-setup-section-dashboard');
    const bar = await screen.findByTestId('payments-setup-confirm-bar');

    // The bar belongs to this panel, and it is the LAST thing in it: the
    // control the owner is working toward, after the steps it is asking about.
    expect(section.contains(bar)).toBe(true);
    expect(section.lastElementChild).toBe(bar);
    // …and it says what it is asking, not just what the button does.
    expect(bar.textContent).toContain('Confirme quando terminar');
    expect(bar.textContent).toContain('Já configurei minha conta na Stripe');
  });

  it('gives the status header a state word for every state', async () => {
    renderPanel();

    // Connected but unproven is neither "recebendo" nor merely "não" — it is a
    // step outstanding, and the header says which.
    await screen.findByTestId('payments-status');
    expect(screen.getByTestId('payments-status').textContent).toBe('CONEXÃO OK');
    expect(screen.getByText('Ainda não está recebendo')).toBeTruthy();
  });
});
