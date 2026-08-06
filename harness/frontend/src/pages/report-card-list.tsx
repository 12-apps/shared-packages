import { useState } from 'react';

import { ReportCardList } from '@12-apps/report-builder/react';

/**
 * The PUBLISHED report list, driven with summaries a host already holds.
 *
 * `ReportsPage` fetches its own data and needs a router and a query client;
 * `ReportCardList` takes the summaries as a prop, so this harness — which has
 * no API — renders the real component rather than a lookalike that could pass
 * while the shipped one is broken.
 *
 * The state lives here because that is where it lives in a host too: the list
 * is controlled, so scope and search are the page's to own.
 */

/** Enough shape to exercise every rule the list applies. */
const REPORTS = [
  {
    id: 'r1',
    name: 'Vendas por forma de pagamento',
    description: 'Receita diária separada por PIX, cartão e garçom',
    type: 'dashboard' as const,
    entity: 'orders',
    entities: ['orders', 'payments'],
    status: 'published' as const,
    visibility: 'tenant' as const,
    updatedAt: '2026-08-01T12:00:00Z',
  },
  {
    id: 'r2',
    name: 'Relatório de perdas',
    // Accented, so the search test proves folding rather than a substring match.
    description: 'Movimentações de estoque canceladas e baixas por motivo',
    type: 'report' as const,
    entity: 'stock_movements',
    entities: ['stock_movements'],
    status: 'published' as const,
    visibility: 'private' as const,
    updatedAt: '2026-07-28T09:30:00Z',
  },
  {
    id: 'r3',
    name: 'Ticket médio',
    // No description: the card must still render, and search must not crash on
    // a null the wire type explicitly allows.
    description: null,
    type: 'report' as const,
    entity: 'orders',
    entities: ['orders'],
    status: 'archived' as const,
    visibility: 'tenant' as const,
    updatedAt: '2026-06-15T18:00:00Z',
  },
];

export function ReportCardListPage(): JSX.Element {
  const [scope, setScope] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [created, setCreated] = useState(0);

  return (
    <div data-testid="report-card-list-page">
      <h2 style={{ marginTop: 0 }}>Report list</h2>

      <ReportCardList
        reports={REPORTS}
        selectedId={selectedId}
        scope={scope}
        search={search}
        onScopeChange={setScope}
        onSearchChange={setSearch}
        onSelect={setSelectedId}
        onCreate={() => setCreated((count) => count + 1)}
      />

      {/* The callbacks' effects, made observable — a spec can then assert that
          selecting a card and pressing "novo" actually reach the host. */}
      <dl style={{ marginTop: 24, fontSize: 13, color: '#555' }}>
        <dt>selected</dt>
        <dd data-testid="list-selected">{selectedId || '(nenhum)'}</dd>
        <dt>create pressed</dt>
        <dd data-testid="list-created">{created}</dd>
      </dl>
    </div>
  );
}
