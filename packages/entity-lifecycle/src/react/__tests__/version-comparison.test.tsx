// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { VersionComparisonWire, VersionsWire } from '../api';
import { createWebEntityLifecycle } from '../create-web-entity-lifecycle';
import type { LifecycleResult, LifecycleTransport } from '../transport';
import { formatCellValue } from '../version-comparison-panel';

/**
 * The comparison panel behind a clicked history row (FUT-247).
 *
 * What this pins is the CONTRACT: which URL a click asks for, which columns
 * and rows reach the table, and that the panel leads with the differences.
 * The comparison arithmetic itself is proven in `__tests__/comparison.test.ts`
 * against the store — these fixtures are what that arithmetic RETURNS.
 */

afterEach(cleanup);

const API_BASE = '/api/admin/loja';

function versionRow(version: number, changedFields: string[]) {
  return {
    version,
    kind: version === 1 ? ('CREATE' as const) : ('UPDATE' as const),
    actorId: 'u1',
    actorName: 'Ana',
    createdAt: new Date('2026-08-01T12:00:00Z').toISOString(),
    changedFields,
    removedFields: [],
    restoredFromVersion: null,
  };
}

function column(version: number, roles: VersionComparisonWire['columns'][number]['roles']) {
  return {
    version,
    roles,
    kind: version === 1 ? ('CREATE' as const) : ('UPDATE' as const),
    actorId: 'u1',
    actorName: 'Ana',
    createdAt: new Date('2026-08-01T12:00:00Z').toISOString(),
  };
}

function cell(version: number, value: unknown, present = true) {
  return { version, present, value } as VersionComparisonWire['rows'][number]['cells'][number];
}

/** A v1..v4 history whose v2 comparison shows all four roles as four columns. */
function fourVersionPayloads(): { list: VersionsWire; comparison: VersionsWire } {
  const versions = [
    versionRow(4, ['priceCents']),
    versionRow(3, ['name']),
    versionRow(2, ['priceCents']),
    versionRow(1, []),
  ];
  const comparison: VersionComparisonWire = {
    selectedVersion: 2,
    columns: [
      column(1, ['previous']),
      column(2, ['selected']),
      column(3, ['next']),
      column(4, ['current']),
    ],
    rows: [
      {
        field: 'name',
        changed: true,
        cells: [cell(1, 'Coca'), cell(2, 'Coca'), cell(3, 'Coca Zero'), cell(4, 'Coca Zero')],
      },
      {
        field: 'priceCents',
        changed: true,
        cells: [cell(1, 500), cell(2, 700), cell(3, 700), cell(4, 900)],
      },
      {
        field: 'sku',
        changed: false,
        cells: [cell(1, 'C1'), cell(2, 'C1'), cell(3, 'C1'), cell(4, 'C1')],
      },
    ],
  };
  return {
    list: { versions, publishedVersion: 4 },
    comparison: { versions, publishedVersion: 4, comparison },
  };
}

/**
 * A transport that answers the history URL and its `?compare=` twin from two
 * separate fixtures — so a test can assert WHICH of the two a click asked for.
 */
function fakeTransport(payloads: { list: VersionsWire; comparison: VersionsWire }): {
  transport: LifecycleTransport;
  paths: string[];
} {
  const paths: string[] = [];
  return {
    paths,
    transport: {
      async get<T>(url: string): Promise<T> {
        paths.push(url);
        const payload = url.includes('compare=') ? payloads.comparison : payloads.list;
        return { data: payload } as T;
      },
      async send<T>(): Promise<LifecycleResult<T>> {
        return { ok: true, data: undefined } as LifecycleResult<T>;
      },
    },
  };
}

function renderDialog(payloads: { list: VersionsWire; comparison: VersionsWire }) {
  const { transport, paths } = fakeTransport(payloads);
  const { VersionHistoryDialog } = createWebEntityLifecycle({ apiBase: API_BASE, transport });
  render(
    <VersionHistoryDialog
      resourcePath="products/p1"
      itemLabel="Coca Lata"
      open
      onClose={() => undefined}
    />,
  );
  return { paths };
}

