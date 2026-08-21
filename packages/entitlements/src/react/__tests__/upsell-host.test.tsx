// @vitest-environment jsdom
/**
 * The upgrade prompt — every trigger lands here, and the copy branches on WHY
 * the surface is locked, because only a plan gap (or a spent quota) is a
 * sale. The raw plan key must never face a customer, not even while the
 * commercial name loads.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TenantPlanPayload } from '../../plan-wire';
import { createWebEntitlements } from '../create-web-entitlements';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
import { raiseUpsell } from '../upsell-channel';
import type { WebEntitlementsConfig } from '../web-config';

function payload(): TenantPlanPayload {
  return {
    planKey: 'hobby',
    name: 'Gratuito',
    priceCents: 0,
    price: '0.00 cr',
    features: [],
    comparison: [
      {
        key: 'network',
        name: 'Network',
        priceCents: 9900,
        price: '99.00 cr',
        priceNote: '/ciclo',
        pitch: '',
        headline: '',
        headlineUnit: '',
        current: false,
        upgrade: true,
        recommended: false,
        sections: [],
      },
    ],
  };
}

function fakeHost() {
  const posts: unknown[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/plan') && method === 'GET') {
      return Response.json({ data: { plan: payload() } });
    }
    if (url.endsWith('/plan/request') && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)));
      return Response.json({
        data: { request: { id: 'r1', status: 'open' }, created: true },
      });
    }
    return Response.json({ error: 'rota desconhecida' }, { status: 404 });
  };
  return { posts, fetchImpl };
}

function mountHost(over: Partial<WebEntitlementsConfig> = {}, host = fakeHost()) {
  const { UpsellHost } = createWebEntitlements({
    apiBase: '/api/admin/acme',
    fetchImpl: host.fetchImpl,
    canRequestPlanChange: true,
    copy: PT_BR_ENTITLEMENTS_WEB_COPY,
    plansPath: '/acme/planos',
    switchLocation: () => ({ path: '/acme/alertas', label: 'Ajustes › Alertas' }),
    ...over,
  });
  render(<UpsellHost />);
  return host;
}

describe('the upsell prompt host', () => {
  it('renders nothing until a prompt is raised', async () => {
    mountHost();
    await waitFor(() => expect(screen.queryByTestId('upsell-modal')).toBeNull());
  });

  it('pitches the COMMERCIAL plan name and files the lead on the CTA', async () => {
    const host = mountHost();
    act(() => {
      raiseUpsell({ feature: 'forecast.history', requiredPlan: 'network', reason: 'not-entitled' });
    });
    expect(screen.getByTestId('upsell-modal')).toBeDefined();
    // Resolved from the comparison — never the raw key.
    await waitFor(() =>
      expect(screen.getByTestId('upsell-plan-name').textContent).toContain('Network'),
    );
    expect(screen.getByTestId('upsell-planos-link').getAttribute('href')).toBe('/acme/planos');

    fireEvent.click(screen.getByTestId('upsell-cta'));
    await waitFor(() => expect(screen.getByTestId('upsell-request-sent')).toBeDefined());
    expect(host.posts).toEqual([{ requestedPlan: 'network', feature: 'forecast.history' }]);
  });

  it('tells a caller without the permission to ask an admin — never a 403 button', async () => {
    mountHost({ canRequestPlanChange: false });
    act(() => {
      raiseUpsell({ feature: 'forecast.history', requiredPlan: 'network', reason: 'not-entitled' });
    });
    await waitFor(() => expect(screen.getByTestId('upsell-ask-admin')).toBeDefined());
    await waitFor(() => expect(screen.queryByTestId('upsell-cta')).toBeNull());
  });

  it('says how much of the quota is spent for a quota-exceeded prompt', () => {
    mountHost();
    act(() => {
      raiseUpsell({
        feature: 'crew.seats',
        requiredPlan: 'network',
        reason: 'quota-exceeded',
        quota: { used: 3, limit: 3 },
      });
    });
    expect(screen.getByTestId('upsell-quota').textContent).toContain('3 de 3');
  });

  it("points the tenant's own switch at its screen and never mentions money", async () => {
    mountHost();
    act(() => {
      raiseUpsell({ feature: 'alerts.digest', requiredPlan: null, reason: 'disabled-by-tenant' });
    });
    const link = await screen.findByTestId('upsell-config-link');
    expect(link.textContent).toContain('Ajustes › Alertas');
    await waitFor(() => expect(screen.queryByTestId('upsell-cta')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('upsell-planos-link')).toBeNull());
  });

  it('offers no plan pitch when no tier would fix it', async () => {
    mountHost();
    act(() => {
      raiseUpsell({ feature: 'forecast.history', requiredPlan: null, reason: 'not-entitled' });
    });
    await screen.findByTestId('upsell-modal');
    await waitFor(() => expect(screen.queryByTestId('upsell-plan-name')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('upsell-cta')).toBeNull());
  });
});
