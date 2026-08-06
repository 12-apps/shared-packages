import { useState } from 'react';

import {
  autoTitle,
  compileReport,
  defaultValueFor,
  defineCatalog,
  executeCompiledQuery,
  isClosedSet,
  operatorsFor,
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
        // A closed set: filtering by it is PICKED, never typed.
        method: {
          label: 'Forma de pagamento',
          type: 'string',
          role: 'dimension',
          values: [
            { value: 'PIX', label: 'PIX' },
            { value: 'CARD', label: 'Cartão' },
          ],
        },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
  },
});

const ROWS = [
  { id: 'o1', createdAt: '2026-07-01T10:00:00Z', method: 'PIX', totalCents: 1000 },
  { id: 'o2', createdAt: '2026-07-01T22:30:00Z', method: 'CARD', totalCents: 2000 },
  // 23:00 the previous day in São Paulo — the same late-night sale the backend
  // harness buckets, so the two halves describe one dataset.
  { id: 'o3', createdAt: '2026-07-02T02:00:00Z', method: 'PIX', totalCents: 3000 },
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

const FILTERABLE = ['method', 'totalCents'] as const;

/**
 * A filter row driven entirely by the published catalog (FUT-391): which
 * operators the field offers, and whether its value is picked or typed.
 *
 * This is the contract the real builder's filter row is built on. Proving it in
 * a browser matters because the failure it prevents is invisible: typing `PIX`
 * as `PIXX` produces a spec that is valid, compiles, and matches no rows — a
 * block that reads as "no data" instead of as a typo.
 */
function FilterRow(): JSX.Element {
  const [fieldName, setFieldName] = useState<string>('method');
  const field = catalog.entities.orders.fields[fieldName]!;
  const [value, setValue] = useState<string>(() => defaultValueFor(field));

  const onFieldChange = (next: string): void => {
    setFieldName(next);
    // Reset with the field: keeping the old value gives `method eq 1500` —
    // valid, compiles, matches nothing.
    setValue(defaultValueFor(catalog.entities.orders.fields[next]!));
  };

  return (
    <section data-testid="filter-row" style={{ marginBottom: 32 }}>
      <h3 style={{ margin: '0 0 12px' }}>Filtro</h3>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="Campo"
          data-testid="filter-field"
          value={fieldName}
          onChange={(event) => onFieldChange(event.target.value)}
        >
          {FILTERABLE.map((name) => (
            <option key={name} value={name}>
              {catalog.entities.orders.fields[name]!.label}
            </option>
          ))}
        </select>

        <select aria-label="Condição" data-testid="filter-operator">
          {operatorsFor(field).map((operator) => (
            <option key={operator} value={operator}>
              {operator}
            </option>
          ))}
        </select>

        {isClosedSet(field) ? (
          <select
            aria-label="Valor"
            data-testid="filter-value-select"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            {field.values!.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Valor"
            data-testid="filter-value-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </div>
      <p style={{ fontSize: 13, color: '#666' }}>
        Spec: <code data-testid="filter-spec-value">{value || '(vazio)'}</code>
      </p>
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
      <FilterRow />
    </div>
  );
}