describe('clicking a version row', () => {
  it('asks the history endpoint to compare that version, and shows the panel', async () => {
    const { paths } = renderDialog(fourVersionPayloads());
    await waitFor(() => expect(screen.getByTestId('version-row-2')).toBeTruthy());

    fireEvent.click(screen.getByTestId('version-row-2'));

    await waitFor(() => expect(screen.getByTestId('version-comparison')).toBeTruthy());
    expect(paths).toEqual([
      `${API_BASE}/products/p1/versions`,
      `${API_BASE}/products/p1/versions?compare=2`,
    ]);
  });

  it('lines the four roles up as four columns, oldest first', async () => {
    renderDialog(fourVersionPayloads());
    await waitFor(() => expect(screen.getByTestId('version-row-2')).toBeTruthy());

    fireEvent.click(screen.getByTestId('version-row-2'));

    await waitFor(() => expect(screen.getByTestId('comparison-column-1')).toBeTruthy());
    expect(screen.getByTestId('comparison-column-1').textContent).toContain('Anterior');
    expect(screen.getByTestId('comparison-column-2').textContent).toContain('Selecionada');
    expect(screen.getByTestId('comparison-column-3').textContent).toContain('Seguinte');
    expect(screen.getByTestId('comparison-column-4').textContent).toContain('Atual');
  });

  it('shows the changed fields with their value in every column', async () => {
    renderDialog(fourVersionPayloads());
    await waitFor(() => expect(screen.getByTestId('version-row-2')).toBeTruthy());

    fireEvent.click(screen.getByTestId('version-row-2'));

    await waitFor(() => expect(screen.getByTestId('comparison-row-priceCents')).toBeTruthy());
    expect(screen.getByTestId('comparison-cell-priceCents-1').textContent).toBe('500');
    expect(screen.getByTestId('comparison-cell-priceCents-2').textContent).toBe('700');
    expect(screen.getByTestId('comparison-cell-priceCents-4').textContent).toBe('900');
    // An unchanged field is not a difference — the panel is opened to see what
    // moved, and a product carries far more fields than it changes.
    await waitFor(() => expect(screen.queryByTestId('comparison-row-sku')).toBeNull());
  });

  it('closes the panel when the same row is clicked again', async () => {
    renderDialog(fourVersionPayloads());
    await waitFor(() => expect(screen.getByTestId('version-row-2')).toBeTruthy());
    fireEvent.click(screen.getByTestId('version-row-2'));
    await waitFor(() => expect(screen.getByTestId('version-comparison')).toBeTruthy());

    fireEvent.click(screen.getByTestId('version-row-2'));

    await waitFor(() => expect(screen.queryByTestId('version-comparison')).toBeNull());
  });

  it('does not open the panel when the row’s Restaurar button is clicked', async () => {
    renderDialog(fourVersionPayloads());
    await waitFor(() => expect(screen.getByTestId('version-restore-2')).toBeTruthy());

    fireEvent.click(screen.getByTestId('version-restore-2'));

    await waitFor(() => expect(screen.getByTestId('version-restore-confirm')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('version-comparison')).toBeNull());
  });
});

describe('a record with a single version', () => {
  it('says there is nothing to compare, and lists every field instead', async () => {
    const versions = [versionRow(1, [])];
    const comparison: VersionComparisonWire = {
      selectedVersion: 1,
      columns: [column(1, ['selected', 'current'])],
      rows: [
        { field: 'name', changed: false, cells: [cell(1, 'Coca')] },
        { field: 'priceCents', changed: false, cells: [cell(1, 500)] },
      ],
    };
    renderDialog({
      list: { versions, publishedVersion: 1 },
      comparison: { versions, publishedVersion: 1, comparison },
    });
    await waitFor(() => expect(screen.getByTestId('version-row-1')).toBeTruthy());

    fireEvent.click(screen.getByTestId('version-row-1'));

    await waitFor(() => expect(screen.getByTestId('comparison-single')).toBeTruthy());
    expect(screen.getByTestId('comparison-single').textContent).toContain(
      'não há outra para comparar',
    );
    // Nothing is `changed` here, so the changed-only filter would empty the
    // table — the one version's own fields are what there is to show.
    expect(screen.getByTestId('comparison-row-name')).toBeTruthy();
    expect(screen.getByTestId('comparison-column-1').textContent).toContain('Selecionada');
    expect(screen.getByTestId('comparison-column-1').textContent).toContain('Atual');
  });
});

describe('value rendering', () => {
  it('tells a missing field apart from an empty one', () => {
    expect(formatCellValue(cell(1, null, false))).toBe('—');
    expect(formatCellValue(cell(1, null))).toBe('vazio');
    expect(formatCellValue(cell(1, ''))).toBe('vazio');
  });

  it('renders booleans, numbers and nested values readably', () => {
    expect(formatCellValue(cell(1, true))).toBe('Sim');
    expect(formatCellValue(cell(1, false))).toBe('Não');
    expect(formatCellValue(cell(1, 0))).toBe('0');
    expect(formatCellValue(cell(1, ['a', 'b']))).toBe('["a","b"]');
  });
});
