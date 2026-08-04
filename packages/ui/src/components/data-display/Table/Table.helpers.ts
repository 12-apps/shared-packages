import type { TableProps } from './Table.types';

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
  rowHeight: 52,
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
