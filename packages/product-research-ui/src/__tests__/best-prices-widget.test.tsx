// @vitest-environment jsdom
// render/waitFor from @testing-library/react — plain DOM asserts, no jest-dom.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PT_BR_RESEARCH_MESSAGES } from '../pt-BR';
import { describe, expect, it, vi } from 'vitest';

import { BestPricesWidget } from '../best-prices-widget';
import { fakeClient, offer, requestView, runView } from './fake-client';

const COMPLETED_STAMP = { id: 'run-1', status: 'COMPLETED', startedAt: null, finishedAt: null };

describe('BestPricesWidget', () => {
  it('shows the latest research: top offers capped, freshness stamped', async () => {
    const seen: unknown[] = [];
    const client = fakeClient({
      listRequests: (input) => {
        seen.push(input);
        return Promise.resolve({
          data: [requestView({ latestRun: COMPLETED_STAMP })],
          pagination: { total: 1, pageCount: 1, hasNextPage: false },
        });
      },
      getRun: () =>
        Promise.resolve(
          runView({
            offers: [
              offer(),
              offer({ id: 'o2', unitPriceCents: 430, supplierName: 'Giga' }),
              offer({ id: 'o3', unitPriceCents: 449, supplierName: 'Loja C' }),
              offer({ id: 'o4', unitPriceCents: 460, supplierName: 'Loja D' }),
            ],
          }),
        ),
    });
    const onOpen = vi.fn();
    render(
      <BestPricesWidget messages={PT_BR_RESEARCH_MESSAGES}
        client={client}
        term="Coca-Cola Lata 350ml"
        onOpenRequest={onOpen}
        onStartResearch={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('widget-offer-0')).not.toBeNull());
    // The lookup is the exact-term page-1 query, nothing broader.
    expect(seen).toEqual([{ page: 1, pageSize: 1, term: 'Coca-Cola Lata 350ml' }]);
    expect(screen.getByTestId('widget-offer-0').textContent).toContain('R$ 3,58/un');
    // Capped at three — the fourth offer stays on the full screen.
    await waitFor(() => expect(screen.queryByTestId('widget-offer-3')).toBeNull());
    expect(screen.getByTestId('widget-freshness').textContent).toContain('preços de');

    fireEvent.click(screen.getByTestId('widget-open-research'));
    expect(onOpen).toHaveBeenCalledWith('req-1');
  });

  it('teaches the first research when none exists for the term', async () => {
    const client = fakeClient({
      listRequests: () =>
        Promise.resolve({ data: [], pagination: { total: 0, pageCount: 1, hasNextPage: false } }),
    });
    const onStart = vi.fn();
    render(
      <BestPricesWidget messages={PT_BR_RESEARCH_MESSAGES}
        client={client}
        term="Café Torrado 1kg"
        onOpenRequest={vi.fn()}
        onStartResearch={onStart}
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('widget-empty')).not.toBeNull());
    await waitFor(() => expect(screen.queryByTestId('widget-open-research')).toBeNull());
    fireEvent.click(screen.getByTestId('widget-start-research'));
    expect(onStart).toHaveBeenCalled();
  });

  it('degrades a transport failure to the teaching state, never an error banner', async () => {
    const client = fakeClient({
      listRequests: () => Promise.reject(new Error('rede fora')),
    });
    render(
      <BestPricesWidget messages={PT_BR_RESEARCH_MESSAGES}
        client={client}
        term="Água 500ml"
        onOpenRequest={vi.fn()}
        onStartResearch={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId('widget-empty')).not.toBeNull());
  });

  /**
   * FUT-495 (FUT-491 review): the widget renders the same `OfferOutput` the run
   * screen does, and used to render it WITHOUT the caveat — so a store that does
   * not deliver to the buyer looked ordinary on the product subpage, which is
   * where the daily workflow actually happens. Unflagged here defeats the whole
   * reason those prices are shown at all.
   */
  it('badges a flagged offer and leaves the deliverable ones alone', async () => {
    const client = fakeClient({
      listRequests: () =>
        Promise.resolve({
          data: [requestView({ latestRun: COMPLETED_STAMP })],
          pagination: { total: 1, pageCount: 1, hasNextPage: false },
        }),
      getRun: () =>
        Promise.resolve(
          runView({
            offers: [
              offer({
                id: 'far',
                supplierName: 'Apoio Entrega',
                unitPriceCents: 379,
                outsideDeliveryArea: true,
              }),
              offer({ id: 'near', supplierName: 'Giga', unitPriceCents: 430 }),
            ],
          }),
        ),
    });
    render(
      <BestPricesWidget messages={PT_BR_RESEARCH_MESSAGES}
        client={client}
        term="Coca-Cola Lata 350ml"
        onOpenRequest={vi.fn()}
        onStartResearch={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('widget-outside-area-far')).not.toBeNull());
    const badge = screen.getByTestId('widget-outside-area-far');
    expect(badge.textContent).toContain('Fora da área de entrega');
    // The caveat is announced, not hover-only (the FUT-491 review's a11y gap).
    expect(badge.textContent).toContain('região padrão da loja');
    await waitFor(() => expect(badge.getAttribute('tabindex')).toBe('0'));
    // Flagged, never hidden: the price still leads on its unit price.
    expect(screen.getByTestId('widget-offer-0').textContent).toContain('R$ 3,79/un');
    // And an ordinary offer carries no badge.
    expect(screen.getByTestId('widget-offer-1').textContent).not.toContain(
      'Fora da área de entrega',
    );
  });

  /**
   * FUT-518, as a NEGATIVE lock. The widget shows only `unitPriceCents`, which
   * is `priceCents / packQuantity` and never carries freight — so an unknown
   * shipping cost qualifies nothing here and must NOT be badged. If a refactor
   * ever folds shipping into this line, this test goes red and the caveat has
   * to come with it.
   */
  it('shows no shipping caveat: the widget renders a unit price freight never touches', async () => {
    const client = fakeClient({
      listRequests: () =>
        Promise.resolve({
          data: [requestView({ latestRun: COMPLETED_STAMP })],
          pagination: { total: 1, pageCount: 1, hasNextPage: false },
        }),
      getRun: () =>
        Promise.resolve(
          runView({
            offers: [offer({ id: 'serp', supplierName: 'Mercado Preço Bom', shippingCents: null })],
          }),
        ),
    });
    render(
      <BestPricesWidget messages={PT_BR_RESEARCH_MESSAGES}
        client={client}
        term="Coca-Cola Lata 350ml"
        onOpenRequest={vi.fn()}
        onStartResearch={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('widget-offer-0')).not.toBeNull());
    // Absence on the rendered TEXT of the whole widget: nothing was removed
    // here, so a null-element check would be the flakiness gate's shape.
    expect(screen.getByTestId('best-prices-widget').textContent).not.toContain(
      'Frete não informado',
    );
  });

  it('treats a research whose run has not completed as not-yet-available', async () => {
    const client = fakeClient({
      listRequests: () =>
        Promise.resolve({
          data: [
            requestView({
              latestRun: { id: 'run-1', status: 'RUNNING', startedAt: null, finishedAt: null },
            }),
          ],
          pagination: { total: 1, pageCount: 1, hasNextPage: false },
        }),
    });
    render(
      <BestPricesWidget messages={PT_BR_RESEARCH_MESSAGES}
        client={client}
        term="Coca-Cola Lata 350ml"
        onOpenRequest={vi.fn()}
        onStartResearch={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId('widget-empty')).not.toBeNull());
  });
});
