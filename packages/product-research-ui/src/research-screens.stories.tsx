/**
 * Every exported research component, explorable with NO host: the mock
 * client below stands in for the ResearchApiClient a real host implements.
 * (FUT-420's acceptance criterion — the package renders on its own.)
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { BestOfferCard } from './best-offer-card';
import { BestPricesWidget } from './best-prices-widget';
import type { ResearchApiClient } from './client';
import { offer, requestView, runView } from './fixtures';
import { ResearchHistoryList } from './history-list';
import { OffersTable } from './offers-table';
import { ResearchForm } from './research-form';
import { ResearchRunScreen } from './research-run-screen';
import { SourceStatusList } from './source-status';

const OFFERS = [
  offer(),
  offer({
    id: 'offer-2',
    sourceType: 'VTEX',
    supplierName: 'Giga Atacado',
    title: 'Refrigerante Coca-Cola Lata 350ml (12 un)',
    priceCents: 5160,
    unitPriceCents: 430,
    totalCents: 10320,
    relevanceScore: 0.88,
    rank: 2,
    etaDays: 1,
  }),
  offer({
    id: 'offer-3',
    sourceType: 'SERP',
    supplierName: 'Mercado Preço Bom',
    title: 'Coca Cola lata 350',
    priceCents: 449,
    packQuantity: 1,
    unitPriceCents: 449,
    totalCents: 10776,
    availability: null,
    etaDays: null,
    relevanceScore: 0.61,
    rank: 3,
    // FUT-518: a Google Shopping offer states no shipping cost, so its total is
    // a minimum and carries the "frete não informado" caveat. Realistic on
    // purpose — this is what every SERP row looks like today.
    shippingCents: null,
  }),
];

/** A self-contained client: instant answers from the fixtures above. */
function mockClient(overrides: Partial<ResearchApiClient> = {}): ResearchApiClient {
  return {
    startResearch: () => Promise.resolve({ requestId: 'req-1' }),
    getRequest: () =>
      Promise.resolve(
        requestView({
          latestRun: { id: 'run-1', status: 'COMPLETED', startedAt: null, finishedAt: null },
        }),
      ),
    getRun: () => Promise.resolve(runView({ offers: OFFERS })),
    listRequests: () =>
      Promise.resolve({
        data: [
          requestView({
            latestRun: { id: 'run-1', status: 'COMPLETED', startedAt: null, finishedAt: null },
          }),
          requestView({ id: 'req-2', term: 'Guaraná Antarctica 1L', quantity: 6 }),
        ],
        pagination: { total: 2, pageCount: 1, hasNextPage: false },
      }),
    listSources: () =>
      Promise.resolve([
        { id: 'src-1', type: 'MANUAL', name: 'Distribuidora Solar', enabled: true, status: 'ACTIVE' },
        { id: 'src-2', type: 'VTEX', name: 'Giga Atacado', enabled: true, status: 'ACTIVE' },
      ]),
    ...overrides,
  };
}

const meta: Meta = { title: 'Research/Screens' };
export default meta;

export const Form: StoryObj = {
  render: () => (
    <ResearchForm client={mockClient()} onStarted={() => {}} defaultRegion="01310-200" />
  ),
};

export const BestOffer: StoryObj = {
  render: () => <BestOfferCard offer={offer()} quantity={24} />,
};

/**
 * FUT-518: the cheapest offer's store said nothing about freight, so the hero
 * total is a MINIMUM. It still leads — the caveat rides the number.
 */
export const BestOfferShippingUnknown: StoryObj = {
  render: () => <BestOfferCard offer={offer({ shippingCents: null })} quantity={24} />,
};

export const Offers: StoryObj = {
  render: () => <OffersTable offers={OFFERS} />,
};

export const OffersEmpty: StoryObj = {
  render: () => <OffersTable offers={[]} />,
};

export const SourceStatusRunning: StoryObj = {
  render: () => (
    <SourceStatusList
      sources={[
        { id: 's1', type: 'MANUAL', name: 'Distribuidora Solar', enabled: true, status: 'ACTIVE' },
        { id: 's2', type: 'VTEX', name: 'Giga Atacado', enabled: true, status: 'ACTIVE' },
      ]}
      stats={null}
      running
    />
  ),
};

