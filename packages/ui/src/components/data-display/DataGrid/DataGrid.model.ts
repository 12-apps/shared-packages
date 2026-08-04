/**
 * The DataGrid's STATE, in one hook.
 *
 * The component used to hold all of it inline, which made its body 700 lines
 * long and put the row pipeline, the virtualization window and the JSX in one
 * scope where any of them could reach any other. Split out, each piece is a
 * hook with named inputs and the render is left with nothing to do but render.
 *
 * Controlled/uncontrolled is resolved in ONE place per feature: a caller that
 * passes `sorting.sortBy` owns the sort, and a caller that does not gets the
 * internal state — the component never holds a second, divergent copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

import { processRows } from './DataGrid.rows';
import type {
  DataGridProps,
  GridColumn,
  GridFilter,
  GridSort,
  SortDirection,
} from './DataGrid.types';

const DEFAULT_ROW_HEIGHT = 52;
const DEFAULT_PAGE_SIZE = 50;
/** Rows rendered on either side of the window, so a fast scroll stays filled. */
const OVERSCAN_COUNT = 20;
/** Below this many rows, virtualization costs more than it saves. */
const VIRTUALIZATION_THRESHOLD = 100;
/** The initial (and reset) window size, before a scroll has measured anything. */
const INITIAL_WINDOW = 50;
/** Re-window only past this much drift, so a scroll is not one setState per pixel. */
const WINDOW_DRIFT = 5;

/** Which id is being edited, or `null`. */
export interface EditingCell {
  rowId: string | number;
  colId: string;
}

/** The visible slice of a virtualized body. */
export interface VisibleRange {
  start: number;
  end: number;
}

/** Everything the render needs, and nothing it has to derive. */
export interface DataGridModel<T extends Record<string, unknown>> {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rowHeight: number;
  visibleColumns: GridColumn<T>[];
  processedRows: T[];
  visibleRows: T[];
  visibleRange: VisibleRange;
  virtualized: boolean;
  sortBy: readonly GridSort[];
  selectedRowIds: Array<string | number>;
  selectedRowIdsSet: ReadonlySet<string | number>;
  expandedRowIdsSet: ReadonlySet<string | number>;
  editingCell: EditingCell | null;
  setEditingCell: (cell: EditingCell | null) => void;
  setSelectedRowIds: (ids: Array<string | number>) => void;
  onSort: (columnId: string) => void;
  onToggleRow: (rowId: string | number, isSelected: boolean) => void;
  onToggleExpansion: (rowId: string | number) => void;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
}

/** The row height a density implies. */
function densityHeight(base: number, density: DataGridProps['density']): number {
  if (density === 'compact') return Math.max(base * 0.8, 32);
  if (density === 'spacious') return base * 1.2;
  return base;
}

/** The rows this render should show, with every client-mode step resolved. */
function useProcessedRows<T extends Record<string, unknown>>(
  props: DataGridProps<T>,
  columnMap: ReadonlyMap<string, GridColumn<T>>,
  sortBy: readonly GridSort[],
  filters: readonly GridFilter[],
): T[] {
  const { rows, filtering = {}, sorting = {}, pagination, virtualizeRows = true } = props;
  const pageIndex = pagination?.pageIndex ?? 0;
  const pageSize = pagination?.pageSize ?? DEFAULT_PAGE_SIZE;
  return useMemo(
    () =>
      processRows({
        rows,
        columnMap,
        filters,
        sortBy,
        needsFiltering: filtering.mode === 'client' && filters.length > 0,
        needsSorting: sorting.mode === 'client' && sortBy.length > 0,
        // Virtualization already slices; doing both would page a page.
        needsPagination: pagination?.mode === 'client' && !virtualizeRows,
        pageIndex,
        pageSize,
      }),
    [
      rows,
      columnMap,
      filters,
      sortBy,
      filtering.mode,
      sorting.mode,
      pagination?.mode,
      virtualizeRows,
      pageIndex,
      pageSize,
    ],
  );
}

/**
 * The virtualization window and the scroll handler that moves it.
 *
 * Throttled through `requestAnimationFrame`, and only committed once the window
 * has drifted meaningfully — a `setState` per scroll event re-renders every
 * visible row for a movement the eye cannot see.
 */
function useRowWindow(
  rowCount: number,
  rowHeight: number,
  enabled: boolean,
): { range: VisibleRange; onScroll: (event: React.UIEvent<HTMLDivElement>) => void } {
  const [range, setRange] = useState<VisibleRange>({ start: 0, end: INITIAL_WINDOW });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rowCount < range.end) setRange({ start: 0, end: Math.min(INITIAL_WINDOW, rowCount) });
  }, [rowCount, range.end]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const { scrollTop, clientHeight } = event.currentTarget;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = window.requestAnimationFrame(() => {
        const first = Math.floor(scrollTop / rowHeight);
        const visible = Math.ceil(clientHeight / rowHeight);
        const start = Math.max(0, first - OVERSCAN_COUNT);
        const end = Math.min(first + visible + OVERSCAN_COUNT, rowCount);
        setRange((current) =>
          Math.abs(start - current.start) > WINDOW_DRIFT ||
          Math.abs(end - current.end) > WINDOW_DRIFT
            ? { start, end }
            : current,
        );
        rafRef.current = null;
      });
    },
    [enabled, rowHeight, rowCount],
  );

  return { range, onScroll };
}

