// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MerchantSettingsView } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * Controlled selection — the mode a host uses when the open provider lives in
 * the URL, so each one is its own page.
 *
 * The failure this guards is the component quietly keeping its own copy of the
 * selection: the screen would still LOOK right on a click (internal state moved
 * too), and only a reload, a shared link or the browser's back button would
 * show the two had drifted. So these assert on the direction of travel — the
 * host's value wins, and the component only ever ASKS to change it.
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

describe('PaymentProviderSettings — host-controlled selection', () => {
  it('opens the provider the host names, on the first render', async () => {
    render(<PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={fakeClient()} selectedProvider="pagbank" />);

    // No handover tick to wait for: a controlled host has the answer at mount.
    expect(await screen.findByTestId('payments-provider-back')).toBeDefined();
    await waitFor(() => expect(screen.queryByTestId('payments-provider-picker')).toBeNull());
  });

  /**
   * `null` is an answer, not a missing prop. Read as "unset" it would fall back
   * to internal state and strand the owner in the provider they last opened.
   */
  it('shows the list when the host says null', async () => {
    render(<PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={fakeClient()} selectedProvider={null} />);
    expect(await screen.findByTestId('payments-provider-picker')).toBeDefined();
  });

  /**
   * The core of controlled mode: a click must not move the view on its own.
   * If it does, the URL and the screen disagree the moment either is reloaded.
   */
  it('does not change the open provider by itself — it asks', async () => {
    const onProviderChange = vi.fn();
    render(
      <PaymentProviderSettings
      copy={PT_BR_PAYMENTS_SETTINGS_COPY}
        client={fakeClient()}
        selectedProvider="pagbank"
        onProviderChange={onProviderChange}
      />,
    );
    const back = await screen.findByTestId('payments-provider-back');

    back.click();

    await waitFor(() => expect(onProviderChange).toHaveBeenCalledWith(null));
    // Still on pagbank: the host has not said otherwise yet.
    expect(screen.getByTestId('payments-provider-back')).toBeDefined();
    await waitFor(() => expect(screen.queryByTestId('payments-provider-picker')).toBeNull());
  });

  /** The host's later value is honoured every time — not once, as with initialProvider. */
  it('follows the host on each change, in both directions', async () => {
    const client = fakeClient();
    const { rerender } = render(
      <PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={client} selectedProvider="pagbank" />,
    );
    await screen.findByTestId('payments-provider-back');

    rerender(<PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={client} selectedProvider={null} />);
    expect(await screen.findByTestId('payments-provider-picker')).toBeDefined();

    rerender(<PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={client} selectedProvider="stripe" />);
    await waitFor(() => expect(screen.queryByTestId('payments-provider-picker')).toBeNull());
  });

  /**
   * Uncontrolled hosts predate this prop and must be untouched: selection stays
   * internal, and `onProviderChange` is only an observer.
   */
  it('still keeps its own selection when the host does not control it', async () => {
    const onProviderChange = vi.fn();
    render(
      <PaymentProviderSettings
      copy={PT_BR_PAYMENTS_SETTINGS_COPY}
        client={fakeClient()}
        initialProvider="pagbank"
        onProviderChange={onProviderChange}
      />,
    );
    const back = await screen.findByTestId('payments-provider-back');

    back.click();

    const picker = await screen.findByTestId('payments-provider-picker');
    expect(picker).toBeDefined();
    await waitFor(() => expect(onProviderChange).toHaveBeenCalledWith(null));
  });
});
