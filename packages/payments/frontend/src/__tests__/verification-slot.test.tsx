// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MerchantSettingsView } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';

/**
 * The activation step's slot.
 *
 * "Connected" and "can charge" are different facts, and only the HOST can prove
 * the second — it owns the endpoint that puts a real cent through the store's
 * account. This package's job is narrower and worth pinning: place that step
 * where an owner will actually find it, and tell the host which provider is
 * open and whether it is already live.
 */

const PROVIDERS = [
  { name: 'pagbank', displayName: 'PagBank', authMode: 'oauth', credentialSchema: [] },
];

function viewWith(config: Record<string, unknown> | null): MerchantSettingsView {
  return {
    providers: PROVIDERS,
    configs: config ? [config] : [],
    activeProvider: null,
  } as unknown as MerchantSettingsView;
}

function fakeClient(view: MerchantSettingsView): PaymentsSettingsClient {
  return {
    getSettings: vi.fn().mockResolvedValue(view),
    getSetupGuide: vi.fn().mockResolvedValue(null),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;
}

afterEach(cleanup);

describe('PaymentProviderSettings — the verification slot', () => {
  it('is not rendered while the owner is still on the provider list', async () => {
    const renderVerification = vi.fn(() => <div data-testid="slot" />);
    render(
      <PaymentProviderSettings
        client={fakeClient(viewWith(null))}
        renderVerification={renderVerification}
      />,
    );

    await screen.findByTestId('payments-provider-picker');
    expect(renderVerification).not.toHaveBeenCalled();
  });

  it('hands the host the open provider and its connection state', async () => {
    const renderVerification = vi.fn(() => <div data-testid="slot" />);
    render(
      <PaymentProviderSettings
        client={fakeClient(
          viewWith({ provider: 'pagbank', status: 'VERIFIED', enabled: true, environments: {} }),
        )}
        initialProvider="pagbank"
        renderVerification={renderVerification}
      />,
    );

    await screen.findByTestId('slot');
    expect(renderVerification).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'pagbank', connected: true }),
    );
    /**
     * `enabled` is deliberately withheld. The step used it to render a
     * standing "Provedor ativo" banner, which went on reassuring a store whose
     * every charge was refused — the banner and the refusal were on screen
     * together. The step reports what it observes, nothing else.
     */
    expect(renderVerification).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: expect.anything() }),
    );
  });

  /**
   * A provider with no stored row yet still renders the slot — the host decides
   * to show nothing. Reporting `connected: false` is what lets it.
   */
  it('reports a provider with no stored connection as not connected', async () => {
    const renderVerification = vi.fn(() => <div data-testid="slot" />);
    render(
      <PaymentProviderSettings
        client={fakeClient(viewWith(null))}
        initialProvider="pagbank"
        renderVerification={renderVerification}
      />,
    );

    await screen.findByTestId('slot');
    expect(renderVerification).toHaveBeenCalledWith(
      expect.objectContaining({ connected: false }),
    );
  });

  /**
   * Placement, not just presence: the step must sit OUTSIDE the manual
   * credentials disclosure. An owner who connected by OAuth is told no key
   * needs copying, so they have no reason to open it — and the step that
   * actually turns the store on would be hidden in there.
   */
  it('places the step outside the manual-credentials disclosure', async () => {
    render(
      <PaymentProviderSettings
        client={fakeClient(
          viewWith({ provider: 'pagbank', status: 'VERIFIED', enabled: false, environments: {} }),
        )}
        initialProvider="pagbank"
        renderVerification={() => <div data-testid="slot" />}
      />,
    );

    const slot = await screen.findByTestId('slot');
    await waitFor(() => expect(screen.queryByTestId('payments-manual-fallback')).toBeNull());
    expect(slot.closest('[data-testid="payments-manual-fallback"]')).toBeNull();
  });
});
