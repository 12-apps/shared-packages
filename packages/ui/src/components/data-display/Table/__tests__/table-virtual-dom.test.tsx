/**
 * A VIRTUALISED TABLE IS A VALID TABLE WITH ONE SCROLLER (FUT-2658).
 *
 * The virtual body used to wrap its `<tbody>` in a scrolling `<div>` inside the
 * `<table>` — invalid DOM that CSS lays out as a second, anonymous table in one
 * cell — and sat inside a second scroller of the same height. And every prop
 * `Table` declares for itself was spread onto the `<table>` as an attribute.
 *
 * Now the `<tbody>` is the `<table>`'s own child, the one scroll container is
 * the element around the `<table>` (header included), and its offset drives
 * the window with the header's height subtracted. jsdom does not lay out, so
 * the header's height is stubbed where the offset maths needs it.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { remPx } from '../../../../tokens/relative';
import { Table } from '../Table';
import type { ColumnConfig, TableProps } from '../Table.types';

const theme = createTheme();
const PITCH = remPx(theme, 52);

const columns: ColumnConfig[] = [{ key: 'name', label: 'Nome' }];
const data = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `row-${i}` }));

/**
 * Every key `Table` declares for itself, set to a value React would write as an
 * attribute if it reached the `<table>` — lowercased, as the DOM reports them.
 */
const OWN_ATTRIBUTES = [
  'emptytext',
  'variant',
  'stripecolor',
  'virtualscrolling',
  'rowheight',
  'overscan',
  'containerheight',
  'selectedrows',
  'sortable',
  'selectable',
  'showcolumntoggle',
  'columnpriorities',
  'onrowclick',
  'onsortchange',
  'renderrow',
  'rendercell',
  'responsive',
  'density',
  'hoverable',
  'loading',
  'columns',
  'data',
];

const ownProps: Partial<TableProps> = {
  variant: 'striped',
  stripeColor: 'primary',
  rowHeight: 52,
  overscan: 0,
  selectedRows: [1],
  sortable: true,
  selectable: true,
  showColumnToggle: true,
  columnPriorities: [1],
  onRowClick: vi.fn(),
  onSortChange: vi.fn(),
  hoverable: true,
  density: 'normal',
};

/** What MUI and the DOM own, and must still reach the `<table>`. */
const passThrough = {
  id: 'orders',
  className: 'orders-table',
  'aria-label': 'Pedidos',
  'data-testid': 'orders',
  size: 'small',
} as const;

function renderTable(props: Partial<TableProps>) {
  return render(
    <ThemeProvider theme={theme}>
      <Table emptyText="Nenhum dado" {...ownProps} {...passThrough} {...props} />
    </ThemeProvider>,
  );
}

const renderVirtual = () =>
  renderTable({ columns, data, virtualScrolling: true, containerHeight: 400 });

/** The mounted data rows, in DOM order. */
const dataRows = (): HTMLElement[] =>
  screen.getAllByRole('row').filter((row) => /^row-\d+$/.test(row.textContent ?? ''));

/** The attributes on the `<table>` that name one of `Table`'s own props. */
const ownAttributesOn = (table: HTMLElement): string[] =>
  table.getAttributeNames().filter((name) => OWN_ATTRIBUTES.includes(name));

describe('Table (virtual scrolling) DOM', () => {
  it('puts the <tbody> directly in the <table>, with nothing between them', () => {
    renderVirtual();
    const table = screen.getByRole('table');
    const tbody = dataRows()[0]!.closest('tbody')!;

    expect(tbody.parentElement).toBe(table);
    expect(Array.from(table.children, (child) => child.tagName)).toEqual(['THEAD', 'TBODY']);
  });

  it('scrolls in one container around the <table>, holding the header and the body', () => {
    renderVirtual();
    const table = screen.getByRole('table');
    const scroller = table.parentElement!;

    expect(scroller.style.overflow).toBe('auto');
    expect(scroller).toContainElement(table.querySelector('thead'));
    expect(scroller).toContainElement(table.querySelector('tbody'));
    const innerScrollers = Array.from(table.querySelectorAll<HTMLElement>('*')).filter(
      (element) => element.style.overflow === 'auto',
    );
    expect(innerScrollers).toEqual([]);

    act(() => {
      fireEvent.scroll(scroller, { target: { scrollTop: 100 * PITCH + 1 } });
    });
    expect(dataRows()[0]).toHaveTextContent('row-100');
  });

  it("subtracts the header's height from scrollTop before picking the window", () => {
    renderVirtual();
    const table = screen.getByRole('table');
    const scroller = table.parentElement!;
    Object.defineProperty(table.querySelector('thead')!, 'offsetHeight', {
      configurable: true,
      value: 56,
    });

    act(() => {
      fireEvent.scroll(scroller, { target: { scrollTop: 56 + 100 * PITCH + 1 } });
    });
    const first = dataRows()[0]!;
    expect(first).toHaveTextContent('row-100');
    expect(first.style.transform).toBe(`translateY(${theme.typography.pxToRem(100 * 52)})`);

    act(() => {
      fireEvent.scroll(scroller, { target: { scrollTop: 40 } });
    });
    expect(dataRows()[0]).toHaveTextContent('row-0');
  });
});

describe('Table props on the DOM', () => {
  it.each([
    ['virtualised', { columns, data, virtualScrolling: true, containerHeight: 400 }],
    ['plain', { columns, data }],
    ['loading', { columns, data, loading: true }],
    ['empty', { columns, data: [] }],
    [
      'basic',
      {
        children: (
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        ),
      },
    ],
  ] as const)('writes none of its own props on the %s <table>', (_, props) => {
    renderTable(props as Partial<TableProps>);
    const table = screen.getByRole('table');

    expect(ownAttributesOn(table)).toEqual([]);
  });

  it.each([
    ['virtualised', { columns, data, virtualScrolling: true, containerHeight: 400 }],
    ['loading', { columns, data, loading: true }],
    ['basic', {}],
  ] as const)("still passes MUI's and the DOM's props to the %s <table>", (_, props) => {
    renderTable(props as Partial<TableProps>);
    const table = screen.getByTestId('orders');

    expect(table.tagName).toBe('TABLE');
    expect(table).toHaveAttribute('id', 'orders');
    expect(table).toHaveAttribute('aria-label', 'Pedidos');
    expect(table).toHaveClass('orders-table', 'MuiTable-root');
  });
});
