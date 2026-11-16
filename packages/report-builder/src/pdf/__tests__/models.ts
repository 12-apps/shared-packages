import type { ReportPdfBlock, ReportPdfOptions } from '..';
import type { ReportRenderModel, ReportTableColumn } from '../../render';

/** Hand-built render models, shaped the way the run pipeline emits them. */
export const BASE_OPTIONS: ReportPdfOptions = {
  title: 'Custo de mão de obra',
  periodLabel: '9 a 15/11/2026',
  storeName: 'Loja Modelo',
  locale: 'pt-BR',
  timeZone: 'America/Sao_Paulo',
  generatedAt: new Date('2026-11-16T11:00:00Z'),
  appName: 'Acme',
};

export function kpiBlock(id: string, span: number, label: string, value: number | null, format: 'brl' | 'percent' | 'integer' = 'brl'): ReportPdfBlock {
  const figure = { label, value, suppressed: false, format };
  const render: ReportRenderModel = { kind: 'kpi', ...figure, figures: [figure], rows: [] };
  return { id, span, status: 'ok', sentence: 'soma de custo por dia', render };
}

const COLUMNS: ReportTableColumn[] = [
  { key: 'person', label: 'Pessoa', format: 'text' },
  { key: 'role', label: 'Função', format: 'text', valueLabels: { cook: 'Cozinha', floor: 'Salão' } },
  { key: 'hours', label: 'Horas', format: 'duration', decimals: 1 },
  { key: 'cost', label: 'Custo', format: 'brl' },
];

export function tableBlock(id: string, count: number, flagEvery = 0): ReportPdfBlock {
  const rows = Array.from({ length: count }, (_, index) => ({
    person: `Colaborador ${index + 1}`,
    role: index % 2 === 0 ? 'cook' : 'floor',
    hours: 3600 * (30 + (index % 9)),
    cost: 150000 + index * 3700,
  }));
  const flagged = flagEvery > 0 ? rows.flatMap((_, index) => (index % flagEvery === 0 ? [index] : [])) : [];
  return {
    id,
    span: 12,
    status: 'ok',
    title: 'Custo por pessoa',
    sentence: 'soma de horas e de custo, por pessoa, onde a semana é a atual',
    render: {
      kind: 'table',
      columns: COLUMNS,
      rows,
      ...(flagEvery > 0 ? { flag: { column: 'cost', label: 'Acima da meta', rows: flagged } } : {}),
    },
  };
}

const DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

export function barBlock(id: string, span: number, stacked = false): ReportPdfBlock {
  const rows = DAYS.map((day, index) => ({ day, cook: 120000 + index * 21000, floor: 90000 + ((index * 37) % 5) * 15000 }));
  return {
    id,
    span,
    status: 'ok',
    title: 'Custo por dia',
    sentence: 'soma de custo, por dia, separado por função',
    render: {
      kind: 'chart',
      chartSpec: {
        type: 'bar',
        xAxis: { key: 'day', label: 'Dia' },
        yAxis: { label: 'Custo' },
        series: [
          { key: 'cook', label: 'Cozinha' },
          { key: 'floor', label: 'Salão' },
        ],
        stacked,
        numberFormat: 'brl',
      },
      tableColumns: [],
      rows,
    },
  };
}

export function lineBlock(id: string, span: number, type: 'line' | 'area' = 'line', points = 14): ReportPdfBlock {
  const rows = Array.from({ length: points }, (_, index) => ({
    day: `${String(index + 1).padStart(2, '0')}/11`,
    revenue: 400000 + Math.round(Math.sin(index / 2) * 90000) + index * 12000,
  }));
  return {
    id,
    span,
    status: 'ok',
    title: 'Vendas por dia',
    render: {
      kind: 'chart',
      chartSpec: { type, xAxis: { key: 'day' }, series: [{ key: 'revenue', label: 'Receita', color: 'primary' }], numberFormat: 'brl', colorScheme: ['primary'] },
      tableColumns: [],
      rows,
    },
  };
}

export function donutBlock(id: string, span: number): ReportPdfBlock {
  const rows = [
    { method: 'PIX', total: 820000 },
    { method: 'Cartão', total: 540000 },
    { method: 'Dinheiro', total: 210000 },
    { method: 'Com o garçom', total: 90000 },
  ];
  return {
    id,
    span,
    status: 'ok',
    title: 'Vendas por forma de pagamento',
    render: {
      kind: 'chart',
      chartSpec: { type: 'donut', xAxis: { key: 'method' }, series: [{ key: 'total', label: 'Receita' }], numberFormat: 'brl', centerLabel: { label: 'Total', value: 'R$ 16,6 mil' } },
      tableColumns: [],
      rows,
    },
  };
}

export function heatmapBlock(id: string): ReportPdfBlock {
  const hours = ['10h', '11h', '12h', '13h'];
  const days = ['Seg', 'Ter', 'Qua'];
  const values: (number | null | 'unmeasured')[][] = [
    [0.52, 0.28, 0.31, 0.12],
    [0.3, 0.64, 0.2, null],
    [0.09, 0.41, 'unmeasured', 0.05],
  ];
  const cells = days.flatMap((day, di) =>
    hours.map((hour, hi) => {
      const value = values[di]?.[hi] ?? null;
      return value === 'unmeasured'
        ? { row: day, column: hour, value: null, reason: 'unmeasured' as const }
        : { row: day, column: hour, value };
    }),
  );
  return {
    id,
    span: 12,
    status: 'ok',
    title: 'Custo sobre vendas por hora',
    render: {
      kind: 'heatmap',
      rowAxis: days.map((label) => ({ key: label, label })),
      columnAxis: hours.map((label) => ({ key: label, label })),
      cells,
      scale: { target: 0.3, strongAbove: 0.5 },
      labels: { above: 'acima da meta', below: 'na meta ou abaixo', empty: 'sem venda', unmeasured: 'sem custo na hora' },
      valueFormat: 'percent',
      tableColumns: [{ key: 'day', label: 'Dia', format: 'text' }],
      rows: [],
    },
  };
}

export const ERROR_BLOCK: ReportPdfBlock = { id: 'broken', span: 12, status: 'error', title: 'Bloco quebrado', sentence: 'soma de algo' };

export const LABOUR_BLOCKS: ReportPdfBlock[] = [
  kpiBlock('k1', 4, 'Custo total', 4820000),
  kpiBlock('k2', 4, 'Horas pagas', 1450, 'integer'),
  kpiBlock('k3', 4, 'Custo sobre vendas', 0.284, 'percent'),
  barBlock('b1', 12),
  tableBlock('t1', 22, 5),
];

export const SALES_BLOCKS: ReportPdfBlock[] = [
  kpiBlock('k1', 6, 'Receita', 16600000),
  kpiBlock('k2', 6, 'Pedidos', 1284, 'integer'),
  lineBlock('l1', 8, 'area'),
  donutBlock('d1', 4),
  heatmapBlock('h1'),
];

/** A chart whose period matched nothing. */
export function emptyChartBlock(id: string): ReportPdfBlock {
  return {
    id,
    span: 12,
    status: 'ok',
    title: 'Sem vendas',
    render: {
      kind: 'chart',
      chartSpec: { type: 'line', xAxis: { key: 'x' }, series: [{ key: 'y' }] },
      tableColumns: [],
      rows: [],
    },
  };
}
