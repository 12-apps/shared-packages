// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/**
 * One connection path on screen at a time — and its OWN steps.
 *
 * A provider that supports both a grant and pasted keys used to show both at
 * once the moment the owner opened the manual disclosure: a card saying
 * "nenhuma chave precisa ser copiada" directly above four boxes asking for
 * keys, with "Reconectar" and "Desconectar" between them belonging to neither
 * — every control on that card acts on an OAuth grant a hand-connected store
 * does not have.
 *
 * The walkthrough had the same problem in longer form, and deleting it was the
 * wrong cure: an owner pasting keys needs a walkthrough MORE, not less, because
 * nothing else says where a signing secret comes from. So the guide stays and
 * the STEPS change — `ProviderSetupGuide.credentialsPath`.
 *
 * Asserted on the shipped stripe adapter rather than a fixture: the wording
 * being path-correct is the whole feature, and a hand-written guide here would
 * assert only that the plumbing moves strings around.
 */

function stripeDescriptor(): ProviderDescriptor {
  const adapter = stripeProvider();
  return {
    name: adapter.name,
    displayName: adapter.displayName,
    urlSlug: adapter.name,
    authMode: 'oauth',
    credentialSchema: adapter.credentialSchema,
  } as unknown as ProviderDescriptor;
}

function stripeGuide(connected: boolean): ProviderSetupGuide {
  const guide = stripeProvider().setupGuide?.({
    brandName: 'Quitanda Digital',
    webhookUrl: 'https://loja.example/api/webhooks/payments/stripe/x',
    progress: { configured: {}, connected, proven: false },
  });
  if (!guide) throw new Error('stripe ships a setup guide');
  return guide;
}

function configFor(connected: boolean): MaskedProviderConfig {
  return {
    provider: 'stripe',
    status: connected ? 'VERIFIED' : 'UNVERIFIED',
    enabled: false,
    chargeVerifiedAt: null,
    environment: 'SANDBOX',
    environments: {
      SANDBOX: connected ? { publishableKey: { configured: true, hint: 'pk_x' } } : {},
      PRODUCTION: {},
    },
  } as unknown as MaskedProviderConfig;
}

