import MoreVertIcon from '@mui/icons-material/MoreVert';
import Box from '@mui/material/Box/index.js';
import FormControlLabel from '@mui/material/FormControlLabel/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Menu from '@mui/material/Menu/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import Skeleton from '@mui/material/Skeleton/index.js';
import Switch from '@mui/material/Switch/index.js';
import MuiTable from '@mui/material/Table/index.js';
import TableBody from '@mui/material/TableBody/index.js';
import TableCell from '@mui/material/TableCell/index.js';
import TableContainer from '@mui/material/TableContainer/index.js';
import TableRow from '@mui/material/TableRow/index.js';
import { styled, useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import type {
  ColumnConfig,
  TableDensity,
  TableProps,
  TableStripeColor} from './Table.types';
import {
  TABLE_DEFAULTS,
  definedProps,
  scrollerStyle,
  tableDomProps,
  tableRowHeight,
  virtualHeight,
} from './Table.helpers';
import { useTableSelection, useVirtualScrolling } from './Table.hooks';
import { EnhancedTableBody, EnhancedTableHeader } from './TableParts';
import { EmptyRow, NoDataPlaceholder } from './TableStates';
import {
  tableStyles } from './Table.styles';
import { rem } from '../../../tokens/relative';

// Helper function to get stripe color from theme
const StyledTable = styled(MuiTable, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'glow', 'pulse', 'hoverable', 'density', 'stickyHeader', 'stripeColor', 'virtualised'].includes(prop as string) })<{
  customVariant?: string;
  glow?: boolean;
  pulse?: boolean;
  hoverable?: boolean;
  density?: TableDensity;
  stickyHeader?: boolean;
  stripeColor?: TableStripeColor;
  virtualised?: boolean;
}>(({ theme, customVariant, glow, pulse, hoverable, density, stickyHeader, stripeColor = 'neutral', virtualised }) => {
  return tableStyles({
    theme,
    customVariant,
    glow,
    pulse,
    hoverable,
    density,
    stickyHeader,
    stripeColor,
    virtualised });
});

// Virtual Scrolling Hook
const TableShell: React.FC<{
  innerRef: React.Ref<globalThis.HTMLTableElement>;
  variant?: string;
  stripeColor?: TableStripeColor;
  glow?: boolean;
  pulse?: boolean;
  hoverable?: boolean;
  density?: TableDensity;
  stickyHeader?: boolean;
  header: React.ReactNode;
  rest: Record<string, unknown>;
  children: React.ReactNode;
}> = ({
  innerRef,
  variant,
  stripeColor,
  glow,
  pulse,
  hoverable,
  density,
  stickyHeader,
  header,
  rest,
  children }) => (
  <TableContainer>
    <StyledTable
      ref={innerRef}
      customVariant={variant}
      stripeColor={stripeColor}
      glow={glow}
      pulse={pulse}
      hoverable={hoverable}
      density={density}
      stickyHeader={stickyHeader}
      {...rest}
    >
      {header}
      {children}
    </StyledTable>
  </TableContainer>
);

const SKELETON_ROW_COUNT = 5;

