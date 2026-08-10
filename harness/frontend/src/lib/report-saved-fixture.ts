/**
 * The saved documents the harness starts with — the seven cards the list
 * screen is a comparison of, and the specs behind them.
 *
 * Its own module because `memory-backend` is at the size gate's ceiling and
 * this is the half of it that is CONTENT: which reports exist, what each one
 * asks for, who may read it and when it was last touched. The wiring — the
 * store, the actor, the router — stays there.
 *
 * Every document now asks for the data its NAME promises. While the catalog
 * had one entity they could not: "Perdas por motivo" drew orders revenue and
 * "Cardápio antigo" drew the same bars again, because `orders` was all there
 * was. A card that opens onto somebody else's numbers is worse than one that
 * opens onto nothing, and it is the same defect the block templates had.
 */

/** A stored saved-report row, in the shape the package's store reads. */
export interface StoredRow {
  id: string;
  name: string;
  description: string | null;
  spec: unknown;
  status: string;
  visibility: string;
  visibilityRoles: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Receita por forma de pagamento — bars, because CARD and PIX have no order. */
const REVENUE_BY_METHOD = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'revenueCents' }],
  filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
  presentation: { kind: 'chart', chartType: 'bar' },
};

/**
 * Pedidos por faixa de hora — a LINE, and the saved document that proves the
 * ordered-axis rule cuts both ways: `hourOfDay` is a string, so only the
 * catalog's `ordered` flag makes this chart offerable at all, where the same
 * report over `method` above may not be a line.
 */
const ORDERS_BY_HOUR = {
  entity: 'orders',
  dimensions: [{ field: 'hourOfDay' }],
  measures: [{ field: 'id', aggregation: 'count', alias: 'pedidos' }],
  presentation: { kind: 'chart', chartType: 'line' },
};

const LOSSES_BY_REASON = {
  entity: 'loss_events',
  dimensions: [{ field: 'reasonName' }],
  measures: [{ field: 'lossValueCents', aggregation: 'sum', alias: 'valor_perdido' }],
  presentation: { kind: 'chart', chartType: 'bar' },
};

const TOP_PRODUCTS = {
  entity: 'order_items',
  dimensions: [{ field: 'productName' }],
  measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
  sort: [{ by: 'receita', direction: 'desc' }],
  limit: 10,
  presentation: { kind: 'chart', chartType: 'bar' },
};

const DASHBOARD = {
  kind: 'dashboard',
  blocks: [
    { id: 'revenue', span: 6, title: 'Receita por forma', spec: REVENUE_BY_METHOD },
    {
      id: 'daily',
      span: 6,
      spec: {
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
        measures: [{ field: 'revenueCents' }],
        presentation: { kind: 'table' },
      },
    },
  ],
};

/** A one-block document, for the cards whose point is that they are SMALL. */
function singleBlockDashboard(id: string, title: string, spec: unknown = REVENUE_BY_METHOD): unknown {
  return { kind: 'dashboard', blocks: [{ id, span: 12, title, spec }] };
}

/** A document big enough to saturate the list card's six-bar sparkline. */
function wideDashboard(spec: unknown): unknown {
  return {
    kind: 'dashboard',
    blocks: Array.from({ length: 7 }, (_, index) => ({
      id: `b${index + 1}`,
      span: 4,
      title: `Bloco ${index + 1}`,
      spec,
    })),
  };
}

/** Minutes/days ago, from the real clock — a card's "há 2 min" never rots. */
function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

const HOUR = 60;
const DAY = 60 * 24;

/** One stored row, with the fields a fixture rarely wants to restate. */
function row(patch: Partial<StoredRow> & { id: string; name: string }): StoredRow {
  return {
    description: null,
    spec: singleBlockDashboard(patch.id, patch.name),
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    createdBy: 'u1',
    createdAt: new Date('2026-06-01T12:00:00Z'),
    updatedAt: minutesAgo(DAY * 7),
    ...patch,
  };
}

/**
 * Storage is per-transport, so each mount starts from the same fixture.
 *
 * Two rows were enough when the screen was a list of rows. The card grid is a
 * COMPARISON — sizes, scopes, staleness, who authored what — and two cards
 * show none of it. These seven cover every state a card renders: both chips,
 * all three visibilities, one block against seven, a missing description, an
 * author who is not the caller, and edit times from minutes to weeks.
 */
export function seedRows(): StoredRow[] {
  return [
    row({
      id: 'r1',
      name: 'Vendas por forma de pagamento',
      description: 'Receita diária separada por PIX, cartão e garçom',
      spec: DASHBOARD,
      updatedAt: minutesAgo(DAY * 9),
    }),
    row({
      id: 'r2',
      name: 'Ticket médio',
      spec: {
        entity: 'orders',
        dimensions: [],
        measures: [{ field: 'revenueCents', aggregation: 'avg' }],
        presentation: { kind: 'kpi' },
      },
      status: 'archived',
      visibility: 'private',
      updatedAt: new Date('2026-06-15T18:00:00Z'),
    }),
    row({
      id: 'r3',
      name: 'Movimento por hora',
      description: 'A que horas a loja enche — pedidos por faixa de hora, no período.',
      spec: wideDashboard(ORDERS_BY_HOUR),
      updatedAt: minutesAgo(12),
    }),
    row({
      id: 'r4',
      name: 'Fechamento do caixa',
      spec: singleBlockDashboard('caixa', 'Total do dia'),
      status: 'draft',
      visibility: 'private',
      updatedAt: minutesAgo(HOUR * 26),
    }),
    row({
      id: 'r5',
      name: 'Metas da equipe',
      description: 'Painel da gerência: quanto cada turno vendeu contra a meta do mês.',
      spec: DASHBOARD,
      visibility: 'roles',
      visibilityRoles: ['gerente'],
      // Someone ELSE authored it, so `Meus` has something to leave out.
      createdBy: 'u2',
      updatedAt: minutesAgo(DAY * 3),
    }),
    row({
      id: 'r6',
      name: 'Perdas por motivo',
      description: 'Quanto saiu do estoque sem virar venda, por motivo declarado.',
      spec: singleBlockDashboard('perdas', 'Perdas por motivo', LOSSES_BY_REASON),
      updatedAt: minutesAgo(DAY * 16),
    }),
    row({
      id: 'r7',
      name: 'Cardápio antigo',
      description: 'Vendas do cardápio de verão — mantido para consulta.',
      spec: singleBlockDashboard('produtos', 'Mais vendidos', TOP_PRODUCTS),
      status: 'archived',
      createdBy: 'u2',
      updatedAt: new Date('2026-05-20T12:00:00Z'),
    }),
  ];
}