function renderPanel(connected: boolean) {
  const descriptor = stripeDescriptor();
  const view = {
    providers: [descriptor],
    configs: [configFor(connected)],
    activeProvider: null,
  } as unknown as MerchantSettingsView;
  const client = {
    baseUrl: '/api/admin/acme/payments',
    getSettings: vi.fn().mockResolvedValue(view),
    getSetupGuide: vi.fn().mockResolvedValue(stripeGuide(connected)),
    verify: vi.fn().mockResolvedValue({ probe: { ok: true, environment: 'SANDBOX' } }),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;

  render(
    <PaymentProviderSettings
      client={client}
      initialProvider="stripe"
      prepareConnect={async () => ({ state: 'st_1', redirectUri: 'https://host.test/cb' })}
    />,
  );
  return client;
}

/** Open "prefiro informar as credenciais manualmente". */
async function openManual() {
  // Scoped to the disclosure: step 1's own copy names it too, pointing the
  // owner at it — which is the whole reason it is worth naming there.
  const disclosure = await screen.findByTestId('payments-manual-fallback');
  fireEvent.click(within(disclosure).getByText(/Prefiro informar as credenciais manualmente/i));
}

afterEach(cleanup);

describe('the two connection paths are mutually exclusive', () => {
  it('leads with the OAuth card while the disclosure is closed', async () => {
    renderPanel(true);

    await screen.findByTestId('payments-setup-guide');
    expect(screen.getByRole('button', { name: /Reconectar/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Desconectar/i })).toBeTruthy();
    // No return leg to offer: the owner is already on the path it returns to.
    expect(screen.queryByTestId('payments-oauth-fallback')).toBeNull();
  });

  it('withdraws the grant-only controls once the credential form is open', async () => {
    renderPanel(true);
    await screen.findByTestId('payments-setup-guide');
    await openManual();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Reconectar/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Desconectar/i })).toBeNull();
    });
    // Each path is one block — a way in, its steps, its inputs — so the
    // credentials walkthrough lives INSIDE the disclosure with the fields it
    // describes, and the OAuth one leaves with the card it belongs to.
    const guide = screen.getByTestId('payments-setup-guide');
    expect(guide.closest('[data-testid="payments-manual-fallback"]')).not.toBeNull();
  });

  it('offers the way back, so the form is not a one-way door', async () => {
    renderPanel(true);
    await screen.findByTestId('payments-setup-guide');
    await openManual();

    const back = await screen.findByTestId('payments-oauth-fallback');
    fireEvent.click(within(back).getByText(/Prefiro conectar por autorização/i));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Reconectar/i })).toBeTruthy();
      expect(screen.queryByTestId('payments-oauth-fallback')).toBeNull();
    });
  });

  /**
   * The bug this whole variant exists for: step 1 told an owner staring at four
   * credential boxes to press "Conectar com Stripe" above — a button the panel
   * had just removed, because it acts on a grant they are not using.
   */
  it('swaps step 1 for the path the owner chose', async () => {
    renderPanel(false);

    const oauthStep = await screen.findByTestId('payments-setup-section-connect');
    expect(oauthStep.textContent).toContain('Conectar com Stripe');
    expect(oauthStep.textContent).not.toContain('Secret key');

    await openManual();

    await waitFor(() => {
      const manualStep = screen.getByTestId('payments-setup-section-connect');
      // Where the values come from, which is the part Stripe makes hard.
      expect(manualStep.textContent).toContain('Chaves de API');
      expect(manualStep.textContent).toContain('Signing secret');
      // …and NOT an instruction to press a button that is not rendered.
      expect(manualStep.textContent).not.toContain('Conectar com Stripe');
    });
    // Exactly one stepper on screen, and it is the credentials one: the OAuth
    // block left with its button.
    expect(screen.getAllByTestId('payments-setup-guide')).toHaveLength(1);
    expect(screen.getByText('Informar as chaves')).toBeTruthy();
  });

  /**
   * The banner is a full-bleed STRIP when it spans the provider card, and an
   * ordinary alert when it does not. Its band geometry — square corners, and
   * `px: 3` matching the card's own padding so the text lines up with the
   * content above and below — indents the text a second time inside the
   * disclosure, which is already inset, and squares off a box visibly touching
   * neither edge. MUI drops `MuiPaper-rounded` when `square` is set, so the
   * class is the honest read on which geometry is in play.
   */
  it('renders the environment banner inset, not full-bleed, inside the disclosure', async () => {
    renderPanel(true);
    await screen.findByTestId('payments-setup-guide');
    await openManual();

    const notice = await screen.findByTestId('payments-environment-notice-SANDBOX');
    expect(notice.closest('[data-testid="payments-manual-fallback"]')).not.toBeNull();
    expect(notice.classList.contains('MuiPaper-rounded')).toBe(true);
  });

  /**
   * Saving IS testing — the write is followed straight away by the probe that
   * reaches the provider with the pasted keys, and a passing probe is the only
   * thing that makes the activation charge appear. "Salvar" claimed half of
   * that, and on this path it is the owner's ONLY control, so they were left
   * hunting for the button that sends the keys.
   *
   * …but the promise has to be true. Mid-typing there is no connection to test,
   * and the save that ran one anyway reported "Credenciais recusadas pela
   * Stripe" over a form with two boxes still empty — a rejection of a request
   * not worth making, reading as a verdict on what had been typed.
   */
  it('leaves an advanced field out of what "filled" means', async () => {
    // `connectedAccountId` sends `Stripe-Account:`, which is for a PLATFORM
    // charging on behalf of an account it onboarded. Counting it toward
    // completeness told owners to fill it, and their own account id there makes
    // Stripe refuse every call — the refusal this gate exists to avoid.
    renderPanel(true);
    await openManual();

    const boxes = screen.getAllByRole('textbox');
    for (const box of boxes) {
      const advanced = /Connected account/i.test(box.getAttribute('aria-label') ?? box.id ?? '');
      if (!advanced) fireEvent.change(box, { target: { value: 'x' } });
    }
    for (const secret of document.querySelectorAll('input[type="password"]')) {
      fireEvent.change(secret, { target: { value: 'x' } });
    }

    await waitFor(() => {
      // Complete WITHOUT the advanced box — the owner is never pushed to fill it.
      expect(screen.getByTestId('payments-save').textContent).toContain('Salvar e testar conexão');
    });
  });

  it('promises a test only once every field is filled', async () => {
    renderPanel(false);
    await openManual();

    const save = await screen.findByTestId('payments-save');
    expect(save.textContent).toContain('Salvar');
    expect(save.textContent).not.toContain('testar conexão');

    const boxes = screen.getAllByRole('textbox');
    for (const box of boxes) fireEvent.change(box, { target: { value: 'x' } });
    for (const secret of document.querySelectorAll('input[type="password"]')) {
      fireEvent.change(secret, { target: { value: 'x' } });
    }

    await waitFor(() => {
      expect(screen.getByTestId('payments-save').textContent).toContain('Salvar e testar conexão');
    });
  });
});