const LoadingSkeletonRows: React.FC<{ columns?: ColumnConfig[] }> = ({ columns }) => {
  const theme = useTheme();
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <TableRow key={index}>
          {columns?.map((column) => (
            <TableCell key={column.key}>
              <Skeleton height={rem(theme, 20)} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
};

export type TableShellProps = Omit<React.ComponentProps<typeof TableShell>, 'children'>;

type Selection = ReturnType<typeof useTableSelection>;

interface RendererProps {
  resolved: TableProps;
  selection: Selection;
  innerRef: React.Ref<globalThis.HTMLTableElement>;
  rest: Record<string, unknown>;
}

// The column-visibility control, shown only when responsive mode has actually
// hidden something on a narrow viewport.
const ColumnToggleMenu: React.FC<{
  columns: ColumnConfig[];
  hiddenColumns: number[];
  anchor: HTMLElement | null;
  setAnchor: (element: HTMLElement | null) => void;
  setHiddenColumns: (next: number[]) => void;
}> = ({ columns, hiddenColumns, anchor, setAnchor, setHiddenColumns }) => (
  <Box position="absolute" top={8} right={8}>
    <IconButton onClick={(event) => setAnchor(event.currentTarget)} size="small">
      <MoreVertIcon />
    </IconButton>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      {columns.map((column, index) => (
        <MenuItem key={column.key}>
          <FormControlLabel
            control={
              <Switch
                checked={!hiddenColumns.includes(index)}
                onChange={(event) =>
                  setHiddenColumns(
                    event.target.checked
                      ? hiddenColumns.filter((i: number) => i !== index)
                      : [...hiddenColumns, index],
                  )
                }
                size="small"
              />
            }
            label={column.label}
          />
        </MenuItem>
      ))}
    </Menu>
  </Box>
);

// The populated table. Local because StyledTable cannot cross a module
// boundary (TS2742).
const columnsFor = (resolved: TableProps, selection: Selection): ColumnConfig[] =>
  (resolved.responsive ? selection.visibleColumns : resolved.columns) ?? [];

// The toggle only earns its place when responsive mode has actually hidden
// something on a narrow viewport.
const showsColumnToggle = (resolved: TableProps, selection: Selection): boolean =>
  Boolean(
    resolved.responsive &&
      selection.isMobile &&
      resolved.showColumnToggle &&
      selection.hiddenColumns.length > 0,
  );

// The virtual window lives here, with the one scroller whose offset drives it;
// the header's ref lets it subtract the height the `<thead>` pushes the body down.
const AdvancedTable: React.FC<RendererProps> = ({ resolved: p, selection, innerRef, rest }) => {
  const theme = useTheme();
  const finalColumns = columnsFor(p, selection);
  const showToggle = showsColumnToggle(p, selection);
  const headRef = React.useRef<globalThis.HTMLTableSectionElement>(null);
  const windowHeight = virtualHeight(p);
  const { visibleItems, handleScroll } = useVirtualScrolling(
    p.data ?? [],
    tableRowHeight(p.rowHeight) || 40,
    windowHeight ?? 400,
    p.overscan,
    headRef,
  );

  return (
    <Box position="relative">
      <TableContainer
        style={scrollerStyle(theme, p)}
        onScroll={windowHeight ? handleScroll : undefined}
      >
        <StyledTable
          ref={innerRef}
          customVariant={p.variant}
          stripeColor={p.stripeColor}
          glow={p.glow}
          pulse={p.pulse}
          hoverable={p.hoverable}
          density={p.density}
          stickyHeader={p.stickyHeader}
          virtualised={Boolean(windowHeight)}
          {...rest}
        >
          <EnhancedTableHeader
            columns={finalColumns}
            data={p.data ?? []}
            sortable={p.sortable}
            sortConfig={p.sortConfig}
            onSortChange={p.onSortChange}
            selectable={p.selectable}
            selectedRows={p.selectedRows}
            onSelectAll={selection.handleSelectAll}
            density={p.density}
            stickyHeader={p.stickyHeader}
            headRef={headRef}
          />
          <EnhancedTableBody
            data={p.data ?? []}
            columns={finalColumns}
            selectedRows={p.selectedRows}
            onRowClick={p.onRowClick}
            onRowFocus={p.onRowFocus}
            onRowBlur={p.onRowBlur}
            onSelectionChange={selection.handleSelectionChange}
            rowKeyExtractor={p.rowKeyExtractor}
            density={p.density}
            selectable={p.selectable}
            hoverable={p.hoverable}
            renderRow={p.renderRow}
            renderCell={p.renderCell}
            virtualWindow={windowHeight ? visibleItems : undefined}
            rowHeight={p.rowHeight}
          />
        </StyledTable>
      </TableContainer>

      {showToggle && (
        <ColumnToggleMenu
          columns={p.columns ?? []}
          hiddenColumns={selection.hiddenColumns}
          anchor={selection.columnMenuAnchor}
          setAnchor={selection.setColumnMenuAnchor}
          setHiddenColumns={selection.setHiddenColumns}
        />
      )}
    </Box>
  );
};

// The loading and empty states render the same shell as the populated table, so
// they share TableShell rather than repeating it three times.
const buildShell = ({
  resolved,
  selection,
  innerRef,
  rest,
  finalColumns }: RendererProps & { finalColumns?: ColumnConfig[] }) => ({
  innerRef,
  variant: resolved.variant,
  stripeColor: resolved.stripeColor,
  glow: resolved.glow,
  pulse: resolved.pulse,
  hoverable: resolved.hoverable,
  density: resolved.density,
  stickyHeader: resolved.stickyHeader,
  header: resolved.columns ? (
    <EnhancedTableHeader
      columns={finalColumns ?? []}
      data={[]}
      sortable={resolved.sortable}
      sortConfig={resolved.sortConfig}
      onSortChange={resolved.onSortChange}
      selectable={resolved.selectable}
      selectedRows={resolved.selectedRows}
      onSelectAll={selection.handleSelectAll}
      density={resolved.density}
      stickyHeader={resolved.stickyHeader}
    />
  ) : null,
  rest: rest as Record<string, unknown> });

const TableLoadingState: React.FC<{
  shell: TableShellProps;
  loadingComponent?: React.ReactNode;
  columns?: ColumnConfig[];
}> = ({ shell, loadingComponent, columns }) => (
  <TableShell {...shell}>
    <TableBody data-testid="table-loading">
      {loadingComponent || <LoadingSkeletonRows columns={columns} />}
    </TableBody>
  </TableShell>
);

const TableEmptyState: React.FC<{
  shell: TableShellProps;
  emptyStateComponent?: React.ReactNode;
  emptyText: string;
  colSpan: number;
}> = ({ shell, emptyStateComponent, emptyText, colSpan }) => (
  <TableShell {...shell}>
    <EmptyRow colSpan={colSpan}>
      {emptyStateComponent || <NoDataPlaceholder emptyText={emptyText} />}
    </EmptyRow>
  </TableShell>
);

export const Table = React.forwardRef<globalThis.HTMLTableElement, TableProps>(
  (tableProps, ref) => {
    const resolved = { ...TABLE_DEFAULTS, ...definedProps(tableProps) } as TableProps;
    const {
      columns,
      data,
      responsive,
      loading,
      loadingComponent,
      emptyStateComponent,
      emptyText,
      children,
    } = resolved;

    const selection = useTableSelection({
      columns,
      data,
      responsive,
      columnPriorities: resolved.columnPriorities,
      selectedRows: resolved.selectedRows ?? [],
      rowKeyExtractor: resolved.rowKeyExtractor,
      onSelectionChange: resolved.onSelectionChange });

    // Only MUI's and the DOM's own props reach the `<table>` (FUT-2658).
    const rest = tableDomProps(tableProps);
    const renderer: RendererProps = { resolved, selection, innerRef: ref, rest };
    const finalColumns = responsive ? selection.visibleColumns : columns;
    const shell = buildShell({ ...renderer, finalColumns });

    if (loading) {
      return (
        <TableLoadingState shell={shell} loadingComponent={loadingComponent} columns={columns} />
      );
    }

    if (data && data.length === 0) {
      return (
        <TableEmptyState
          shell={shell}
          emptyStateComponent={emptyStateComponent}
          emptyText={emptyText}
          colSpan={finalColumns?.length || 1}
        />
      );
    }

    if (columns && data) return <AdvancedTable {...renderer} />;

    // Basic table (backward compatibility)
    return (
      <StyledTable
        ref={ref}
        customVariant={resolved.variant}
        stripeColor={resolved.stripeColor}
        glow={resolved.glow}
        pulse={resolved.pulse}
        hoverable={resolved.hoverable}
        density={resolved.density}
        stickyHeader={resolved.stickyHeader}
        {...rest}
      >
        {children}
      </StyledTable>
    );
  },
);

Table.displayName = 'Table';