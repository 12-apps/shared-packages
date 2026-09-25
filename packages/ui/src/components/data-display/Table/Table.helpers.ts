import type { TableProps as MuiTableProps } from '@mui/material/Table/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import type React from 'react';

import { rem } from '../../../tokens/relative';

import type { TableProps } from './Table.types';

/**
 * A virtualised row's height in design px: the caller's `rowHeight`, else 52.
 * Resolved here rather than in {@link TABLE_DEFAULTS} so the one number is read
 * where it is drawn (`rem`) and where the window is positioned with it (`remPx`).
 */
export const tableRowHeight = (rowHeight: number | undefined): number => rowHeight ?? 52;

/** The scroll box's height: a number is design px, 400 unless the caller says otherwise. */
const scrollHeight = (theme: Theme, containerHeight: number | string | undefined): string => {
  const box = containerHeight || 400;
  return typeof box === 'number' ? rem(theme, box) : box;
};

/**
 * The table's one scroll container (FUT-2658): `containerHeight` tall when
 * `virtualScrolling` is on, holding the header and the body. Inline, so the
 * height it was given reads back off the element.
 */
export const scrollerStyle = (theme: Theme, p: TableProps): React.CSSProperties | undefined =>
  p.virtualScrolling ? { height: scrollHeight(theme, p.containerHeight), overflow: 'auto' } : undefined;

/**
 * The window's height in design px when the body is virtualised — only a
 * numeric `containerHeight` virtualises; a string sizes the scroller alone.
 */
export const virtualHeight = (p: TableProps): number | undefined =>
  p.virtualScrolling && typeof p.containerHeight === 'number' && p.containerHeight > 0 &&
  tableRowHeight(p.rowHeight) > 0
    ? p.containerHeight
    : undefined;

export const TABLE_DEFAULTS: Partial<TableProps> = {
  variant: 'default',
  stripeColor: 'neutral',
  glow: false,
  pulse: false,
  hoverable: false,
  loading: false,
  density: 'normal',
  stickyHeader: false,
  selectable: false,
  selectedRows: [],
  sortable: false,
  virtualScrolling: false,
  overscan: 5,
  responsive: false,
  showColumnToggle: true,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default as a destructuring default would. Eighteen separate
// destructuring defaults were most of this component's branch count.
export const definedProps = (props: TableProps): Partial<TableProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<TableProps>;

// The container + styled table + optional header, shared by the loading, empty
// and populated renders.

/** A key `Table` declares on top of MUI's own `TableProps`. */
type TableOwnKey = Exclude<keyof TableProps, keyof MuiTableProps>;

/**
 * Every key {@link TableOwnKey} names. None is an HTML attribute: each is read
 * by the table and drawn by its parts, so none may reach the `<table>`
 * (FUT-2658). A `Record` over the key union makes the list exhaustive — a prop
 * added to `Table.types.ts` does not compile until it is named here.
 */
const TABLE_OWN_KEYS: Record<TableOwnKey, true> = {
  emptyText: true,
  variant: true,
  stripeColor: true,
  glow: true,
  pulse: true,
  hoverable: true,
  loading: true,
  onRowClick: true,
  onRowFocus: true,
  onRowBlur: true,
  density: true,
  selectable: true,
  selectedRows: true,
  onSelectionChange: true,
  rowKeyExtractor: true,
  sortable: true,
  sortConfig: true,
  onSortChange: true,
  filterable: true,
  filterConfig: true,
  onFilterChange: true,
  columns: true,
  data: true,
  virtualScrolling: true,
  rowHeight: true,
  overscan: true,
  responsive: true,
  columnPriorities: true,
  responsiveBreakpoints: true,
  showColumnToggle: true,
  containerHeight: true,
  loadingComponent: true,
  emptyStateComponent: true,
  keyboardNavigation: true,
  renderRow: true,
  renderCell: true,
  draggableRows: true,
  onRowsReorder: true,
  fixedColumns: true,
  rowStyleConfig: true,
};

const NOT_FORWARDED = new Set<string>([...Object.keys(TABLE_OWN_KEYS), 'children']);

/**
 * What the caller passed that is MUI's or the DOM's — `className`, `id`,
 * `style`, `aria-*`, `data-*`, DOM handlers, `sx`, `size`, `padding`,
 * `component` — for `MuiTable` to spread onto the `<table>`. `children` is
 * placed by the table itself.
 */
export const tableDomProps = (props: TableProps): Record<string, unknown> =>
  Object.fromEntries(Object.entries(props).filter(([key]) => !NOT_FORWARDED.has(key)));
