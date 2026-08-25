// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MaskedProviderConfig,
  MerchantSettingsView,
  ProviderDescriptor,
  ProviderSetupGuide,
} from '@12-apps/payments-backend';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';
import { PT_BR_STRIPE_COPY } from '@12-apps/payments-backend';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';
import { credentialSchemaOf } from "@12-apps/payments-backend";

/**
 * The OAuth branch's layout contract (FUT-691).
 *
 * An OAuth provider's screen leads with the connect card, which tells the
 * owner no key needs copying — so nothing gives them a reason to open the
 * "prefiro informar as credenciais manualmente" disclosure. Yet the provider's
 * setup guide AND the only probe surface both lived inside it: the walkthrough
 * was buried, and "Testar conexão" (which the guide itself tells the owner to
 * press) did not exist anywhere they would look. The guide and the probe now
 * render OUTSIDE the accordion; the credential form stays inside it.
 *
 * Deliberately shared behavior — pinned on a generic provider AND on the real
 * stripe adapter (tests are exempt from the provider-literal rule).
 */

const GUIDE: ProviderSetupGuide = {
  stages: [
    { id: 'conectar', label: 'Conectar' },
    { id: 'habilitar', label: 'Habilitar' },
  ],
  sections: [
    {
      id: 'conectar',
      title: 'Passo 1 · Conecte a conta',
      steps: [{ text: 'Autorize no site do provedor.' }],
    },
    {
      id: 'habilitar',
      title: 'Passo 2 · Habilite as cobranças',
      steps: [{ text: 'Ative a opção no painel da conta.' }],
    },
  ],
  activeStage: 1,
};

const OAUTH_DESCRIPTOR = {
  name: 'aurora',
  displayName: 'Aurora Pagamentos',
  urlSlug: 'aurora',
  authMode: 'oauth',
  credentialSchema: [{ key: 'token', label: 'Token de acesso', secret: true, required: true }],
} as unknown as ProviderDescriptor;

function connectedConfig(provider: string, masked: Record<string, unknown>): MaskedProviderConfig {
  return {
    provider,
    status: 'VERIFIED',
    enabled: false,
    chargeVerifiedAt: null,
    environment: 'SANDBOX',
    environments: { SANDBOX: masked, PRODUCTION: {} },
  } as unknown as MaskedProviderConfig;
}

interface World {
  descriptor: ProviderDescriptor;
  config: MaskedProviderConfig;
  guide: ProviderSetupGuide | null;
  probe?: { ok: boolean; environment: string; message?: string };
}

