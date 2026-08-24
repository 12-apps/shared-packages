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
import { PT_BR_ENTITLEMENTS_WEB_COPY } from '../pt-BR';
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
    {
      title: 'Telemetria',
      lines: [
        { label: 'Estações', included: true, detail: 'ilimitado' },
        { label: 'Alertas por naipe', included: true, detail: null },
      ],
    },
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
  sections: [
    {
      title: 'Telemetria',
      lines: [
        { label: 'Estações', included: true, detail: 'até 3' },
        { label: 'Alertas por naipe', included: false, detail: null },
      ],
    },
  ],
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
      // An ON row, so the status list has something to fold away.
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
    copy: PT_BR_ENTITLEMENTS_WEB_COPY,
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
    // The sentence lives on the GROUP now — said once for every row that tier
    // would lift, rather than once per row. The claim is unchanged: a
    // customer reads the commercial name, never the key.
    const upsell = screen.getByTestId('plan-upsell-plan-network');
    expect(upsell.textContent).toContain('Network');
    expect(screen.getByTestId('plan-blocked-network').textContent).toContain(
      'Histórico de previsões',
    );

    // The tenant's own switch is in the UNGROUPED bucket and gets the way back
    // to it, never a sale — no plan heading may claim that row.
    const other = screen.getByTestId('plan-blocked-other');
    expect(other.textContent).toContain('Resumo de alertas');
    expect(other.textContent).not.toContain('Disponível no plano');
    const link = screen.getByTestId('plan-switch-alerts.digest');
    expect(link.textContent).toContain('Ajustes › Alertas');
    expect(link.querySelector('a')?.getAttribute('href')).toBe('/acme/alertas');
  });

  it('keeps the upsell on an OVER-QUOTA row, which is enabled', async () => {
    // The trap: an over-quota row is `enabled: true` — the plan includes the
    // feature and the tenant outgrew the ceiling — and it carries the one
    // upsell that hangs off a working row. Keying the explanation off
    // `enabled` drops it silently, and the row then reads as simply fine.
    const host = fakeHost();
    const overQuota: typeof host.fetchImpl = async (input, init) => {
      if (String(input).endsWith('/plan') && (init?.method ?? 'GET') === 'GET') {
        const base = payload();
        return Response.json({
          data: {
            plan: {
              ...base,
              features: [
                {
                  feature: 'scores.library',
                  description: 'Partituras arquivadas',
                  enabled: true,
                  note: 'Você usou 30 de 25. O plano Network amplia o limite.',
                  reason: 'enabled' as const,
                  limit: 25,
                  used: 30,
                  requiredPlan: 'network',
                  requiredPlanLabel: 'Network',
                },
              ],
            },
          },
        });
      }
      return host.fetchImpl(input, init);
    };
    renderPage({}, { state: host.state, fetchImpl: overQuota });
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());

    const row = screen.getByTestId('plan-feature-scores.library');
    expect(row.textContent).toContain('Você usou 30 de 25');
    expect(row.textContent).toContain('Network');
    // It is not a denial, so it is not under a plan group and the chip is on.
    await waitFor(() => expect(screen.queryByTestId('plan-blocked-network')).toBeNull());
    expect(screen.getByTestId('plan-status-scores.library').textContent).toBe('Ativo');
  });

  it('says the upgrade sentence ONCE for a tier, however many rows it lifts', async () => {
    // The wall this grouping removes: a store on a low tier read "Disponível
    // no plano X." once per row, twenty-one rows deep on a real fixture.
    const host = fakeHost();
    const manyDenials: typeof host.fetchImpl = async (input, init) => {
      if (String(input).endsWith('/plan') && (init?.method ?? 'GET') === 'GET') {
        const base = payload();
        const denied = base.features[0];
        if (denied === undefined) throw new Error('fixture lost its denial');
        return Response.json({
          data: {
            plan: {
              ...base,
              features: [
                denied,
                { ...denied, feature: 'forecast.export', description: 'Exportar previsões' },
                { ...denied, feature: 'forecast.share', description: 'Compartilhar previsões' },
              ],
            },
          },
        });
      }
      return host.fetchImpl(input, init);
    };
    renderPage({}, { state: host.state, fetchImpl: manyDenials });
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());

    const group = screen.getByTestId('plan-blocked-network');
    expect(group.querySelectorAll('[data-testid^="plan-feature-"]')).toHaveLength(3);
    // Three rows, ONE sentence…
    expect(screen.getAllByTestId('plan-upsell-plan-network')).toHaveLength(1);
    // …and the NOTE folds into it too. Under this heading every row is "not
    // included in your plan" by construction, so printing it per row is the
    // heading said three more times.
    expect(group.textContent).not.toContain('Não incluído no seu plano');
  });

  it('separates the note from the upsell, and marks the row with a chip', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    // Two SENTENCES from two sources. Run together they read as one broken
    // one, and the note's own language decides whether it ends in punctuation.
    // A grouped denial is ONE line: its label and its chip. Everything it
    // would otherwise say is on the heading above it.
    const row = screen.getByTestId('plan-feature-forecast.history');
    expect(row.textContent).not.toContain('Não incluído no seu plano');
    expect(row.textContent).not.toContain('Disponível no plano');
    // The marker is a chip rather than MUI's notification-DOT Badge, whose
    // children render as unstyled text — the one thing distinguishing an
    // available row from a withheld one has to be visible.
    expect(screen.getByTestId('plan-status-forecast.history').textContent).toBe('Indisponível');
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

  it('gives each card its DELTA, not the whole catalog', async () => {
    // The defect this replaced: every card printed every line of every
    // section, so four of them repeated the same labels four times and pushed
    // the price and the button below the fold.
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    const upgrade = screen.getByTestId('tier-highlights-network');
    // What Network ADDS over Hobby, headed by Hobby's commercial name.
    expect(upgrade.textContent).toContain('Hobby');
    expect(upgrade.textContent).toContain('Alertas por naipe');
    // …and the row Hobby already had, because its ceiling moved.
    expect(upgrade.textContent).toContain('ilimitado');
    // The entry card has nothing to inherit from, so it says so differently.
    expect(screen.getByTestId('tier-highlights-hobby').textContent).not.toContain('Hobby,');
  });

  it('keeps the full matrix behind one press, with each label stated once', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    await waitFor(() => expect(screen.queryByTestId('plan-comparison-table')).toBeNull());

    fireEvent.click(screen.getByTestId('plan-compare-toggle'));
    const table = screen.getByTestId('plan-comparison-table');
    expect(table.textContent).toContain('Estações');
    // Two tiers, one row: the cards would have said it twice.
    expect(table.querySelectorAll('tbody tr th[scope="row"]')).toHaveLength(2);
  });

  it('opens the status list on what is BLOCKED, and folds the rest behind a press', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('plan-page')).toBeDefined());
    // The two denials are the half a tenant can act on.
    expect(screen.getByTestId('plan-feature-forecast.history')).toBeDefined();
    expect(screen.getByTestId('plan-feature-alerts.digest')).toBeDefined();
    await waitFor(() => expect(screen.queryByTestId('plan-feature-stations.live')).toBeNull());

    fireEvent.click(screen.getByTestId('plan-status-toggle'));
    expect(screen.getByTestId('plan-feature-stations.live')).toBeDefined();

    fireEvent.click(screen.getByTestId('plan-status-toggle'));
    await waitFor(() => expect(screen.queryByTestId('plan-feature-stations.live')).toBeNull());
  });

  it('says so plainly when the plan withholds nothing', async () => {
    const host = fakeHost();
    const everythingOn: typeof host.fetchImpl = async (input, init) => {
      if (String(input).endsWith('/plan') && (init?.method ?? 'GET') === 'GET') {
        const base = payload();
        return Response.json({
          data: {
            plan: {
              ...base,
              // Enabled AND inside its ceiling: `requiredPlan` has to clear
              // too, because an enabled row that still names a tier is an
              // OVER-QUOTA row, which very much has something to say.
              features: base.features.map((feature) => ({
                ...feature,
                enabled: true,
                requiredPlan: null,
                requiredPlanLabel: null,
              })),
            },
          },
        });
      }
      return host.fetchImpl(input, init);
    };
    renderPage({}, { state: host.state, fetchImpl: everythingOn });
    await waitFor(() => expect(screen.getByTestId('plan-status-none-blocked')).toBeDefined());
    // Still one press to the whole inventory — a store that wants it should
    // not have to hunt for it either.
    expect(screen.getByTestId('plan-status-toggle')).toBeDefined();
  });

  it('refuses to build without the two answers only the host has', () => {
    // Both used to be silently defaulted: an empty `apiBase` sends every read
    // to the app's own origin (a 404 rendered as "could not load your plan"),
    // and an omitted `canRequestPlanChange` rendered a plan screen with no way
    // to ask for a plan on it.
    expect(() =>
      createWebEntitlements({
        apiBase: '',
        canRequestPlanChange: true,
        copy: PT_BR_ENTITLEMENTS_WEB_COPY,
      }),
    ).toThrow(/`apiBase` is empty/);
    expect(() =>
      createWebEntitlements({
        apiBase: '/api',
      } as unknown as WebEntitlementsConfig),
    ).toThrow(/`canRequestPlanChange` is required/);
    // The third required answer: the surface's copy, which used to be a
    // compiled-in default in one product's language.
    expect(() =>
      createWebEntitlements({
        apiBase: '/api',
        canRequestPlanChange: true,
      } as unknown as WebEntitlementsConfig),
    ).toThrow(/`copy` is required/);
  });
});
