import {
  autoTitle,
  compileReport,
  defineCatalog,
  executeCompiledQuery,
  renderReport,
  specSentence,
  type ReportSpec,
} from '@12-apps/report-builder';

/**
 * The composition a host performs in a browser: a catalog, a spec, and the
 * published pipeline turning the two into something on screen — compile →
 * execute → render, plus the spec sentence that says what the block asks for.
 *
 * Nothing here is a mock of OUR code. The catalog builder, the compiler, the
 * in-memory executor, the render model and the sentence are all the published
 * package. Only the ROWS are local, because a data source is the host's half of
 * the contract; the backend harness owns the server-side half.
 *
 * It renders the model with plain elements rather than the package's React
 * surface: `@12-apps/report-builder/react` peers on react-router-dom and
 * @tanstack/react-query, and pulling a router into the harness would add a
 * dependency none of the packages under test require — one more thing that can
 * explain a failure that is supposed to be about our packages.
 */
const catalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: {
        id: { label: 'Pedido', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        method: { label: 'Forma de pagamento', type: 'string', role: 'dimension' },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
  },
});

const ROWS = [
  { id: 'o1', createdAt: '2026-07-01T10:00:00Z', method: 'PIX', totalCents: 1000 },
  { id: 'o2', createdAt: '2026-07-01T22:30:00Z', method: 'CARD', totalCents: 2000 },
  { id: 'o3', createdAt: '2026-07-02T03:00:00Z', method: 'PIX', totalCents: 3000 },
];

/** Two blocks, so the page shows the sentence varying with the spec. */
const SPECS: ReadonlyArray<{ id: string; spec: ReportSpec }> = [
  {
    id: 'by-method',
    spec: {
      version: 1,
      entity: 'orders',
      dimensions: [{ field: 'method' }],
      measures: [{ field: 'totalCents' }],
      filters: [],
      sort: [],
      presentation: { kind: 'table' },
    },
  },
  {
    id: 'by-day-pix',
    spec: {
      version: 1,
      entity: 'orders',
      dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
      measures: [{ field: 'totalCents' }],
      filters: [{ field: 'method', operator: 'eq', value: 'PIX' }],
      sort: [],
      presentation: { kind: 'table' },
    },
  },
];

function Block({ id, spec }: { id: string; spec: ReportSpec }): JSX.Element {
  const query = compileReport(spec, catalog, { timeZone: 'America/Sao_Paulo' });
  const rows = executeCompiledQuery(ROWS, query);
  const render = renderReport(query, spec.presentation, catalog, rows);

  return (
    <section data-testid={`report-block-${id}`} style={{ marginBottom: 32 }}>
      <h3 style={{ margin: '0 0 4px' }} data-testid={`report-block-${id}-title`}>
        {autoTitle(spec, catalog)}
      </h3>
      {/* The same string the server puts on every dashboard block — the whole
          point of the sentence is that these do not drift. */}
      <p
        style={{ margin: '0 0 12px', fontSize: 13, color: '#666' }}
        data-testid={`report-block-${id}-sentence`}
      >
        {specSentence(spec, catalog)}
      </p>

      {render.kind === 'table' ? (
        <table
          data-testid={`report-block-${id}-table`}
          style={{ borderCollapse: 'collapse', minWidth: 320 }}
        >
          <thead>
            <tr>
              {render.columns.map((column) => (
                <th
                  key={column.key}
                  style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 12px 4px 0' }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {render.rows.map((row, index) => (
              <tr key={index} data-testid={`report-block-${id}-row`}>
                {render.columns.map((column) => (
                  <td key={column.key} style={{ padding: '4px 12px 4px 0' }}>
                    {String(row[column.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p data-testid={`report-block-${id}-unsupported`}>
          Render kind “{render.kind}” is not tabulated by this harness page.
        </p>
      )}
    </section>
  );
}

export function ReportBuilderPage(): JSX.Element {
  return (
    <div data-testid="report-builder">
      <h2 style={{ marginTop: 0 }}>Report builder</h2>
      {SPECS.map((entry) => (
        <Block key={entry.id} id={entry.id} spec={entry.spec} />
      ))}
    </div>
  );
}