function fakeClient(world: World): PaymentsSettingsClient {
  const view = {
    providers: [world.descriptor],
    configs: [world.config],
    activeProvider: null,
  } as unknown as MerchantSettingsView;
  return {
    baseUrl: '/api/admin/acme/payments',
    getSettings: vi.fn().mockResolvedValue(view),
    getSetupGuide: vi.fn().mockResolvedValue(world.guide),
    verify: vi.fn().mockResolvedValue({ probe: world.probe ?? { ok: true, environment: 'SANDBOX' } }),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;
}

function renderPanel(world: World): PaymentsSettingsClient {
  const client = fakeClient(world);
  render(
    <PaymentProviderSettings
      copy={PT_BR_PAYMENTS_SETTINGS_COPY}
      client={client}
      initialProvider={world.descriptor.name}
      prepareConnect={async () => ({ state: 'st_1', redirectUri: 'https://host.test/cb' })}
    />,
  );
  return client;
}

/** The nearest manual-fallback ancestor, or null — "is it buried?" as a fact. */
function insideAccordion(element: HTMLElement): HTMLElement | null {
  return element.closest('[data-testid="payments-manual-fallback"]');
}

afterEach(cleanup);

describe('PaymentProviderSettings — the OAuth branch layout (FUT-691)', () => {
  it('renders the guide outside the accordion, and the credential form inside it', async () => {
    renderPanel({
      descriptor: OAUTH_DESCRIPTOR,
      config: connectedConfig('aurora', { token: { configured: true, hint: '••••1234' } }),
      guide: GUIDE,
    });

    const section = await screen.findByTestId('payments-setup-section-habilitar');
    expect(insideAccordion(section)).toBeNull();
    expect(insideAccordion(screen.getByTestId('payments-setup-guide'))).toBeNull();

    // The form itself stays behind the disclosure — that fallback is real.
    //
    // It now has to be OPENED to be asserted, where it used to be queryable
    // while collapsed. Not a weakening of FUT-691: that bug was the guide being
    // buried in here, which the two assertions above still pin unchanged. The
    // disclosure holds a whole path block now — its own stepper included — so
    // it unmounts when closed rather than keeping a second walkthrough in the
    // DOM behind a collapsed panel.
    fireEvent.click(screen.getByText(/Prefiro informar as credenciais manualmente/i));
    const save = await screen.findByTestId('payments-save');
    expect(insideAccordion(save)).not.toBeNull();
  });

  it('surfaces "Testar conexão" outside the accordion for a connected store', async () => {
    const client = renderPanel({
      descriptor: OAUTH_DESCRIPTOR,
      config: connectedConfig('aurora', { token: { configured: true, hint: '••••1234' } }),
      guide: GUIDE,
      probe: { ok: false, environment: 'SANDBOX', message: 'A conta não respondeu.' },
    });

    const button = await screen.findByTestId('payments-oauth-verify');
    expect(insideAccordion(button)).toBeNull();

    fireEvent.click(button);
    await waitFor(() => {
      expect(client.verify).toHaveBeenCalledWith('aurora', 'SANDBOX');
    });
    // A failing probe reports with the adapter's own sentence.
    const alert = await screen.findByTestId('payments-probe-result');
    expect(alert.textContent).toContain('A conta não respondeu.');
  });

  it('withholds the probe while there is no connection to test', async () => {
    renderPanel({
      descriptor: OAUTH_DESCRIPTOR,
      config: {
        ...connectedConfig('aurora', {}),
        status: 'UNVERIFIED',
      } as unknown as MaskedProviderConfig,
      guide: null,
    });

    await screen.findByTestId('payments-provider-settings');
    await waitFor(() => {
      expect(screen.queryByTestId('payments-oauth-verify')).toBeNull();
    });
  });

  /**
   * The same contract on the shipped stripe adapter: a connected store's guide
   * opens on the DASHBOARD section — the one carrying the store's notification
   * URL — not stuck on step 1, and outside the accordion.
   *
   * The adapter now reports the last, sectionless stage for a connected store
   * and the renderer clamps back to this one until the owner confirms
   * (FUT-799); it used to report this stage directly, which is what left the
   * activation card with nowhere to go. What the owner SEES here is unchanged,
   * which is the point of asserting it from the outside.
   */
  it('opens stripe on the dashboard section for a connected store, outside the accordion', async () => {
    const adapter = stripeProvider(PT_BR_STRIPE_COPY);
    const descriptor = {
      name: adapter.name,
      displayName: adapter.displayName,
      urlSlug: adapter.name,
      authMode: 'oauth',
      credentialSchema: credentialSchemaOf(adapter),
    } as unknown as ProviderDescriptor;
    const guide = adapter.setupGuide?.({
      brandName: 'Plataforma Exemplo',
      webhookUrl: 'https://loja.example/api/webhooks/stripe',
      progress: { configured: { publishableKey: true }, connected: true, proven: false },
    });

    renderPanel({
      descriptor,
      config: connectedConfig('stripe', { publishableKey: { configured: true, hint: 'pk_x' } }),
      guide: guide ?? null,
    });

    const section = await screen.findByTestId('payments-setup-section-dashboard');
    expect(insideAccordion(section)).toBeNull();
    expect(section.textContent).toContain('URL de notificação');
    // Past step 1: the connect section is not the open one.
    await waitFor(() => {
      expect(screen.queryByTestId('payments-setup-section-connect')).toBeNull();
    });
    // And the probe the webhook copy points at actually exists on this screen.
    expect(insideAccordion(screen.getByTestId('payments-oauth-verify'))).toBeNull();
  });
});
