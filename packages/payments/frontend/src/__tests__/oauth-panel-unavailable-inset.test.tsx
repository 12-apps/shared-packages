// @vitest-environment jsdom
import { cleanup, render, screen } from './settings-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { OAuthPanel } from '../components/OAuthPanel';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * An OAuth provider on an installation with no connect button (FUT-4144).
 *
 * The card's body carries no padding (`ProviderCard`), so every block in it
 * sets the card's inset itself. The connect branch did (FUT-4071, FUT-4084);
 * the branch for a host that passes no `prepareConnect` did not, so the "no
 * connect button here" notice, the connection probe and the host's activation
 * step ran into the card's left and right edges.
 */

const descriptor = {
  name: 'pagbank',
  displayName: 'PagBank',
  authMode: 'oauth',
  credentialSchema: [{ key: 'token', label: 'Token', secret: true }],
} as unknown as ProviderDescriptor;

const config = {
  provider: 'pagbank',
  status: 'VERIFIED',
  enabled: false,
  environment: 'SANDBOX',
  environments: { SANDBOX: {}, PRODUCTION: {} },
} as unknown as MaskedProviderConfig;

function renderUnavailable() {
  render(
    <OAuthPanel
      descriptor={descriptor}
      config={config}
      client={{} as PaymentsSettingsClient}
      reload={vi.fn()}
      verification={<div data-testid="host-activation" />}
      statusBar={null}
      walkthrough={() => null}
      form={<div data-testid="manual-form" />}
    />,
  );
}

/** The horizontal padding of the box the panel wraps `element` in. */
function insetOf(element: HTMLElement): { left: number; right: number } {
  const style = getComputedStyle(element.parentElement as HTMLElement);
  return { left: Number.parseFloat(style.paddingLeft) || 0, right: Number.parseFloat(style.paddingRight) || 0 };
}

afterEach(cleanup);

describe('the OAuth card with no connect button — inset (FUT-4144)', () => {
  it('insets the notice that no connect button is available', () => {
    renderUnavailable();
    const notice = screen.getByText(PT_BR_PAYMENTS_SETTINGS_COPY.oauth.connectUnavailable).closest('.MuiAlert-root');
    expect(insetOf(notice as HTMLElement)).toEqual({ left: 20, right: 20 });
  });

  it('insets the connection probe', () => {
    renderUnavailable();
    expect(insetOf(screen.getByTestId('payments-connection-probe'))).toEqual({ left: 20, right: 20 });
  });

  it("insets the host's activation step", () => {
    renderUnavailable();
    expect(insetOf(screen.getByTestId('host-activation'))).toEqual({ left: 20, right: 20 });
  });

  it('leaves the manual form to inset its own blocks', () => {
    renderUnavailable();
    expect(insetOf(screen.getByTestId('manual-form'))).toEqual({ left: 0, right: 0 });
  });
});
