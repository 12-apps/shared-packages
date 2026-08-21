// @vitest-environment jsdom
/**
 * The page gate. The three pass-through reasons are the load-bearing part:
 * a tenant's own switch and a stale snapshot must render the PAGE — the
 * server gate is the real enforcement — while plan denials lock in-shell and
 * funnel into the upsell channel.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import type { EntitlementDecision, EntitlementSnapshot } from '../../core/types';
import { EntitlementsProvider } from '../context';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import { subscribeToUpsell, type UpsellPrompt } from '../upsell-channel';
import { createWithEntitlement } from '../with-entitlement';

/** The gate bound the way the factory binds it — to the required lock copy. */
const withEntitlement = createWithEntitlement(PT_BR_ENTITLEMENTS_WEB_COPY.pageLock);

function snapshotWith(decision: Partial<EntitlementDecision<string>>): EntitlementSnapshot<string> {
  return {
    tenantId: 't1',
    status: 'active',
    planKey: 'hobby',
    features: {
      'forecast.history': {
        feature: 'forecast.history',
        enabled: false,
        reason: 'not-entitled',
        policy: 'hide',
        limit: null,
        requiredPlan: 'network',
        ...decision,
      },
    },
  };
}

function ThePage(): JSX.Element {
  return <div data-testid="the-page">conteúdo</div>;
}

function renderGated(decision: Partial<EntitlementDecision<string>>, feature = 'forecast.history') {
  const Gated = withEntitlement(feature, ThePage);
  return render(
    <EntitlementsProvider snapshot={snapshotWith(decision)}>
      <Gated />
    </EntitlementsProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withEntitlement', () => {
  it('renders the page when the feature is enabled', () => {
    renderGated({ enabled: true, reason: 'enabled' });
    expect(screen.getByTestId('the-page')).toBeDefined();
  });

  it("renders the page for the tenant's own switch — not a plan problem", async () => {
    renderGated({ enabled: false, reason: 'disabled-by-tenant', requiredPlan: null });
    expect(screen.getByTestId('the-page')).toBeDefined();
    await waitFor(() => expect(screen.queryByTestId('page-locked')).toBeNull());
  });

  it('renders the page for a key the snapshot does not carry — a stale client must never paywall', () => {
    // The wrapped feature is absent from the snapshot entirely.
    renderGated({}, 'brand.new.key');
    expect(screen.getByTestId('the-page')).toBeDefined();
  });

  it('locks a plan denial in-shell and says why', async () => {
    renderGated({ enabled: false, reason: 'not-entitled' });
    await waitFor(() => expect(screen.queryByTestId('the-page')).toBeNull());
    const lock = screen.getByTestId('page-locked');
    expect(lock.getAttribute('data-feature')).toBe('forecast.history');
    expect(screen.getByText(/não incluído no seu plano/i)).toBeDefined();
  });

  it('locks a suspension with settle-up copy, never an upgrade pitch', () => {
    renderGated({ enabled: false, reason: 'suspended', requiredPlan: null });
    expect(screen.getByText(/Assinatura suspensa/)).toBeDefined();
  });

  it('funnels the lock button into the upsell channel with the decision it saw', () => {
    const raised: UpsellPrompt[] = [];
    const unsubscribe = subscribeToUpsell((prompt) => raised.push(prompt));
    try {
      renderGated({ enabled: false, reason: 'not-entitled', requiredPlan: 'network' });
      fireEvent.click(screen.getByTestId('page-locked-upsell'));
      expect(raised).toEqual([{ feature: 'forecast.history', requiredPlan: 'network', reason: 'not-entitled' }]);
    } finally {
      unsubscribe();
    }
  });
});
