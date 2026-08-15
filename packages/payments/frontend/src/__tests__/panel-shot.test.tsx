// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function renderPanel(enabled = false) {
  const config = {
    provider: 'stripe',
    status: 'VERIFIED',
    enabled,
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
    setEnabled: vi.fn().mockResolvedValue(config),
    saveCredentials: vi.fn(),
    disconnectOAuth: vi.fn(),
  } as unknown as PaymentsSettingsClient;

  render(
    <PaymentProviderSettings
      client={client}
      initialProvider="stripe"
      prepareConnect={async () => ({ state: 's', redirectUri: 'https://h.test/cb' })}
    />,
  );
  return client;
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

  /**
   * The owner who reaches for "remover" while live usually wants to STOP
   * TAKING ORDERS, which is a switch — not a revocation that also costs them
   * the reconnection. Offering it inside the dialog is the only place the two
   * are ever weighed against each other.
   */
  it('offers pausing instead of removing, but only while the store is live', async () => {
    const client = renderPanel(true);

    fireEvent.click(await screen.findByTestId('payments-disconnect'));
    const pause = await screen.findByTestId('payments-pause-instead');
    fireEvent.click(pause);

    await waitFor(() => {
      expect(client.setEnabled).toHaveBeenCalledWith('stripe', false);
    });
    // …and the grant is untouched: pausing is not a quieter disconnect.
    expect(client.disconnectOAuth).not.toHaveBeenCalled();
  });

  it('does not offer pausing when the store is not receiving anyway', async () => {
    renderPanel(false);

    fireEvent.click(await screen.findByTestId('payments-disconnect'));
    await screen.findByTestId('payments-disconnect-confirm');
    expect(screen.queryByTestId('payments-pause-instead')).toBeNull();
  });

  /**
   * A verdict about a credential belongs AT that credential.
   *
   * The adapter has always returned per-field checks; the screen listed them
   * under the form, so "chave publicável de produção em conexão de teste" sat
   * three boxes away from the box it was about, and the owner matched four
   * sentences to four inputs by eye. Reading it at the field is the difference
   * between a diagnosis and a puzzle.
   */
  it('shows each credential verdict at its own field', async () => {
    const config = {
      provider: 'stripe',
      status: 'FAILED',
      enabled: false,
      chargeVerifiedAt: null,
      environment: 'SANDBOX',
      environments: { SANDBOX: {}, PRODUCTION: {} },
    } as unknown as MaskedProviderConfig;

    const client = {
      baseUrl: '/api/admin/acme/payments',
      getSettings: vi.fn().mockResolvedValue({
        providers: [descriptorOf()],
        configs: [config],
        activeProvider: null,
      } as unknown as MerchantSettingsView),
      getSetupGuide: vi.fn().mockResolvedValue(null),
      // What the SERVER answers after the write: the three non-advanced fields
      // now on record. The probe runs off this, not off what was typed.
      saveCredentials: vi.fn().mockResolvedValue({
        ...config,
        environments: {
          SANDBOX: {
            secretKey: { configured: true, hint: '••••x' },
            publishableKey: { configured: true, hint: 'pk_live_x' },
            webhookSecret: { configured: true, hint: '••••x' },
          },
          PRODUCTION: {},
        },
      } as unknown as MaskedProviderConfig),
      setEnabled: vi.fn(),
      verify: vi.fn().mockResolvedValue({
        probe: {
          ok: false,
          environment: 'SANDBOX',
          checks: [
            {
              key: 'publishableKey',
              status: 'FAIL',
              message: 'Chave publicável de produção em conexão de teste.',
            },
          ],
        },
      }),
    } as unknown as PaymentsSettingsClient;

    render(
      <PaymentProviderSettings
        client={client}
        initialProvider="stripe"
        prepareConnect={async () => ({ state: 's', redirectUri: 'https://h.test/cb' })}
      />,
    );

    const disclosure = await screen.findByTestId('payments-manual-fallback');
    fireEvent.click(within(disclosure).getByText(/Prefiro informar as credenciais manualmente/i));

    const secret = await screen.findByLabelText(/Secret key/i);
    fireEvent.change(secret, { target: { value: 'sk_test_x' } });
    fireEvent.change(await screen.findByLabelText(/Publishable key/i), {
      target: { value: 'pk_live_x' },
    });
    // Every non-advanced field: the save only probes once the set is complete,
    // and `Connected account` is the one that must stay empty.
    fireEvent.change(await screen.findByLabelText(/Webhook signing secret/i), {
      target: { value: 'whsec_x' },
    });
    fireEvent.click(await screen.findByTestId('payments-save'));

    const note = await screen.findByTestId('payments-field-note-publishableKey');
    expect(note.textContent).toContain('produção em conexão de teste');
  });
});