/** The next `sortBy` for a header press: asc → desc → unsorted. */
function nextSortBy(current: readonly GridSort[], columnId: string): GridSort[] {
  const existing = current.find((sort) => sort.id === columnId);
  let dir: SortDirection = 'asc';
  if (existing?.dir === 'asc') dir = 'desc';
  else if (existing?.dir === 'desc') dir = null;
  return dir ? [{ id: columnId, dir }] : current.filter((sort) => sort.id !== columnId);
}

/** Selection + expansion, each resolved once against its controlled prop. */
function useRowFlags<T extends Record<string, unknown>>(
  props: DataGridProps<T>,
): Pick<
  DataGridModel<T>,
  | 'selectedRowIds'
  | 'selectedRowIdsSet'
  | 'expandedRowIdsSet'
  | 'setSelectedRowIds'
  | 'onToggleRow'
  | 'onToggleExpansion'
> {
  const { selection = { mode: 'none' }, expansion } = props;
  const [internalSelected, setInternalSelected] = useState(selection.defaultSelectedRowIds ?? []);
  const [internalExpanded, setInternalExpanded] = useState(expansion?.defaultExpandedRowIds ?? []);
  const selectedRowIds = selection.selectedRowIds ?? internalSelected;
  const expandedRowIds = expansion?.expandedRowIds ?? internalExpanded;

  const commitSelected = useCallback(
    (ids: Array<string | number>) => {
      if (selection.onChangeSelected) selection.onChangeSelected(ids);
      else setInternalSelected(ids);
    },
    [selection],
  );

  return {
    selectedRowIds,
    selectedRowIdsSet: useMemo(() => new Set(selectedRowIds), [selectedRowIds]),
    expandedRowIdsSet: useMemo(() => new Set(expandedRowIds), [expandedRowIds]),
    setSelectedRowIds: commitSelected,
    onToggleRow: (rowId, isSelected) => {
      if (selection.mode === 'single') commitSelected(isSelected ? [rowId] : []);
      else if (selection.mode === 'multi') {
        commitSelected(
          isSelected
            ? [...selectedRowIds, rowId]
            : selectedRowIds.filter((id) => id !== rowId),
        );
      }
    },
    onToggleExpansion: (rowId) => {
      if (!expansion) return;
      const next = expandedRowIds.includes(rowId)
        ? expandedRowIds.filter((id) => id !== rowId)
        : [...expandedRowIds, rowId];
      if (expansion.onChangeExpanded) expansion.onChangeExpanded(next);
      else setInternalExpanded(next);
    },
  };
}

/**
 * A header press, routed to whoever owns the sort: the server (which must
 * re-query — sorting the current page locally would reorder one page of a
 * dataset and call it sorted), the caller's `onChangeSortBy`, or internal state.
 */
function useSortHandler<T extends Record<string, unknown>>(
  props: DataGridProps<T>,
  sortBy: readonly GridSort[],
  filters: readonly GridFilter[],
  setInternalSortBy: (next: GridSort[]) => void,
): (columnId: string) => void {
  const { sorting = {}, pagination, onRequestData } = props;
  return useCallback(
    (columnId: string) => {
      const next = nextSortBy(sortBy, columnId);
      if (sorting.mode === 'server' && onRequestData) {
        onRequestData({
          pageIndex: pagination?.pageIndex ?? 0,
          pageSize: pagination?.pageSize ?? DEFAULT_PAGE_SIZE,
          sortBy: next,
          filters: [...filters],
        });
        return;
      }
      if (sorting.onChangeSortBy) sorting.onChangeSortBy(next);
      else setInternalSortBy(next);
    },
    [sortBy, sorting, onRequestData, pagination, filters, setInternalSortBy],
  );
}

/**
 * Sort and filter, each resolved ONCE against its controlled prop: a caller
 * that passes `sorting.sortBy` owns the sort, and one that does not gets the
 * internal state. The grid never holds a second, divergent copy.
 */
function useSortAndFilter<T extends Record<string, unknown>>(
  props: DataGridProps<T>,
): {
  sortBy: readonly GridSort[];
  filters: readonly GridFilter[];
  setInternalSortBy: (next: GridSort[]) => void;
} {
  const { sorting = {}, filtering = {} } = props;
  const [internalSortBy, setInternalSortBy] = useState<GridSort[]>(sorting.defaultSortBy ?? []);
  const [internalFilters] = useState<GridFilter[]>(filtering.defaultFilters ?? []);
  return {
    sortBy: sorting.sortBy ?? internalSortBy,
    filters: filtering.filters ?? internalFilters,
    setInternalSortBy,
  };
}

export function useDataGridModel<T extends Record<string, unknown>>(
  props: DataGridProps<T>,
): DataGridModel<T> {
  const { columns } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const { sortBy, filters, setInternalSortBy } = useSortAndFilter(props);
  const rowHeight = densityHeight(props.rowHeight ?? DEFAULT_ROW_HEIGHT, props.density);
  const columnMap = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const visibleColumns = useMemo(() => columns.filter((column) => !column.hidden), [columns]);
  const processedRows = useProcessedRows(props, columnMap, sortBy, filters);
  const virtualized =
    (props.virtualizeRows ?? true) && processedRows.length > VIRTUALIZATION_THRESHOLD;
  const { range, onScroll } = useRowWindow(processedRows.length, rowHeight, virtualized);
  const onSort = useSortHandler(props, sortBy, filters, setInternalSortBy);

  return {
    containerRef,
    rowHeight,
    visibleColumns,
    processedRows,
    visibleRows: virtualized ? processedRows.slice(range.start, range.end) : processedRows,
    visibleRange: range,
    virtualized,
    sortBy,
    editingCell,
    setEditingCell,
    onSort,
    onScroll,
    ...useRowFlags(props),
  };
}
