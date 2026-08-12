// @vitest-environment jsdom
/**
 * The plan screen, driven through the factory the way a host mounts it — the
 * transport is the config's own `fetchImpl`, so what these tests exercise is
 * the page's real read/write paths against the wire shapes the server half
 * produces.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ComparisonTier, OpenPlanRequest, TenantPlanPayload } from '../../plan-wire';
import { createWebEntitlements } from '../create-web-entitlements';
import type { WebEntitlementsConfig } from '../web-config';

const PRO_CARD: ComparisonTier = {
  key: 'pro',
  name: 'Pro',
  priceCents: 9900,
  price: 'R$ 99,00',
  pitch: 'Para lojas com salão',
  headline: 'ilimitado',
  headlineUnit: 'produtos',
  current: false,
  upgrade: true,
  recommended: true,
  sections: [{ title: 'Catálogo', lines: [{ label: 'Produtos', included: true, detail: 'ilimitado' }] }],
};

const FREE_CARD: ComparisonTier = {
  ...PRO_CARD,
  key: 'free',
  name: 'Gratuito',
  priceCents: 0,
  price: 'Grátis',
  current: true,
  upgrade: false,
  recommended: false,
};

function payload(): TenantPlanPayload {
  return {
    planKey: 'free',
    name: 'Gratuito',
    priceCents: 0,
    price: 'Grátis',
    comparison: [FREE_CARD, PRO_CARD],
    features: [
      {
        feature: 'branding.white_label',
        description: 'Marca própria',
        enabled: false,
        note: 'Não incluído no seu plano',
        reason: 'not-entitled',
        limit: null,
        used: null,
        requiredPlan: 'pro',
        requiredPlanLabel: 'Pro',
      },
      {
        feature: 'storefront.tables',
        description: 'Mesas',
        enabled: false,
        note: 'Desligado por você nas configurações da loja',
        reason: 'disabled-by-tenant',
        limit: null,
        used: null,
        requiredPlan: null,
        requiredPlanLabel: null,
      },
    ],
  };
}

/**
 * A wire-faithful fake host: GET/POST the same paths, every SUCCESS body in
 * the `{ data: … }` envelope the real routes produce (errors bare, like the
 * real denial wire), and the POST answering `{ id, status }` only.
 */
function fakeHost(initialOpen: OpenPlanRequest | null = null) {
  const state = { open: initialOpen, posts: [] as unknown[] };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/plan') && method === 'GET') {
      return Response.json({ data: { plan: payload() } });
    }
    if (url.endsWith('/plan/request') && method === 'GET') {
      return Response.json({ data: { request: state.open } });
    }
    if (url.endsWith('/plan/request') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { requestedPlan: string };
      state.posts.push(body);
      state.open = { id: 'r1', requestedPlanKey: body.requestedPlan, createdAt: 'now' };
      return Response.json({ data: { request: { id: 'r1', status: 'open' }, created: true } });
    }
    return Response.json({ error: 'rota desconhecida' }, { status: 404 });
  };
  return { state, fetchImpl };
}

function renderPage(over: Partial<WebEntitlementsConfig> = {}, host = fakeHost()) {
  const { page: Page } = createWebEntitlements({
    apiBase: '/api/admin/acme',
    fetchImpl: host.fetchImpl,
    canRequestPlanChange: true,
    switchLocation: (feature) =>
      feature === 'storefront.tables' ? { path: '/acme/tables', label: 'Configuração › Mesas' } : null,
    ...over,
  });
  return { host, ...render(<Page />) };
}

describe('the plan screen', () => {
  it('names the plan, marks the store card and prices from the payload', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    expect(screen.getByTestId('plan-name').textContent).toBe('Gratuito');
    expect(screen.getByTestId('tier-cards')).toBeDefined();
    expect(screen.getByTestId('tier-badge-free').textContent).toBe('SEU PLANO');
    expect(screen.getByTestId('tier-price-pro').textContent).toBe('R$ 99,00');
  });

  it('offers the upgrade only where it is the remedy, with the COMMERCIAL name', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    expect(screen.getByTestId('plan-upsell-branding.white_label').textContent).toContain('Pro');
    // The tenant's own switch gets the way back to it, never a sale.
    await waitFor(() => expect(screen.queryByTestId('plan-upsell-storefront.tables')).toBeNull());
    const link = screen.getByTestId('plan-switch-storefront.tables');
    expect(link.textContent).toContain('Configuração › Mesas');
    expect(link.querySelector('a')?.getAttribute('href')).toBe('/acme/tables');
  });

  it('asks for a tier from its card and lands on the request banner', async () => {
    const { host } = renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    fireEvent.click(screen.getByTestId('tier-cta-pro'));
    await waitFor(() => expect(screen.getByTestId('plan-request-open')).toBeDefined());
    expect(host.state.posts).toEqual([{ requestedPlan: 'pro' }]);
    expect(screen.getByTestId('plan-request-open').textContent).toContain('pro');
    // The button is gone: one conversation per store, not one per press.
    await waitFor(() => expect(screen.queryByTestId('tier-cta-pro')).toBeNull());
  });

  it('shows an already-open request instead of the button', async () => {
    renderPage(
      {},
      fakeHost({ id: 'r9', requestedPlanKey: 'pro', createdAt: 'earlier' }),
    );
    await waitFor(() => expect(screen.getByTestId('plan-request-open')).toBeDefined());
    await waitFor(() => expect(screen.queryByTestId('tier-cta-pro')).toBeNull());
  });

  it('renders no ask buttons for a caller the write would refuse', async () => {
    renderPage({ canRequestPlanChange: false });
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    await waitFor(() => expect(screen.queryByTestId('tier-cta-pro')).toBeNull());
    // The store's own card still shows its disabled "Plano atual" marker.
    expect(screen.getByTestId('tier-cta-free')).toBeDefined();
  });
});
