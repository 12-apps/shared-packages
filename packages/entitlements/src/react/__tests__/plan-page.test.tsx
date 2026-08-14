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

/**
 * Every number and every word on a card arrives PRE-FORMATTED from the server
 * half, in the host's own currency and interval — the package prints what it
 * is handed. The fixtures are in a currency and a domain this package has no
 * relationship with, so a formatter smuggled back into it would show.
 */
const NETWORK_CARD: ComparisonTier = {
  key: 'network',
  name: 'Network',
  priceCents: 9900,
  price: '99.00 cr',
  priceNote: '/ciclo',
  pitch: 'Para redes com várias estações',
  headline: 'ilimitado',
  headlineUnit: 'estações',
  current: false,
  upgrade: true,
  recommended: true,
  sections: [
    { title: 'Telemetria', lines: [{ label: 'Estações', included: true, detail: 'ilimitado' }] },
  ],
};

const HOBBY_CARD: ComparisonTier = {
  ...NETWORK_CARD,
  key: 'hobby',
  name: 'Hobby',
  priceCents: 0,
  price: '0.00 cr',
  priceNote: null,
  current: true,
  upgrade: false,
  recommended: false,
};

function payload(): TenantPlanPayload {
  return {
    planKey: 'hobby',
    name: 'Hobby',
    priceCents: 0,
    price: '0.00 cr',
    comparison: [HOBBY_CARD, NETWORK_CARD],
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
        feature: 'alerts.digest',
        description: 'Resumo de alertas',
        enabled: false,
        note: 'Desligado por você nas configurações',
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
      feature === 'alerts.digest' ? { path: '/acme/alertas', label: 'Ajustes › Alertas' } : null,
    ...over,
  });
  return { host, ...render(<Page />) };
}

describe('the plan screen', () => {
  it("names the plan, marks the tenant's card and prices from the payload", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    expect(screen.getByTestId('plan-name').textContent).toBe('Hobby');
    expect(screen.getByTestId('tier-cards')).toBeDefined();
    expect(screen.getByTestId('tier-badge-hobby').textContent).toBe('SEU PLANO');
    expect(screen.getByTestId('tier-price-network').textContent).toBe('99.00 cr');
  });

  it('prints the host interval beside the price, and none where it sent none', async () => {
    // The card used to append a hardcoded "/mês" whenever the price was not
    // zero — an interval this package cannot know and a free-tier rule it has
    // no business making.
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    expect(screen.getByTestId('tier-price-note-network').textContent).toContain('/ciclo');
    await waitFor(() => expect(screen.queryByTestId('tier-price-note-hobby')).toBeNull());
    expect(screen.getByTestId('tier-cards').textContent).not.toContain('/mês');
  });

  it('offers the upgrade only where it is the remedy, with the COMMERCIAL name', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    expect(screen.getByTestId('plan-upsell-forecast.history').textContent).toContain('Network');
    // The tenant's own switch gets the way back to it, never a sale.
    await waitFor(() => expect(screen.queryByTestId('plan-upsell-alerts.digest')).toBeNull());
    const link = screen.getByTestId('plan-switch-alerts.digest');
    expect(link.textContent).toContain('Ajustes › Alertas');
    expect(link.querySelector('a')?.getAttribute('href')).toBe('/acme/alertas');
  });

  it('asks for a tier from its card and lands on the request banner', async () => {
    const { host } = renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    fireEvent.click(screen.getByTestId('tier-cta-network'));
    await waitFor(() => expect(screen.getByTestId('plan-request-open')).toBeDefined());
    expect(host.state.posts).toEqual([{ requestedPlan: 'network' }]);
    expect(screen.getByTestId('plan-request-open').textContent).toContain('network');
    // The button is gone: one conversation per tenant, not one per press.
    await waitFor(() => expect(screen.queryByTestId('tier-cta-network')).toBeNull());
  });

  it('shows an already-open request instead of the button', async () => {
    renderPage(
      {},
      fakeHost({ id: 'r9', requestedPlanKey: 'network', createdAt: 'earlier' }),
    );
    await waitFor(() => expect(screen.getByTestId('plan-request-open')).toBeDefined());
    await waitFor(() => expect(screen.queryByTestId('tier-cta-network')).toBeNull());
  });

  it('renders no ask buttons for a caller the write would refuse', async () => {
    renderPage({ canRequestPlanChange: false });
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    await waitFor(() => expect(screen.queryByTestId('tier-cta-network')).toBeNull());
    // The tenant's own card still shows its disabled "Plano atual" marker.
    expect(screen.getByTestId('tier-cta-hobby')).toBeDefined();
  });

  it('refuses to build without the two answers only the host has', () => {
    // Both used to be silently defaulted: an empty `apiBase` sends every read
    // to the app's own origin (a 404 rendered as "could not load your plan"),
    // and an omitted `canRequestPlanChange` rendered a plan screen with no way
    // to ask for a plan on it.
    expect(() => createWebEntitlements({ apiBase: '', canRequestPlanChange: true })).toThrow(
      /`apiBase` is empty/,
    );
    expect(() =>
      createWebEntitlements({
        apiBase: '/api',
      } as unknown as WebEntitlementsConfig),
    ).toThrow(/`canRequestPlanChange` is required/);
  });
});
