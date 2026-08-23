// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MerchantSettingsView, ProviderSetupGuide } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';
import { CHECKOUT_CONFIRM_ACTION } from '../components/SetupGuideSection';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * The setup step no API can answer, and what it holds back.
 *
 * InfinitePay ships Checkout Integrado disabled and publishes nothing that
 * reports its state, so a store can pass the probe, read `CONEXÃO OK`, and
 * still be unable to mint a single payment link. The only reading available is
 * the owner's.
 *
 * Until they give it, the walkthrough stays on that step and the activation
 * step is not on screen at all — one step at a time is the whole shape of this
 * flow, and a card offering to charge R$ 1,01 sitting under "Passo 2" is two
 * steps at once, the costly one unasked for.
 *
 * The exception is the case that must never regress: a store that has ALREADY
 * paid sees the step regardless of what the guide would show, because that
 * panel is what reports the confirmed charge — and, on a return trip, what
 * reads the `transaction_nsu` the provider sends the payer back with.
 */

const GUIDE: ProviderSetupGuide = {
  stages: [
    { id: 'handle', label: 'Informar InfiniteTag' },
    { id: 'enable', label: 'Habilitar o Checkout' },
    { id: 'activate', label: 'Ativar vendas' },
  ],
  sections: [
    {
      id: 'enable',
      title: 'Habilitar o Checkout Integrado',
      steps: [{ text: 'Confirme que está ligado.', action: CHECKOUT_CONFIRM_ACTION }],
    },
  ],
  activeStage: 2,
};

function viewWith(chargeVerifiedAt: string | null): MerchantSettingsView {
  return {
    providers: [
      {
        name: 'infinitepay',
        displayName: 'InfinitePay',
        authMode: 'credentials',
        credentialSchema: [
          { key: 'handle', label: 'InfiniteTag ($usuario)', secret: false, required: true },
        ],
      },
    ],
    configs: [
      {
        provider: 'infinitepay',
        status: 'VERIFIED',
        enabled: false,
        chargeVerifiedAt,
        environment: 'SANDBOX',
        environments: { SANDBOX: { handle: { configured: true, hint: '$loja' } } },
      },
    ],
    activeProvider: null,
  } as unknown as MerchantSettingsView;
}

function fakeClient(view: MerchantSettingsView): PaymentsSettingsClient {
  return {
    baseUrl: '/api/admin/acme/payments',
    getSettings: vi.fn().mockResolvedValue(view),
    getSetupGuide: vi.fn().mockResolvedValue(GUIDE),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;
}

/** The host's step 3, reduced to the two facts this file is about. */
function renderSettings(chargeVerifiedAt: string | null = null) {
  const seen: Array<{ blocked: boolean; hidden: boolean }> = [];
  render(
    <PaymentProviderSettings
      copy={PT_BR_PAYMENTS_SETTINGS_COPY}
      client={fakeClient(viewWith(chargeVerifiedAt))}
      initialProvider="infinitepay"
      renderVerification={({ blocked, hidden }) => {
        seen.push({ blocked, hidden });
        return (
          <div data-testid="step-three" data-hidden={hidden}>
            {blocked ? 'blocked' : 'ready'}
          </div>
        );
      }}
    />,
  );
  return seen;
}

/**
 * How long the FIRST assertion of a test may take.
 *
 * It is not asserting a render — it is absorbing the screen's whole async
 * boot: the settings fetch, then the setup-guide fetch keyed on what that
 * returned, then the effects both settle. Every later assertion in the same
 * test is a warm re-render and keeps the default.
 *
 * The default 1000ms was enough on a quiet machine and not on CI, where this
 * package's tests run beside twenty others' — the lane went red on the landing
 * line with the correct DOM already in the failure dump, which is the exact
 * signature of a budget that is too tight rather than a screen that is wrong.
 */
const LANDED = { timeout: 10_000 };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('the step only the owner can report', () => {
  /**
   * The step is told it is not the current one; it is not UNMOUNTED.
   *
   * The difference is load-bearing and was learned the hard way. A provider
   * refusing to mint a link is the evidence that withdraws the owner's
   * "Checkout Integrado is on" — so the guide goes back a step in the same
   * render that produced the explanation, and unmounting the panel took the
   * explanation off screen with it. The owner was returned to a step they
   * believed they had finished, with nothing saying why.
   *
   * So the host is handed `hidden` and decides. With nothing settled it draws
   * nothing (the pay button must not appear); with a refusal in hand it keeps
   * saying so.
   */
  it('tells the activation step it is not the current one until Step 2 is confirmed', async () => {
    renderSettings();

    await screen.findByTestId('payments-setup-section-enable', undefined, LANDED);
    const step = await screen.findByTestId('step-three', undefined, LANDED);
    await waitFor(() => expect(step.dataset['hidden']).toBe('true'));
    // And blocked with it: not the current step AND no pay button, which are
    // two different withholdings that happen to coincide here.
    expect(step.textContent).toBe('blocked');
  });

  it('releases the charge once the owner confirms, and remembers it', async () => {
    renderSettings();

    await screen.findByTestId('payments-setup-section-enable', undefined, LANDED);
    fireEvent.click(screen.getByRole('button', { name: /Já habilitei o Checkout Integrado/i }));

    await waitFor(() => expect(screen.getByTestId('step-three').textContent).toBe('ready'));
    expect(screen.getByTestId('step-three').dataset['hidden']).toBe('false');
    // Collapsed to a row rather than removed: it is the claim step 3 is about
    // to test, and the owner needs somewhere to press Revisar when it fails.
    expect(screen.getByTestId('payments-setup-confirmed')).toBeTruthy();

    cleanup();
    // The flow deliberately LEAVES the page — the owner pays on the provider's
    // site and comes back. An answer that did not survive that round trip would
    // bounce them to step 2, hiding the panel polling the payment they just
    // made.
    renderSettings();
    await waitFor(() => expect(screen.getByTestId('step-three').textContent).toBe('ready'), LANDED);
  });

  /**
   * A charge that landed proves the setting is on far better than the owner's
   * word could, so a store reconnecting from a machine with no stored answer is
   * never sent back through step 2.
   */
  it('never asks a store that has already been paid through', async () => {
    renderSettings('2026-07-30T12:00:00.000Z');

    await waitFor(() => expect(screen.getByTestId('step-three').textContent).toBe('ready'), LANDED);
  });
});
