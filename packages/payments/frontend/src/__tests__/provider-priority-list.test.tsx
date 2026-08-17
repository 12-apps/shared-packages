// @vitest-environment jsdom
// fireEvent/render from @testing-library/react (act()-wrapped) — same choice
// and reasoning as the context tests: user-event is not a dependency here.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, MerchantSettingsView } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { ProviderPriorityList, chainOf } from '../components/ProviderPriorityList';

/**
 * The failover-chain editor. What matters here is not the drag mechanics but
 * that the order the merchant sees is the order checkout will use, and that a
 * failed save never leaves the screen claiming an order the server rejected.
 */

function config(provider: string, enabled: boolean, priority: number): MaskedProviderConfig {
  return {
    provider,
    enabled,
    // Proven rows carry usable keys by definition — same reasoning as
    // chargeVerifiedAt below.
    credentialed: true,
    priority,
    environment: 'SANDBOX',
    status: 'VERIFIED',
    lastVerifiedAt: null,
    // Every row in the chain editor is by definition already proven — only a
    // successful charge can put a provider in the chain at all.
    chargeVerifiedAt: '2026-07-30T12:00:00.000Z',
    expiresAt: null,
    stub: false,
    environments: { SANDBOX: {}, PRODUCTION: {} },
    connectedAccount: null,
  };
}

function viewOf(configs: MaskedProviderConfig[]): MerchantSettingsView {
  const chain = configs.filter((c) => c.enabled).map((c) => c.provider);
  return {
    providers: [
      { name: 'stone', displayName: 'Stone', urlSlug: 'stone', authMode: 'credentials', capabilities: CAPS, credentialSchema: [] },
      { name: 'stripe', displayName: 'Stripe', urlSlug: 'stripe', authMode: 'oauth', capabilities: CAPS, credentialSchema: [] },
    ],
    configs,
    providerChain: chain,
    activeProvider: chain[0] ?? null,
    failoverPolicy: 'TECHNICAL',
  };
}

const CAPS = {
  methods: ['PIX'] as const,
  savedCards: false,
  refunds: false,
  partialRefunds: false,
  splits: false,
  webhooks: true,
  tokenization: 'NONE' as const,
};

function fakeClient(overrides: Partial<PaymentsSettingsClient> = {}): PaymentsSettingsClient {
  return {
    getSettings: vi.fn(),
    saveCredentials: vi.fn(),
    setEnabled: vi.fn(),
    setPriorities: vi.fn(),
    setFailoverPolicy: vi.fn(),
    verify: vi.fn(),
    getSetupGuide: vi.fn(),
    beginOAuth: vi.fn(),
    disconnectOAuth: vi.fn(),
    ...overrides,
  } as PaymentsSettingsClient;
}

/** The rendered chain order, read off the list rows. */
function rowOrder(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="payments-priority-item-"]')).map(
    (el) => el.getAttribute('data-testid')!.replace('payments-priority-item-', ''),
  );
}

describe('chainOf', () => {
  it('derives the chain from configs, ordered by rank', () => {
    const view = viewOf([config('stripe', true, 1), config('stone', true, 0)]);
    expect(chainOf(view)).toEqual(['stone', 'stripe']);
  });

  it('ignores providers that are configured but out of rotation', () => {
    const view = viewOf([config('stone', true, 0), config('stripe', false, 0)]);
    expect(chainOf(view)).toEqual(['stone']);
  });
});

describe('ProviderPriorityList', () => {
  it('names the provider checkout will try first', () => {
    render(
      <ProviderPriorityList
        view={viewOf([config('stone', true, 0), config('stripe', true, 1)])}
        client={fakeClient()}
      />,
    );
    // The intro names it in prose AND the row is first in the list; assert on
    // the list, which is the thing that actually encodes routing order.
    expect(screen.getByTestId('payments-priority-first')).toBeTruthy();
    expect(rowOrder()).toEqual(['stone', 'stripe']);
  });

  it('warns when nothing is in rotation, because checkout cannot charge', () => {
    render(<ProviderPriorityList view={viewOf([config('stone', false, 0)])} client={fakeClient()} />);
    expect(screen.getByTestId('payments-priority-empty')).toBeTruthy();
  });

  it('saves the WHOLE reordered chain, not a per-provider delta', async () => {
    const reordered = viewOf([config('stripe', true, 0), config('stone', true, 1)]);
    const setPriorities = vi.fn().mockResolvedValue(reordered);
    render(
      <ProviderPriorityList
        view={viewOf([config('stone', true, 0), config('stripe', true, 1)])}
        client={fakeClient({ setPriorities })}
      />,
    );

    fireEvent.click(screen.getByLabelText('Mover Stone para baixo'));

    await waitFor(() => {
      expect(setPriorities).toHaveBeenCalledWith(['stripe', 'stone']);
    });
  });

  it('rolls the list back when the save fails, and says why', async () => {
    const setPriorities = vi.fn().mockRejectedValue(new Error('conflito de ordem'));
    render(
      <ProviderPriorityList
        view={viewOf([config('stone', true, 0), config('stripe', true, 1)])}
        client={fakeClient({ setPriorities })}
      />,
    );

    fireEvent.click(screen.getByLabelText('Mover Stone para baixo'));

    await waitFor(() => {
      expect(screen.getByTestId('payments-priority-error').textContent).toContain(
        'conflito de ordem',
      );
    });
    // The screen must not keep showing an order the server refused.
    expect(rowOrder()).toEqual(['stone', 'stripe']);
  });

  it('cannot move the first provider up or the last one down', () => {
    render(
      <ProviderPriorityList
        view={viewOf([config('stone', true, 0), config('stripe', true, 1)])}
        client={fakeClient()}
      />,
    );
    expect(screen.getByLabelText('Mover Stone para cima').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Mover Stripe para baixo').hasAttribute('disabled')).toBe(true);
  });
});
