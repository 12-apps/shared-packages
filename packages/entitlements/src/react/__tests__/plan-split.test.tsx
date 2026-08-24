// @vitest-environment jsdom
/**
 * The plan surface as THREE routes rather than one screen.
 *
 * The split's whole claim is that each route answers one question, so what is
 * worth pinning is the ABSENCE on each: the catalog carries no audit, the
 * audit carries no catalog, and the summary carries neither — it carries the
 * way to both. A split that leaked either way would be the long screen again
 * with extra navigation.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TenantPlanPayload } from '../../plan-wire';
import { createWebEntitlements } from '../create-web-entitlements';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import type { WebEntitlementsConfig } from '../web-config';

const CARD = {
  key: 'shorts',
  name: 'Shorts',
  priceCents: 0,
  price: '0,00 cr',
  priceNote: null,
  pitch: 'Para começar',
  headline: 'ilimitado',
  headlineUnit: 'estações',
  current: true,
  upgrade: false,
  recommended: false,
  sections: [
    { title: 'Telemetria', lines: [{ label: 'Estações', included: true, detail: 'até 3' }] },
  ],
};

function payload(): TenantPlanPayload {
  return {
    planKey: 'shorts',
    name: 'Shorts',
    priceCents: 0,
    price: '0,00 cr',
    comparison: [
      CARD,
      {
        ...CARD,
        key: 'network',
        name: 'Network',
        current: false,
        upgrade: true,
        sections: [
          {
            title: 'Telemetria',
            lines: [{ label: 'Estações', included: true, detail: 'ilimitado' }],
          },
        ],
      },
    ],
    features: [
      {
        feature: 'forecast.history',
        description: 'Histórico de previsões',
        enabled: false,
        note: 'Não incluído no seu plano',
        reason: 'not-entitled',
        limit: null,
        used: null,
        requiredPlan: 'network',
        requiredPlanLabel: 'Network',
      },
      {
        feature: 'stations.live',
        description: 'Estações ao vivo',
        enabled: true,
        note: 'Incluído no seu plano',
        reason: 'enabled',
        limit: 3,
        used: 1,
        requiredPlan: null,
        requiredPlanLabel: null,
      },
    ],
  };
}

function build(over: Partial<WebEntitlementsConfig> = {}) {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).endsWith('/plan')) return Response.json({ data: { plan: payload() } });
    return Response.json({ data: { request: null } });
  };
  return createWebEntitlements({
    apiBase: '/api/admin/acme',
    fetchImpl,
    canRequestPlanChange: true,
    copy: PT_BR_ENTITLEMENTS_WEB_COPY,
    plansPath: '/acme/planos',
    featuresPath: '/acme/planos/recursos',
    ...over,
  });
}

describe('the catalog route', () => {
  it('carries the cards and the matrix, and no audit', async () => {
    const { plansPage: Plans } = build();
    render(<Plans />);
    await waitFor(() => expect(screen.getByTestId('plans-page')).toBeDefined());

    expect(screen.getByTestId('tier-cards')).toBeDefined();
    expect(screen.getByTestId('plan-compare-toggle')).toBeDefined();
    // The ask flow belongs to the catalog — it is the action a catalog offers.
    expect(screen.getByTestId('tier-cta-network')).toBeDefined();

    // The audit is a different question and a different route.
    await waitFor(() => expect(screen.queryByTestId('plan-feature-forecast.history')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('plan-blocked-network')).toBeNull());
  });
});

describe('the audit route', () => {
  it('carries the status band, and no catalog', async () => {
    const { featuresPage: Features } = build();
    render(<Features />);
    await waitFor(() => expect(screen.getByTestId('plan-features-page')).toBeDefined());

    expect(screen.getByTestId('plan-blocked-network')).toBeDefined();
    expect(screen.getByTestId('plan-feature-forecast.history')).toBeDefined();

    // No cards, no matrix — the reason this is its own route.
    await waitFor(() => expect(screen.queryByTestId('tier-cards')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('plan-compare-toggle')).toBeNull());
  });

  it('does not say its own heading twice', async () => {
    // The page header already names it; the band drawing its own would read
    // as a rendering bug rather than a section.
    const { featuresPage: Features } = build();
    render(<Features />);
    await waitFor(() => expect(screen.getByTestId('plan-features-page')).toBeDefined());
    const heading = PT_BR_ENTITLEMENTS_WEB_COPY.planPage.statusHeading;
    expect(screen.getAllByText(heading)).toHaveLength(1);
  });
});

describe('the account summary', () => {
  it('names the plan and offers both ways in, neither of them a catalog', async () => {
    const { planSummary: Summary } = build();
    render(<Summary />);
    await waitFor(() => expect(screen.getByTestId('plan-summary')).toBeDefined());

    expect(screen.getByTestId('plan-name').textContent).toBe('Shorts');
    expect(screen.getByTestId('plan-summary-plans').querySelector('a')?.getAttribute('href')).toBe(
      '/acme/planos',
    );
    expect(
      screen.getByTestId('plan-summary-features').querySelector('a')?.getAttribute('href'),
    ).toBe('/acme/planos/recursos');

    // Neither band is on an account page — that is the whole point of it.
    await waitFor(() => expect(screen.queryByTestId('tier-cards')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('plan-feature-forecast.history')).toBeNull());
  });

  it('counts the rows the audit would show, so the link is worth a click', async () => {
    // One denial and one over-quota-free row: the count is what makes a
    // forty-row page worth opening, and it is the only part of it that
    // belongs on a page this short.
    const { planSummary: Summary } = build();
    render(<Summary />);
    await waitFor(() => expect(screen.getByTestId('plan-summary')).toBeDefined());
    expect(screen.getByTestId('plan-summary-features').textContent).toContain('1');
  });

  it('renders no link a host has not routed', async () => {
    // A dead link is worse than none: the host that mounts no audit route
    // gets no audit link.
    const { planSummary: Summary } = build({ plansPath: undefined, featuresPath: undefined });
    render(<Summary />);
    await waitFor(() => expect(screen.getByTestId('plan-summary')).toBeDefined());
    await waitFor(() => expect(screen.queryByTestId('plan-summary-plans')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('plan-summary-features')).toBeNull());
  });
});

describe('the one-screen page', () => {
  it('still carries all three, for a host that routes it that way', async () => {
    const { page: Page } = build();
    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    expect(screen.getByTestId('tier-cards')).toBeDefined();
    expect(screen.getByTestId('plan-compare-toggle')).toBeDefined();
    expect(screen.getByTestId('plan-feature-forecast.history')).toBeDefined();
  });
});
