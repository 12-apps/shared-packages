import { defineCatalog } from '../catalog';

/** Toy host: a sales entity, proving integration needs only catalog + adapter. */
export const salesCatalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      description: 'Pedidos pagos',
      fields: {
        id: { label: 'Pedido', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        method: {
          label: 'Forma de pagamento',
          type: 'string',
          role: 'dimension',
          /** A closed set, so a split's legend can say "Cartão" and not `CARD`. */
          values: [
            { value: 'PIX', label: 'PIX' },
            { value: 'CARD', label: 'Cartão' },
            { value: 'WAITER', label: 'Com o garçom' },
          ],
        },
        product: { label: 'Produto', type: 'string', role: 'dimension' },
        /**
         * A STRING carrying an ordinal, mirroring the real catalog's
         * `orders.hourOfDay` ("00"–"23"): its TYPE says categorical and only
         * `ordered` says otherwise. It is what makes the ordered-axis rule
         * (FUT-755) testable as a property of the CATALOG — without it,
         * "ordered" and "is a date" would be indistinguishable in every test.
         */
        hourOfDay: { label: 'Hora do dia', type: 'string', role: 'dimension', ordered: true },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
        itemCount: { label: 'Itens', type: 'number', role: 'measure' },
        /** Declares a render format, so p90/percentile columns come out as durations. */
        prepSeconds: {
          label: 'Tempo de preparo',
          type: 'number',
          role: 'measure',
          format: 'duration',
        },
        lateItems: { label: 'Itens atrasados', type: 'number', role: 'measure' },
      },
    },
  },
});

export const orderRows = [
  { id: 'o1', createdAt: '2026-07-01T10:00:00Z', method: 'PIX', totalCents: 1000, itemCount: 1 },
  { id: 'o2', createdAt: '2026-07-01T22:30:00Z', method: 'CARD', totalCents: 2000, itemCount: 2 },
  { id: 'o3', createdAt: '2026-07-02T03:00:00Z', method: 'PIX', totalCents: 3000, itemCount: 3 },
  { id: 'o4', createdAt: '2026-07-08T12:00:00Z', method: 'PIX', totalCents: 4000, itemCount: 1 },
  { id: 'o5', createdAt: '2026-08-01T12:00:00Z', method: 'CARD', totalCents: 5000, itemCount: 2 },
];

/**
 * Two payment methods across three consecutive days, deliberately UNEVEN: day
 * two has no card sale at all, so a pivot that silently zero-fills a missing
 * pair is distinguishable from one that leaves the gap. Every figure is
 * distinct, so a series plotted against the wrong dates cannot coincidentally
 * match.
 *
 * The zone is `America/Sao_Paulo` (UTC-3) and every timestamp is at 15:00Z, so
 * each row lands on its own calendar day with no bucket-boundary subtlety.
 */
export const splitRows = [
  { id: 's1', createdAt: '2026-07-01T15:00:00Z', method: 'PIX', totalCents: 100, itemCount: 1 },
  { id: 's2', createdAt: '2026-07-01T15:00:00Z', method: 'CARD', totalCents: 200, itemCount: 2 },
  { id: 's3', createdAt: '2026-07-02T15:00:00Z', method: 'PIX', totalCents: 300, itemCount: 3 },
  { id: 's4', createdAt: '2026-07-03T15:00:00Z', method: 'PIX', totalCents: 400, itemCount: 4 },
  { id: 's5', createdAt: '2026-07-03T15:00:00Z', method: 'CARD', totalCents: 500, itemCount: 5 },
];

/**
 * One axis bucket, `n` products on it — the open-ended split the series cap
 * exists for. Totals descend with the index so the ranking is unambiguous.
 */
export function productSplitRows(count: number): Array<Record<string, string | number>> {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    createdAt: '2026-07-01T15:00:00Z',
    method: 'PIX',
    product: `Produto ${String(index).padStart(2, '0')}`,
    totalCents: (count - index) * 100,
    itemCount: count - index,
  }));
}
