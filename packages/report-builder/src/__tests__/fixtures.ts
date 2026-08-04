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
        method: { label: 'Forma de pagamento', type: 'string', role: 'dimension' },
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
