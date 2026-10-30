// @vitest-environment jsdom
import { cleanup, render, screen } from './settings-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { OAuthPanel } from '../components/OAuthPanel';
import { SetupGuideSection } from '../components/SetupGuideSection';

/**
 * Empty blocks take no room (FUT-4144 UI review).
 *
 * Under "Prefiro conectar por autorização" on the manual path sat ~50px of
 * nothing: the connection probe's box, padded top and bottom, around a probe
 * that renders nothing until there is a connection to test. And a provider
 * shipping no walkthrough still drew an empty walkthrough box, which the
 * form's stack spaced like a block.
 */

const descriptor = {
  name: 'pagbank',
  displayName: 'PagBank',
  authMode: 'oauth',
  credentialSchema: [{ key: 'token', label: 'Token', secret: true }],
} as unknown as ProviderDescriptor;

const unconnected = {
  provider: 'pagbank',
  status: 'UNVERIFIED',
  enabled: false,
  environment: 'SANDBOX',
  environments: { SANDBOX: {}, PRODUCTION: {} },
} as unknown as MaskedProviderConfig;

afterEach(cleanup);

describe('the OAuth card before any connection', () => {
  it('draws no box for a probe that has nothing to test', () => {
    const { container } = render(
      <OAuthPanel
        descriptor={descriptor}
        config={unconnected}
        client={{} as PaymentsSettingsClient}
        reload={vi.fn()}
        prepareConnect={vi.fn()}
        verification={null}
        statusBar={null}
        walkthrough={() => null}
        form={null}
      />,
    );
    // The card's body: the header slot is the test's own `statusBar={null}`.
    const body = container.querySelector('.MuiPaper-root')?.lastElementChild as Element;
    const shown = [...body.querySelectorAll('div')].filter(
      (box) => box.childElementCount === 0 && box.textContent === '' && getComputedStyle(box).display !== 'none',
    );
    const padded = shown.filter((box) => (Number.parseFloat(getComputedStyle(box).paddingTop) || 0) > 0);
    expect(padded).toEqual([]);
  });
});

describe('a provider with no walkthrough', () => {
  it('draws nothing when it has nothing to place', () => {
    const { container } = render(
      <SetupGuideSection guide={null} confirmed={false} onConfirm={() => undefined} onReopen={() => undefined} rows={null} sectionFooter={null} />,
    );
    expect(container.childElementCount).toBe(0);
  });

  it('still draws the form when it has one', () => {
    render(
      <SetupGuideSection
        guide={null}
        confirmed={false}
        onConfirm={() => undefined}
        onReopen={() => undefined}
        rows={null}
        sectionFooter={<div data-testid="form" />}
      />,
    );
    expect(screen.getByTestId('payments-setup-unguided').contains(screen.getByTestId('form'))).toBe(true);
  });
});
