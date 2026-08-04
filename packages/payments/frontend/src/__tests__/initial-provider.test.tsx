// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MerchantSettingsView } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';

/**
 * Landing after an OAuth connect.
 *
 * This shipped broken TWICE, and the second time only because the test was
 * shaped around the code instead of the failure. The host reads the connected
 * provider from the callback's query string in an EFFECT, so it is null on
 * first render and arrives a tick later — and `useState(initialProvider)` keeps
 * the null forever. A test that renders with the prop already set passes
 * happily and proves nothing; the prop has to ARRIVE.
 */

const VIEW: MerchantSettingsView = {
  providers: [
    { name: 'pagbank', displayName: 'PagBank', authMode: 'oauth', credentialSchema: [] },
    { name: 'stripe', displayName: 'Stripe', authMode: 'credentials', credentialSchema: [] },
  ],
  configs: [],
  activeProvider: null,
} as unknown as MerchantSettingsView;

function fakeClient(): PaymentsSettingsClient {
  return {
    getSettings: vi.fn().mockResolvedValue(VIEW),
    getSetupGuide: vi.fn().mockResolvedValue(null),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;
}

describe('PaymentProviderSettings — landing after a connect', () => {
  it('lands on the provider list when nothing was just connected', async () => {
    render(<PaymentProviderSettings client={fakeClient()} />);
    expect(await screen.findByTestId('payments-provider-picker')).toBeDefined();
  });

  /**
   * The regression: the prop is null at mount and supplied afterwards, exactly
   * as the host does it. Seeding `useState` with it passes the OTHER test and
   * fails this one.
   */
  it('opens the provider when the host supplies it AFTER mount', async () => {
    const client = fakeClient();
    const { rerender } = render(<PaymentProviderSettings client={client} initialProvider={null} />);
    await screen.findByTestId('payments-provider-picker');

    rerender(<PaymentProviderSettings client={client} initialProvider="pagbank" />);

    // The picker is replaced by that provider's own panel.
    await waitFor(() => expect(screen.queryByTestId('payments-provider-picker')).toBeNull());
    expect(screen.getByTestId('payments-provider-back')).toBeDefined();
  });

  /**
   * Applied once, not on every render: the host holds the outcome for the
   * page's lifetime, so re-applying would make "Voltar aos provedores" bounce
   * straight back into the provider and trap the owner on one screen.
   */
  it('does not re-open the provider after the owner goes back', async () => {
    const client = fakeClient();
    const { rerender } = render(<PaymentProviderSettings client={client} initialProvider={null} />);
    await screen.findByTestId('payments-provider-picker');

    rerender(<PaymentProviderSettings client={client} initialProvider="pagbank" />);
    const back = await screen.findByTestId('payments-provider-back');

    back.click();

    // A rerender with the SAME still-set prop must not drag them back in.
    rerender(<PaymentProviderSettings client={client} initialProvider="pagbank" />);
    expect(await screen.findByTestId('payments-provider-picker')).toBeDefined();
  });
});