export const SourceStatusDegraded: StoryObj = {
  render: () => (
    <SourceStatusList
      sources={[]}
      stats={[
        { sourceId: 's1', type: 'MANUAL', name: 'Solar', status: 'OK', offerCount: 4, ms: 8 },
        {
          sourceId: 's2',
          type: 'VTEX',
          name: 'Atacadão',
          status: 'FAILED',
          offerCount: 0,
          ms: 1_300,
          // FUT-495: the reason a failed source records is what the row shows.
          error:
            'Busca no catálogo VTEX falhou: a loja recusou nosso acesso (HTTP 403 — bloqueio ' +
            'de bot ou de IP). Endereço: https://www.atacadao.com.br/api/catalog_system/pub/products/search',
        },
        { sourceId: 's3', type: 'SERP', name: 'Busca web', status: 'BUDGET_EXCEEDED', offerCount: 0, ms: 1 },
      ]}
      running={false}
    />
  ),
};

export const History: StoryObj = {
  render: () => (
    <ResearchHistoryList
      requests={[
        requestView({
          latestRun: { id: 'run-1', status: 'COMPLETED', startedAt: null, finishedAt: null },
        }),
        requestView({ id: 'req-2', term: 'Água Mineral 500ml fardo', quantity: 48 }),
      ]}
      onOpen={() => {}}
    />
  ),
};

export const RunCompleted: StoryObj = {
  render: () => <ResearchRunScreen client={mockClient()} requestId="req-1" />,
};

export const RunDegraded: StoryObj = {
  render: () => (
    <ResearchRunScreen
      client={mockClient({
        getRun: () =>
          Promise.resolve(
            runView({
              offers: OFFERS,
              sourceStats: [
                { sourceId: 's1', type: 'MANUAL', name: 'Solar', status: 'OK', offerCount: 3, ms: 9 },
                { sourceId: 's2', type: 'VTEX', name: 'Giga', status: 'FAILED', offerCount: 0, ms: 800 },
              ],
            }),
          ),
      })}
      requestId="req-1"
    />
  ),
};

/**
 * FUT-491: the store does not deliver to the buyer's CEP, so its prices are
 * the DEFAULT region's — shown, badged, and called out on the source chip.
 */
export const RunOutsideDeliveryArea: StoryObj = {
  render: () => (
    <ResearchRunScreen
      client={mockClient({
        getRun: () =>
          Promise.resolve(
            runView({
              offers: OFFERS.map((entry) => ({ ...entry, outsideDeliveryArea: true })),
              sourceStats: [
                {
                  sourceId: 's2',
                  type: 'VTEX',
                  name: 'Apoio Entrega',
                  status: 'OK',
                  offerCount: OFFERS.length,
                  ms: 420,
                  outsideDeliveryArea: true,
                },
              ],
            }),
          ),
      })}
      requestId="req-1"
    />
  ),
};

export const RunNoOffers: StoryObj = {
  render: () => (
    <ResearchRunScreen
      client={mockClient({ getRun: () => Promise.resolve(runView({ offers: [] })) })}
      requestId="req-1"
    />
  ),
};

export const Widget: StoryObj = {
  render: () => (
    <BestPricesWidget
      client={mockClient()}
      term="Coca-Cola Lata 350ml"
      onOpenRequest={() => {}}
      onStartResearch={() => {}}
    />
  ),
};

export const WidgetEmpty: StoryObj = {
  render: () => (
    <BestPricesWidget
      client={mockClient({
        listRequests: () =>
          Promise.resolve({
            data: [],
            pagination: { total: 0, pageCount: 1, hasNextPage: false },
          }),
      })}
      term="Produto sem pesquisa"
      onOpenRequest={() => {}}
      onStartResearch={() => {}}
    />
  ),
};

export const EnglishMessages: StoryObj = {
  render: () => (
    <ResearchRunScreen
      client={mockClient()}
      requestId="req-1"
      messages={{
        bestOfferTitle: 'Best price',
        offersTitle: 'All offers',
        statusTitle: 'Sources queried',
        openOffer: 'Buy at the store',
      }}
    />
  ),
};
