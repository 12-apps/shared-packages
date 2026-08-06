import {
  compileReport,
  defineCatalog,
  executeCompiledQuery,
  renderReport,
  type ReportSpec,
} from '@12-apps/report-builder';
import { ReportRenderView } from '@12-apps/report-builder/react';

/**
 * The published chart renderer, and the table fallback behind it.
 *
 * The render MODEL comes from the real pipeline — compile → execute → render —
 * so the chart is drawn from a spec rather than from a hand-written ChartSpec
 * that could stay green while the compiler changed underneath it.
 *
 * What this proves that a unit test cannot: the chart actually mounts in a
 * browser, and "Ver como tabela" swaps it for the same numbers. That toggle is
 * the accessibility fallback for a chart, so "it renders" IS the requirement.
 */
const catalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: {
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        method: { label: 'Forma de pagamento', type: 'string', role: 'dimension' },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
  },
});

const ROWS = [
  { createdAt: '2026-07-01T10:00:00Z', method: 'PIX', totalCents: 1000 },
  { createdAt: '2026-07-02T10:00:00Z', method: 'CARD', totalCents: 2000 },
  { createdAt: '2026-07-03T10:00:00Z', method: 'PIX', totalCents: 3000 },
];

const SPEC: ReportSpec = {
  version: 1,
  entity: 'orders',
  dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
  measures: [{ field: 'totalCents' }],
  filters: [],
  sort: [],
  presentation: { kind: 'chart', chartType: 'bar' },
};

export function ReportRenderPage(): JSX.Element {
  const query = compileReport(SPEC, catalog, { timeZone: 'America/Sao_Paulo' });
  const rows = executeCompiledQuery(ROWS, query);
  const render = renderReport(query, SPEC.presentation, catalog, rows);

  return (
    <div data-testid="report-render-page">
      <h2 style={{ marginTop: 0 }}>Chart and its table fallback</h2>
      <ReportRenderView render={render} dataTestId="harness-render" />
    </div>
  );
}
