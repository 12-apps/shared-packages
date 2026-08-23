/**
 * `DataGrid` — the identity of the grid element, in every state it can paint.
 *
 * The regression this file exists for: `data-testid` is destructured out of the
 * props, and used to be re-applied ONLY on the populated render. A grid whose
 * first paint was loading, error or empty therefore had no test id at all — it
 * had mounted perfectly and could not be found, so every spec landing on a
 * screen with no rows yet waited out its whole budget on an element that would
 * appear only once somebody created a row.
 *
 * Each case asserts the id AND the state flag, because the id alone would pass
 * with all four states collapsed into one.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataGrid } from '../components/data-display/DataGrid';
import type { GridColumn } from '../components/data-display/DataGrid/DataGrid.types';

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  qty: number;
}

const columns: GridColumn<Row>[] = [
  { id: 'name', header: 'Nome' },
  { id: 'qty', header: 'Qtd' },
];

const rows: Row[] = [
  { id: 'a', name: 'Alface', qty: 3 },
  { id: 'b', name: 'Beterraba', qty: 1 },
];

describe('DataGrid — the grid is findable in every state', () => {
  it('names the grid while it is LOADING', () => {
    render(<DataGrid emptyText="Nenhum dado por aqui" data-testid="things-grid" rows={[]} columns={columns} loading />);
    const grid = screen.getByTestId('things-grid');
    expect(grid).toHaveAttribute('data-loading', 'true');
    // Still announced as a grid, so assistive tech is not told the region
    // vanished and came back.
    expect(grid).toHaveAttribute('role', 'grid');
  });

  it('names the grid while it is showing an ERROR', () => {
    render(
      <DataGrid emptyText="Nenhum dado por aqui" data-testid="things-grid" rows={rows} columns={columns} error="Deu ruim" />,
    );
    const grid = screen.getByTestId('things-grid');
    expect(grid).toHaveAttribute('data-error', 'true');
    expect(grid).toHaveTextContent('Deu ruim');
  });

  it('names the grid while it is EMPTY — the case every spec tripped over', () => {
    render(<DataGrid emptyText="Nenhum dado por aqui" data-testid="things-grid" rows={[]} columns={columns} />);
    const grid = screen.getByTestId('things-grid');
    expect(grid).toHaveAttribute('data-empty', 'true');
    // What the CALLER passed, not a sentence restated here: `emptyText` is
    // required host copy now, so a suite that spells its own would pass while
    // the wire from the prop to the screen was broken.
    expect(grid).toHaveTextContent('Nenhum dado por aqui');
  });

  it('renders the caller’s own empty state inside that same named grid', () => {
    render(
      <DataGrid emptyText="Nenhum dado por aqui"
        data-testid="things-grid"
        rows={[]}
        columns={columns}
        emptyState={<span>Nada por aqui</span>}
      />,
    );
    expect(screen.getByTestId('things-grid')).toHaveTextContent('Nada por aqui');
  });

  it('names the grid once it HAS rows, and renders them', () => {
    render(<DataGrid emptyText="Nenhum dado por aqui" data-testid="things-grid" rows={rows} columns={columns} />);
    const grid = screen.getByTestId('things-grid');
    // The populated render is the one that always worked; it is asserted so the
    // four cases above cannot all pass by the id being applied unconditionally
    // to a single collapsed placeholder.
    expect(grid).toHaveAttribute('data-ui', 'datagrid');
    expect(grid).not.toHaveAttribute('data-empty');
    expect(screen.getByText('Alface')).toBeInTheDocument();
    expect(screen.getByText('Beterraba')).toBeInTheDocument();
  });

  it('keeps grid-only props off the DOM element', () => {
    render(<DataGrid emptyText="Nenhum dado por aqui" data-testid="things-grid" rows={rows} columns={columns} />);
    const grid = screen.getByTestId('things-grid');
    // `DataGridProps` extends HTMLAttributes, so the rest-spread would otherwise
    // serialize the whole dataset into an attribute.
    expect(grid).not.toHaveAttribute('rows');
    expect(grid).not.toHaveAttribute('columns');
  });
});

describe('DataGrid — client-mode rows', () => {
  it('sorts on a header press when sorting is client-mode', () => {
    render(
      <DataGrid emptyText="Nenhum dado por aqui"
        data-testid="things-grid"
        rows={rows}
        columns={columns}
        sorting={{ mode: 'client', defaultSortBy: [{ id: 'name', dir: 'desc' }] }}
      />,
    );
    const cells = screen.getAllByRole('gridcell').map((cell) => cell.textContent);
    // Descending by name: Beterraba before Alface. A comparator that stringified
    // its way to a stable-but-wrong order would fail here.
    expect(cells[0]).toBe('Beterraba');
  });

  it('filters client-side and falls through to the empty state when nothing matches', () => {
    render(
      <DataGrid emptyText="Nenhum dado por aqui"
        data-testid="things-grid"
        rows={rows}
        columns={columns}
        filtering={{ mode: 'client', defaultFilters: [{ id: 'name', value: 'zzz' }] }}
      />,
    );
    // The filter emptied the grid — and the grid is STILL findable, which is the
    // whole point: an empty result is a state, not a disappearance.
    expect(screen.getByTestId('things-grid')).toHaveAttribute('data-empty', 'true');
  });
});
