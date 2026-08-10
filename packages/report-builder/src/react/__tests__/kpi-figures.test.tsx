// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { exportColumnsFor, ReportRenderView } from '../report-render';
import { kpiFigures } from '../lib/kpi-figures';
import type { ReportRender, ReportRow } from '../reports-api';

/**
 * `Número` draws ONE FIGURE PER MEASURE (FUT-755), side by side — not a
 * one-row table.
 *
 * Each figure keeps its own caption ABOVE its own number, which is the
 * arrangement a table's header row cannot produce and the reason the fallback
 * to a table was the wrong answer for this shape.
 *
 * The other half is COMPATIBILITY, and it is what most of these cases are
 * about: a payload with no `figures` at all — a cached response, or a host
 * still on the previous version — still renders exactly the tile it always
 * did, reassembled from the scalar fields that have carried it since FUT-309.
 */
const ONE_MEASURE: ReportRender = {
  kind: 'kpi',
  label: 'Receita',
  value: 1_234_00,
  suppressed: false,
  format: 'brl',
  figures: [{ label: 'Receita', value: 1_234_00, suppressed: false, format: 'brl' }],
  rows: [{ revenueCents: 1_234_00 }],
};

/** The same tile as a host that predates `figures` would send it. */
const LEGACY_PAYLOAD: ReportRender = {
  kind: 'kpi',
  label: 'Receita',
  value: 1_234_00,
  suppressed: false,
  format: 'brl',
  rows: [{ revenueCents: 1_234_00 }],
};

const THREE_MEASURES: ReportRender = {
  kind: 'kpi',
  label: 'Receita',
  value: 1_234_00,
  suppressed: false,
  format: 'brl',
  figures: [
    { label: 'Receita', value: 1_234_00, suppressed: false, format: 'brl' },
    { label: 'Pedidos', value: 42, suppressed: false, format: 'integer' },
    { label: 'Ticket médio', value: 29_38, suppressed: false, format: 'brl' },
  ],
  rows: [{ revenueCents: 1_234_00, orders: 42, ticket: 29_38 }],
};

afterEach(cleanup);

describe('ReportRenderView — a KPI with one measure is unchanged', () => {
  it('renders the single tile under the id consumers already drive', () => {
    render(<ReportRenderView render={ONE_MEASURE} dataTestId="r" />);
    expect(screen.getByTestId('r-kpi')).toBeTruthy();
    // `queryAll…` + `toEqual([])`: the failure message then names what it found
    // instead of saying "not null".
    expect(screen.queryAllByTestId('r-kpi-1')).toEqual([]);
    expect(screen.getByText('Receita')).toBeTruthy();
  });

  it('renders a payload with NO figures identically', () => {
    // The compatibility case: the scalar fields are precisely what one figure
    // means, so the fallback is the same tile reassembled, not a degradation.
    render(<ReportRenderView render={LEGACY_PAYLOAD} dataTestId="r" />);
    expect(screen.getByTestId('r-kpi')).toBeTruthy();
    expect(screen.queryAllByTestId('r-kpi-1')).toEqual([]);
    expect(screen.getByText('Receita')).toBeTruthy();
  });
});

describe('ReportRenderView — a KPI with several measures', () => {
  it('renders one tile per measure, each with its own caption', () => {
    render(<ReportRenderView render={THREE_MEASURES} dataTestId="r" />);
    // A caption above its own figure for every measure — what a one-row table
    // cannot do, and the reason this is a KPI rather than a table.
    expect(screen.getByText('Receita')).toBeTruthy();
    expect(screen.getByText('Pedidos')).toBeTruthy();
    expect(screen.getByText('Ticket médio')).toBeTruthy();
  });

  it('keeps `…-kpi` on the FIRST tile and numbers the rest', () => {
    render(<ReportRenderView render={THREE_MEASURES} dataTestId="r" />);
    expect(screen.getByTestId('r-kpi')).toBeTruthy();
    expect(screen.getByTestId('r-kpi-1')).toBeTruthy();
    expect(screen.getByTestId('r-kpi-2')).toBeTruthy();
  });

  it('draws no table — several figures is not a one-row table', () => {
    render(<ReportRenderView render={THREE_MEASURES} dataTestId="r" />);
    expect(screen.queryAllByTestId('r-table')).toEqual([]);
    expect(screen.queryAllByRole('table')).toEqual([]);
  });

  it('formats each figure in its own format', () => {
    render(<ReportRenderView render={THREE_MEASURES} dataTestId="r" />);
    // 42 as an integer, not as R$ 0,42 — one imposed format would misprint it.
    expect(screen.getByText('42')).toBeTruthy();
  });
});

describe('exportColumnsFor — the download shows the same numbers as the tile', () => {
  const headersOf = (render: ReportRender): string[] =>
    exportColumnsFor(render).map((column) => column.header);

  it('emits one column per figure', () => {
    expect(headersOf(THREE_MEASURES)).toEqual(['Receita', 'Pedidos', 'Ticket médio']);
  });

  it('still emits exactly one column for a single-measure tile', () => {
    expect(headersOf(ONE_MEASURE)).toEqual(['Receita']);
    expect(headersOf(LEGACY_PAYLOAD)).toEqual(['Receita']);
  });

  it('prints each column in its own format', () => {
    const columns = exportColumnsFor(THREE_MEASURES);
    const row: ReportRow = THREE_MEASURES.rows[0] ?? {};
    expect(columns[1]?.value(row)).toBe('42');
  });
});

describe('kpiFigures — the fallback, on its own', () => {
  it('reassembles one figure from the scalar fields when `figures` is absent', () => {
    if (LEGACY_PAYLOAD.kind !== 'kpi') throw new Error('fixture is not a kpi render');
    expect(kpiFigures(LEGACY_PAYLOAD)).toEqual([
      { label: 'Receita', value: 1_234_00, suppressed: false, format: 'brl' },
    ]);
  });

  it('prefers `figures` when the payload carries them', () => {
    if (THREE_MEASURES.kind !== 'kpi') throw new Error('fixture is not a kpi render');
    expect(kpiFigures(THREE_MEASURES)).toHaveLength(3);
  });
});
