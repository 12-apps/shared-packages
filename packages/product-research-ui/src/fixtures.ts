/**
 * Realistic sample data shared by the Storybook stories and the unit tests —
 * one place to keep the wire shapes honest. Not part of the public surface.
 */
import type { OfferOutput, ResearchRequestView, ResearchRunView } from './types';

export function requestView(overrides: Partial<ResearchRequestView> = {}): ResearchRequestView {
  return {
    id: 'req-1',
    term: 'Coca-Cola Lata 350ml',
    brand: null,
    ean: null,
    quantity: 24,
    region: null,
    catalogRef: null,
    createdAt: '2026-07-28T12:00:00.000Z',
    latestRun: null,
    ...overrides,
  };
}

export function offer(overrides: Partial<OfferOutput> = {}): OfferOutput {
  return {
    id: 'offer-1',
    sourceType: 'MANUAL',
    supplierName: 'Distribuidora Solar',
    title: 'Coca-Cola Original Lata 350ml fardo 12',
    url: 'https://store.example/coca',
    imageUrl: null,
    currency: 'BRL',
    priceCents: 4290,
    // 0 = the source STATED free shipping (FUT-518). A fixture that wants the
    // "never said" case overrides this with null.
    shippingCents: 0,
    packQuantity: 12,
    unitPriceCents: 358,
    totalCents: 8580,
    availability: 'IN_STOCK',
    etaDays: 2,
    relevanceScore: 0.93,
    rank: 1,
    expiresAt: null,
    outsideDeliveryArea: false,
    ...overrides,
  };
}

export function runView(overrides: Partial<ResearchRunView> = {}): ResearchRunView {
  return {
    id: 'run-1',
    requestId: 'req-1',
    status: 'COMPLETED',
    sourceStats: [
      {
        sourceId: 'src-1',
        type: 'MANUAL',
        name: 'Distribuidora Solar',
        status: 'OK',
        offerCount: 1,
        ms: 12,
      },
    ],
    error: null,
    startedAt: '2026-07-28T12:00:01.000Z',
    finishedAt: '2026-07-28T12:00:02.000Z',
    offers: [offer()],
    ...overrides,
  };
}
