// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  credentialSchemaOf,
  PT_BR_STRIPE_COPY,
  type MaskedProviderConfig,
  type MerchantSettingsView,
  type ProviderDescriptor,
} from '@12-apps/payments-backend';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * The credential form on an OAuth provider's manual path keeps the card's inset
 * (FUT-4144).
 *
 * The disclosure that used to wrap this form was an accordion with padding of
 * its own; it became a bare box once opened ("it IS the path"), and the blocks
 * that leaned on that padding — the environment switch, its notice, and the
 * credential boxes with their save bar — ran into the card's left and right
 * edges at every width, while the walkthrough between them, which sets its own
 * inset, did not. Seen in the FUT-4144 run gate on Stripe and PagBank.
 *
 * The save bar's own 18px is zeroed inside the wrapper (`INSET_FORM_SX`), so it
 * lines up with the boxes. That is a specificity question jsdom's cascade does
 * not answer (it applies rules in source order), so it is measured in a real
 * browser, not here.
 */

function renderManualPath() {
  const adapter = stripeProvider(PT_BR_STRIPE_COPY);
  const descriptor = {
    name: adapter.name,
    displayName: adapter.displayName,
    urlSlug: adapter.name,
    authMode: 'oauth',
    credentialSchema: credentialSchemaOf(adapter),
  } as unknown as ProviderDescriptor;
  const config = {
    provider: 'stripe',
    status: 'UNVERIFIED',
    enabled: false,
    chargeVerifiedAt: null,
    environment: 'SANDBOX',
    environments: { SANDBOX: {}, PRODUCTION: {} },
  } as unknown as MaskedProviderConfig;
  const client = {
    baseUrl: '/api/admin/acme/payments',
    getSettings: vi.fn().mockResolvedValue({
      providers: [descriptor],
      configs: [config],
      activeProvider: null,
    } as unknown as MerchantSettingsView),
    getSetupGuide: vi.fn().mockResolvedValue(null),
    verify: vi.fn(),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;

  render(
    <PaymentProviderSettings
      copy={PT_BR_PAYMENTS_SETTINGS_COPY}
      client={client}
      initialProvider="stripe"
      prepareConnect={async () => ({ state: 'st_1', redirectUri: 'https://host.test/cb' })}
    />,
  );
}

async function openManual(): Promise<HTMLElement> {
  const disclosure = await screen.findByTestId('payments-manual-fallback');
  fireEvent.click(within(disclosure).getByText(/Prefiro informar as credenciais manualmente/i));
  return screen.getByTestId('payments-manual-fallback');
}

/** The horizontal inset `element` gets from its ancestors, up to (not including) `stop`. */
function insetWithin(element: HTMLElement, stop: HTMLElement): { left: number; right: number } {
  const ancestors: HTMLElement[] = [];
  for (let node = element.parentElement; node && node !== stop; node = node.parentElement) ancestors.push(node);
  const styles = ancestors.map((node) => getComputedStyle(node));
  const sum = (side: 'paddingLeft' | 'paddingRight') =>
    styles.reduce((total, style) => total + (Number.parseFloat(style[side]) || 0), 0);
  return { left: sum('paddingLeft'), right: sum('paddingRight') };
}

afterEach(cleanup);

describe('the manual path on an OAuth provider', () => {
  it('insets the credential boxes by the card inset, once', async () => {
    renderManualPath();
    const path = await openManual();
    const box = (await screen.findByLabelText(/Chave secreta/i)).closest('.MuiTextField-root') as HTMLElement;

    expect(insetWithin(box, path)).toEqual({ left: 20, right: 20 });
  });

  it('insets the environment switch by the card inset, once', async () => {
    renderManualPath();
    const path = await openManual();
    const tabs = await screen.findByTestId('payments-environment-tabs');

    expect(insetWithin(tabs, path)).toEqual({ left: 20, right: 20 });
  });

  it('insets the environment notice by the card inset, once', async () => {
    renderManualPath();
    const path = await openManual();
    const notice = await screen.findByTestId('payments-environment-notice-SANDBOX');

    expect(insetWithin(notice, path)).toEqual({ left: 20, right: 20 });
  });

});
