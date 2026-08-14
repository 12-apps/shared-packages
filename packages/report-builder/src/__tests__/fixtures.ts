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

/**
 * The floor below which a per-person figure is not computed at all (FUT-454).
 *
 * A number the FIXTURE declares, because it is a catalog decision: how many
 * observations it takes before a duration stops being one named person's
 * timesheet is a question about the host's data, and this package's job is only
 * to enforce whatever answer the catalog gives.
 */
export const LIBRARY_CLERK_MIN_SAMPLE = 20;

/**
 * A second toy host — the municipal library the portability suite lends books
 * for — carrying the two fields the identity-suppression rule is written
 * against, which `salesCatalog` deliberately has none of.
 *
 * It exists because the only catalog that ever exercised that rule was one
 * application's kitchen, so the rule's tests left with that application's data
 * (FUT-454's `kitchen-facts.test.ts`) and took a PACKAGE-owned privacy
 * invariant with them. Nothing here is a cook, a station or a ticket: an
 * identity dimension and an identity-sensitive measure are shapes, and the
 * shapes are what `compileReport` refuses on.
 */
export const circulationCatalog = defineCatalog({
  entities: {
    loans: {
      label: 'Empréstimos',
      description: 'Um registro por empréstimo atendido ao balcão.',
      fields: {
        borrowedAt: { label: 'Data de empréstimo', type: 'date', role: 'dimension' },
        shelfCode: { label: 'Estante', type: 'string', role: 'dimension' },
        /**
         * The identity DIMENSION: grouping by it (or filtering to one of its
         * values) isolates one member of staff, so `minGroupSample` is the
         * floor every measure of such a spec has to declare.
         */
        clerkId: {
          label: 'Funcionário',
          type: 'string',
          role: 'dimension',
          minGroupSample: LIBRARY_CLERK_MIN_SAMPLE,
        },
        loans: { label: 'Empréstimos atendidos', type: 'number', role: 'measure' },
        /**
         * The identity-sensitive MEASURE. `identityMinSample` is the barrier
         * `finalize` applies per row; `minGroupSample` above is only the early,
         * actionable rejection of the most obvious spec that reaches for it.
         */
        deskSeconds: {
          label: 'Tempo no balcão',
          type: 'number',
          role: 'measure',
          format: 'duration',
          identityMinSample: LIBRARY_CLERK_MIN_SAMPLE,
        },
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
