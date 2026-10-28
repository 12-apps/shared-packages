// @vitest-environment jsdom
import { cleanup, render, screen } from './settings-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { OAuthPanel } from '../components/OAuthPanel';

/**
 * The connected OAuth card's vertical rhythm (FUT-4084).
 *
 * "Testar conexão" sat flush against the host's activation box above it and
 * the manual-credentials link below it: the blocks set the card's inset
 * (FUT-4071) but no gap. Both now take the card's own spacing step, and a host
 * step that renders nothing takes no gap at all.
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

function renderPanel(verification: ReactElement) {
  render(
    <OAuthPanel
      descriptor={descriptor}
      config={config}
      client={{} as PaymentsSettingsClient}
      reload={vi.fn()}
      prepareConnect={vi.fn()}
      verification={verification}
      statusBar={null}
      walkthrough={() => null}
      form={null}
    />,
  );
}

/** The inset box the panel wraps a block in. */
function boxOf(testId: string): HTMLElement {
  return screen.getByTestId(testId).parentElement as HTMLElement;
}

afterEach(cleanup);

describe('the connected OAuth card — vertical gap (FUT-4084)', () => {
  it('spaces the probe from the activation box above and the manual link below', () => {
    renderPanel(<div data-testid="host-activation" />);
    const probe = getComputedStyle(boxOf('payments-connection-probe'));
    expect(probe.paddingTop).toBe('16px');
    expect(probe.paddingBottom).toBe('16px');
    expect(getComputedStyle(boxOf('host-activation')).paddingTop).toBe('16px');
  });

  it('takes no gap for a host step that renders nothing', () => {
    const Nothing = () => null;
    renderPanel(<Nothing />);
    const probeBox = boxOf('payments-connection-probe');
    // The verification box is the probe box's previous block, and it is empty.
    const boxes = [...(probeBox.parentElement?.children ?? [])];
    const verificationBox = boxes[boxes.indexOf(probeBox) - 1] as HTMLElement;
    expect(verificationBox.childElementCount).toBe(0);
    expect(getComputedStyle(verificationBox).display).toBe('none');
  });
});
