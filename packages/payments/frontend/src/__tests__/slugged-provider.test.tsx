// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MerchantSettingsView } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';

/**
 * How a provider is spelled in a URL is the ADAPTER's declaration (FUT-557),
 * carried in the catalog as `urlSlug`. A controlled host passes its path
 * segment verbatim and writes back whatever `onProviderChange` reports, so
 * it holds no map of providers: resolution here must accept the slug AND the
 * raw name (old links must not 404), and report the slug on every change.
 */

const VIEW: MerchantSettingsView = {
  providers: [
    {
      name: 'infinitepay',
      displayName: 'InfinitePay',
      urlSlug: 'infinite-pay',
      authMode: 'credentials',
      credentialSchema: [],
    },
    { name: 'pagbank', displayName: 'PagBank', urlSlug: 'pagbank', authMode: 'oauth', credentialSchema: [] },
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

describe('PaymentProviderSettings — adapter-declared URL slugs', () => {
  it('opens the provider a slug segment names', async () => {
    render(<PaymentProviderSettings client={fakeClient()} selectedProvider="infinite-pay" />);

    expect(await screen.findByTestId('payments-provider-back')).toBeDefined();
    await waitFor(() => expect(screen.queryByTestId('payments-provider-picker')).toBeNull());
  });

  it('still resolves the raw name, so a link minted before the slug existed lands', async () => {
    render(<PaymentProviderSettings client={fakeClient()} selectedProvider="infinitepay" />);

    expect(await screen.findByTestId('payments-provider-back')).toBeDefined();
  });

  it('reports the slug on selection, for the host to write into its URL verbatim', async () => {
    const onProviderChange = vi.fn();
    render(
      <PaymentProviderSettings
        client={fakeClient()}
        selectedProvider={null}
        onProviderChange={onProviderChange}
      />,
    );
    const card = await screen.findByTestId('payments-provider-card-infinitepay');

    card.click();

    await waitFor(() => expect(onProviderChange).toHaveBeenCalledWith('infinite-pay'));
  });

  /**
   * The OAuth callback's `?connected=` carries the raw NAME, and the host
   * writes it into the URL before the catalog exists — it holds no map. The
   * screen is right either way (the alias resolves); the ADDRESS BAR is what
   * would stay wrong, and it is what a reload or a shared link uses. So once
   * the catalog can spell the provider, the component asks the host to respell
   * the segment — as a `replace`, so Voltar never revisits the alias.
   */
  it('asks the host to respell an alias segment to the canonical slug, as a replace', async () => {
    const onProviderChange = vi.fn();
    render(
      <PaymentProviderSettings
        client={fakeClient()}
        selectedProvider="infinitepay"
        onProviderChange={onProviderChange}
      />,
    );

    await waitFor(() =>
      expect(onProviderChange).toHaveBeenCalledWith('infinite-pay', { replace: true }),
    );
  });

  it('leaves a segment already spelled canonically alone', async () => {
    const onProviderChange = vi.fn();
    render(
      <PaymentProviderSettings
        client={fakeClient()}
        selectedProvider="infinite-pay"
        onProviderChange={onProviderChange}
      />,
    );

    await screen.findByTestId('payments-provider-back');
    expect(onProviderChange).not.toHaveBeenCalled();
  });
});
