import { reportSpecSchema, type ReportSpec, type ReportSpecInput } from '../spec';

/**
 * Per-entity starter specs (FUT-308) — the "smart default" report each
 * entity opens with, served by the fields listing so the builder UI prefills
 * a runnable report on entity pick and MCP authors can start from a known
 * good spec instead of an empty one. Parsed through {@link reportSpecSchema}
 * at module init (the wire carries the parsed form), and compile-validated
 * against the live catalog by the starter test — a catalog rename that
 * breaks a starter fails the suite, not a tenant's first click.
 */
const STARTER_INPUTS: Record<string, ReportSpecInput> = {
  orders: {
    entity: 'orders',
    dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
    measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
    filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
    presentation: { kind: 'chart', chartType: 'line' },
  },
  order_items: {
    entity: 'order_items',
    dimensions: [{ field: 'productName' }],
    measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
    sort: [{ by: 'receita', direction: 'desc' }],
    limit: 10,
    presentation: { kind: 'chart', chartType: 'bar' },
  },
  payments: {
    entity: 'payments',
    dimensions: [{ field: 'method' }],
    measures: [{ field: 'amountCents', aggregation: 'sum', alias: 'valor' }],
    filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
    presentation: { kind: 'chart', chartType: 'pie' },
  },
  stock_movements: {
    entity: 'stock_movements',
    dimensions: [{ field: 'type' }],
    measures: [{ field: 'quantityDelta', aggregation: 'sum', alias: 'quantidade' }],
    presentation: { kind: 'chart', chartType: 'bar' },
  },
  loss_events: {
    entity: 'loss_events',
    dimensions: [{ field: 'reasonName' }],
    measures: [{ field: 'lossValueCents', aggregation: 'sum', alias: 'valor_perdido' }],
    presentation: { kind: 'chart', chartType: 'bar' },
  },
  // Starts on the STATION, never on the cook: grouping by an identity
  // dimension is rejected unless every measure declares a suppression floor,
  // so a per-cook starter would open with a spec the compiler refuses.
  kitchen_ticket_items: {
    entity: 'kitchen_ticket_items',
    dimensions: [{ field: 'stationName' }],
    measures: [
      { field: 'prepSeconds', aggregation: 'p90', alias: 'preparo_p90' },
      { field: 'lines', aggregation: 'sum', alias: 'linhas' },
    ],
    sort: [{ by: 'linhas', direction: 'desc' }],
    presentation: { kind: 'table' },
  },
  kitchen_shifts: {
    entity: 'kitchen_shifts',
    dimensions: [{ field: 'stationName' }],
    measures: [
      { field: 'laborSeconds', aggregation: 'sum', alias: 'horas' },
      { field: 'outputLines', aggregation: 'sum', alias: 'linhas' },
    ],
    sort: [{ by: 'horas', direction: 'desc' }],
    presentation: { kind: 'table' },
  },
};

export const REPORT_ENTITY_STARTERS: Record<string, ReportSpec> = Object.fromEntries(
  Object.entries(STARTER_INPUTS).map(([entity, input]) => [entity, reportSpecSchema.parse(input)]),
);
