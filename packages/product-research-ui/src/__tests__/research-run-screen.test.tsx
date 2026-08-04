// @vitest-environment jsdom
// render/waitFor from @testing-library/react — plain DOM asserts, no jest-dom.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ResearchRunScreen } from '../research-run-screen';
import { channelHarness, settledEvent } from './fake-channel';
import { fakeClient, offer, requestView, runView } from './fake-client';

const completedClient = (overrides: Parameters<typeof runView>[0] = {}) =>
  fakeClient({
    getRequest: () =>
      Promise.resolve(
        requestView({
          latestRun: { id: 'run-1', status: 'COMPLETED', startedAt: null, finishedAt: null },
        }),
      ),
    getRun: () => Promise.resolve(runView(overrides)),
  });

describe('ResearchRunScreen', () => {
  it('renders the hero card with unit price, pack math and the ranked table', async () => {
    render(
      <ResearchRunScreen client={completedClient()} requestId="req-1" />,
    );

    await waitFor(() => expect(screen.queryByTestId('best-offer-card')).not.toBeNull());
    const hero = screen.getByTestId('best-offer-card');
    expect(within(hero).getByTestId('best-offer-unit-price').textContent).toContain('R$ 3,58');
    expect(within(hero).getByTestId('best-offer-total').textContent).toContain('R$ 85,80');
    // Fardo math is spelled out, never implied.
    expect(hero.textContent).toContain('R$ 42,90 ÷ 12 un = R$ 3,58');
    // The CTA is a link-out to the STORE, new tab.
    const open = within(hero).getByTestId('best-offer-open');
    expect(open.getAttribute('href')).toBe('https://store.example/coca');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(screen.getByTestId('offers-table')).toBeDefined();
  });

  it('shows the loud degradation banner when a source failed', async () => {
    const client = completedClient({
      sourceStats: [
        { sourceId: 's1', type: 'MANUAL', name: 'Solar', status: 'OK', offerCount: 1, ms: 3 },
        { sourceId: 's2', type: 'VTEX', name: 'Giga', status: 'FAILED', offerCount: 0, ms: 90 },
      ],
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);

    await waitFor(() => expect(screen.queryByTestId('research-degraded')).not.toBeNull());
    // The failed source is named in its status row too.
    expect(screen.getByTestId('source-status-s2').textContent).toContain('indisponível');
  });

  /** FUT-495: the run screen carries the stored reason all the way to the row. */
  it('shows WHY a source failed, straight from the run it polled', async () => {
    const client = completedClient({
      sourceStats: [
        {
          sourceId: 's2',
          type: 'VTEX',
          name: 'Atacadão',
          status: 'FAILED',
          offerCount: 0,
          ms: 1_300,
          error:
            'Busca no catálogo VTEX falhou: a loja recusou nosso acesso (HTTP 403 — bloqueio ' +
            'de bot ou de IP). Endereço: https://www.atacadao.com.br/api/catalog_system/pub/products/search',
        },
      ],
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);

    await waitFor(() => expect(screen.queryByTestId('source-status-reason-s2')).not.toBeNull());
    expect(screen.getByTestId('source-status-reason-s2').textContent).toContain('HTTP 403');
    expect(screen.getByTestId('source-status-why-s2').textContent).toContain('bloqueio de bot');
  });

  it('teaches next steps on zero offers instead of shrugging', async () => {
    render(
      <ResearchRunScreen
        client={completedClient({ offers: [], sourceStats: [] })}
        requestId="req-1"
      />,
    );
    await waitFor(() => expect(screen.queryByTestId('research-no-offers')).not.toBeNull());
  });

  it('overrides strings through the messages layer', async () => {
    render(
      <ResearchRunScreen
        client={completedClient()}
        requestId="req-1"
        messages={{ bestOfferTitle: 'Best price' }}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId('best-offer-card')).not.toBeNull());
    expect(screen.getByTestId('best-offer-card').textContent).toContain('Best price');
  });

  it('resolves the roster source-by-source from channel events while the run streams (FUT-439)', async () => {
    const sources = [
      { id: 'src-a', type: 'VTEX', name: 'Rápida', enabled: true, status: 'ACTIVE' },
      { id: 'src-b', type: 'VTEX', name: 'Lenta', enabled: true, status: 'ACTIVE' },
    ];
    const client = fakeClient({
      getRequest: () =>
        Promise.resolve(
          requestView({
            latestRun: { id: 'run-1', status: 'RUNNING', startedAt: null, finishedAt: null },
          }),
        ),
      getRun: () =>
        Promise.resolve(runView({ status: 'RUNNING', sourceStats: [], offers: [] })),
      listSources: () => Promise.resolve(sources),
    });
    const channel = channelHarness();

    render(
      <ResearchRunScreen client={client} requestId="req-1" runChannel={channel.useChannel} />,
    );
    await waitFor(() => expect(screen.queryByTestId('source-status-src-a')).not.toBeNull());
    expect(screen.getByTestId('source-status-src-a').textContent).toContain('consultando…');

    act(() => channel.setConnected(true));
    act(() => channel.emit(settledEvent({ sourceId: 'src-a', offerCount: 12 })));

    // The fast source resolved; the slow one is still visibly pending — the
    // per-source streaming this ticket exists for.
    await waitFor(() =>
      expect(screen.getByTestId('source-status-src-a').textContent).toContain('12 oferta(s)'),
    );
    expect(screen.getByTestId('source-status-src-b').textContent).toContain('consultando…');
    expect(screen.getByTestId('research-run-pending')).toBeDefined();
  });

  /**
   * FUT-519: the prices found so far are shown while the run is still
   * streaming — but NOT the hero. The hero owns the only outbound CTA on this
   * screen and ranking is cheapest-first across ALL sources, so a live hero
   * would re-point at a different store under a cursor already moving toward
   * "Comprar na loja". The table can absorb an insertion; the CTA cannot.
   */
  it('shows the offers found so far while the run is RUNNING, without the hero', async () => {
    const run = { status: 'RUNNING' };
    const client = fakeClient({
      getRequest: () =>
        Promise.resolve(
          requestView({
            latestRun: { id: 'run-1', status: run.status, startedAt: null, finishedAt: null },
          }),
        ),
      getRun: () =>
        Promise.resolve(
          runView({
            status: run.status,
            sourceStats: [],
            // Unranked, exactly as the API answers for a run in flight.
            offers: [offer({ id: 'partial-1', rank: null, supplierName: 'Rápida' })],
          }),
        ),
    });
    const channel = channelHarness();

    render(
      <ResearchRunScreen client={client} requestId="req-1" runChannel={channel.useChannel} />,
    );

    await waitFor(() => expect(screen.queryByTestId('research-partial-offers')).not.toBeNull());
    expect(screen.getByTestId('offers-table').textContent).toContain('Rápida');
    // The run is still visibly in flight, and the CTA-owning hero is absent.
    expect(screen.getByTestId('research-run-pending')).toBeDefined();
    await waitFor(() => expect(screen.queryByTestId('best-offer-card')).toBeNull());

    // Completion is what promotes it: connecting forces the re-read, and the
    // screen swaps the partial block for the full outcome.
    run.status = 'COMPLETED';
    act(() => channel.setConnected(true));
    await waitFor(() => expect(screen.queryByTestId('best-offer-card')).not.toBeNull());
    await waitFor(() => expect(screen.queryByTestId('research-partial-offers')).toBeNull());
  });

  it('shows no partial block while a run in flight has found nothing yet', async () => {
    const client = fakeClient({
      getRequest: () =>
        Promise.resolve(
          requestView({
            latestRun: { id: 'run-1', status: 'RUNNING', startedAt: null, finishedAt: null },
          }),
        ),
      getRun: () => Promise.resolve(runView({ status: 'RUNNING', sourceStats: [], offers: [] })),
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);

    await waitFor(() => expect(screen.queryByTestId('research-run-pending')).not.toBeNull());
    // An empty table would teach the buyer nothing the pending line does not.
    await waitFor(() => expect(screen.queryByTestId('research-partial-offers')).toBeNull());
  });

  /**
   * FUT-491: the per-source signal. A source that answered from its default
   * region must not read like a plain OK — on BOTH paths the stat travels:
   * the polled run stats and the FUT-439 streamed ones.
   */
  it('reads "outra região" on the POLLED stat of a source that fell back', async () => {
    const client = completedClient({
      sourceStats: [
        {
          sourceId: 's1',
          type: 'VTEX',
          name: 'Apoio',
          status: 'OK',
          offerCount: 4,
          ms: 42,
          outsideDeliveryArea: true,
        },
      ],
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);

    await waitFor(() => expect(screen.queryByTestId('source-status-s1')).not.toBeNull());
    const row = screen.getByTestId('source-status-s1');
    expect(row.textContent).toContain('4 oferta(s) · outra região');
    // A fallback is not a failure — the run is not flagged as degraded.
    await waitFor(() => expect(screen.queryByTestId('research-degraded')).toBeNull());
  });

  it('reads "outra região" on the STREAMED stat too (FUT-439 path)', async () => {
    const sources = [{ id: 'src-a', type: 'VTEX', name: 'Apoio', enabled: true, status: 'ACTIVE' }];
    const client = fakeClient({
      getRequest: () =>
        Promise.resolve(
          requestView({
            latestRun: { id: 'run-1', status: 'RUNNING', startedAt: null, finishedAt: null },
          }),
        ),
      getRun: () => Promise.resolve(runView({ status: 'RUNNING', sourceStats: [], offers: [] })),
      listSources: () => Promise.resolve(sources),
    });
    const channel = channelHarness();

    render(
      <ResearchRunScreen client={client} requestId="req-1" runChannel={channel.useChannel} />,
    );
    await waitFor(() => expect(screen.queryByTestId('source-status-src-a')).not.toBeNull());

    act(() => channel.setConnected(true));
    act(() =>
      channel.emit(
        settledEvent({ sourceId: 'src-a', offerCount: 4, outsideDeliveryArea: true }),
      ),
    );

    await waitFor(() =>
      expect(screen.getByTestId('source-status-src-a').textContent).toContain(
        '4 oferta(s) · outra região',
      ),
    );
  });

  it('keeps a plain OK plain', async () => {
    const client = completedClient({
      sourceStats: [
        { sourceId: 's1', type: 'VTEX', name: 'Giga', status: 'OK', offerCount: 4, ms: 42 },
      ],
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);

    await waitFor(() => expect(screen.queryByTestId('source-status-s1')).not.toBeNull());
    const row = screen.getByTestId('source-status-s1');
    expect(row.textContent).toContain('4 oferta(s)');
    expect(row.textContent).not.toContain('outra região');
  });

  it('surfaces a failed run with its error', async () => {
    const client = fakeClient({
      getRequest: () =>
        Promise.resolve(
          requestView({
            latestRun: { id: 'run-1', status: 'FAILED', startedAt: null, finishedAt: null },
          }),
        ),
      getRun: () =>
        Promise.resolve(runView({ status: 'FAILED', error: 'orquestração caiu', offers: [] })),
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);
    await waitFor(() => expect(screen.queryByTestId('research-run-failed')).not.toBeNull());
    expect(screen.getByTestId('research-run-failed').textContent).toContain('orquestração caiu');
  });
});

/**
 * FUT-518 through the SCREEN, mirroring the suspect-unit-price coverage: the
 * caveat has to survive the run view → hero card wiring, not just the component
 * in isolation. The recommended offer is where an understated total does the
 * most damage — it is the one the buyer acts on.
 */
describe('ResearchRunScreen — unknown shipping caveat (FUT-518)', () => {
  it('carries the caveat onto the hero total when the best offer states no freight', async () => {
    const client = completedClient({
      offers: [
        offer({ id: 'serp', rank: 1, supplierName: 'Mercado Preço Bom', shippingCents: null }),
        offer({ id: 'solar', rank: 2, supplierName: 'Solar', unitPriceCents: 399 }),
      ],
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);

    await waitFor(() => expect(screen.queryByTestId('best-offer-shipping-unknown')).not.toBeNull());
    const hero = screen.getByTestId('best-offer-card');
    expect(within(hero).getByTestId('best-offer-shipping-unknown').textContent).toContain(
      'Frete não informado',
    );
    // The offer still leads: flagged, never demoted.
    expect(within(hero).getByTestId('best-offer-total').textContent).toContain('R$ 85,80');
  });
});

describe('OffersTable ordering', () => {
  it('keeps the server rank order — cheapest unit first', async () => {
    const client = completedClient({
      offers: [
        offer({ id: 'a', rank: 1, unitPriceCents: 358, supplierName: 'Solar' }),
        offer({ id: 'b', rank: 2, unitPriceCents: 399, supplierName: 'Giga' }),
      ],
    });
    render(<ResearchRunScreen client={client} requestId="req-1" />);
    await waitFor(() => expect(screen.queryByTestId('offers-table')).not.toBeNull());
    const text = screen.getByTestId('offers-table').textContent ?? '';
    expect(text.indexOf('Solar')).toBeGreaterThan(-1);
    expect(text.indexOf('Solar')).toBeLessThan(text.indexOf('Giga'));
  });
});
