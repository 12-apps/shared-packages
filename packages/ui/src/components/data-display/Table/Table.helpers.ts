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
 * The table's one scroll container (FUT-2658): `containerHeight` tall
 * whenever it is set, or 400 when `virtualScrolling` is on and it is not,
 * holding the header and the body. `containerHeight` sizes the scroller with
 * or without `virtualScrolling` (FUT-2677) — no consumer relies on the old
 * virtual-only gate, and `stickyHeader` needs this box to stick inside.
 * Inline, so the height it was given reads back off the element. A
 * `containerHeight` of 0 counts as unset: a zero-height scroller shows nothing.
 */
export const scrollerStyle = (theme: Theme, p: TableProps): React.CSSProperties | undefined =>
  p.virtualScrolling || p.containerHeight
    ? { height: scrollHeight(theme, p.containerHeight), overflow: 'auto' }
    : undefined;

/**
 * With `stickyHeader`, the scroller takes over the rounded clip the `<table>`
 * gives up (`tableStyles`, FUT-2677) — the caller's container owns it on the
 * basic (children) path, and the loading/empty shells get it too, so their
 * corners do not change between states.
 */
export const scrollerRadiusStyle = (
  theme: Theme,
  stickyHeader: boolean | undefined,
): React.CSSProperties | undefined => (stickyHeader ? { borderRadius: theme.spacing(1) } : undefined);

/** `scrollerStyle` and, with `stickyHeader`, the rounded clip it takes over. */
export const containerStyle = (theme: Theme, p: TableProps): React.CSSProperties | undefined => {
  const scroller = scrollerStyle(theme, p);
  const radius = scrollerRadiusStyle(theme, p.stickyHeader);
  return scroller || radius ? { ...scroller, ...radius } : undefined;
};

/**
 * Only a virtualised table needs its header measured — a plain one never
 * reads `scroll.headerPx`, so it gets no `ResizeObserver` either (FUT-2678).
 */
export const headerRefFor = (
  windowHeight: number | undefined,
  headRef: React.RefObject<globalThis.HTMLTableSectionElement | null>,
): React.RefObject<globalThis.HTMLTableSectionElement | null> | undefined =>
  windowHeight ? headRef : undefined;

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
