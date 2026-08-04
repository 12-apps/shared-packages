import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Skeleton,
  Table as MuiTable,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Switch,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import { tableStyles } from './Table.styles';
import type { ColumnConfig, TableDensity, TableProps, TableStripeColor } from './Table.types';
import { EnhancedTableBody, EnhancedTableHeader } from './TableParts';

// What every render of a Table shares: the container, the styled table itself,
// and the header when there are columns to describe.
type ShellProps = React.ComponentProps<typeof TableShell>;

const StyledTableContainer = styled(TableContainer, {
  shouldForwardProp: (prop) => !['virtualScrolling', 'containerHeight'].includes(prop as string),
})<{ 
  virtualScrolling?: boolean; 
  containerHeight?: number | string;
}>(({ virtualScrolling, containerHeight }) => ({
  ...(virtualScrolling && {
    height: containerHeight || 400,
    overflow: 'auto',
  }),
}));

// Helper function to get stripe color from theme
const StyledTable = styled(MuiTable, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'glow', 'pulse', 'hoverable', 'density', 'stickyHeader', 'stripeColor'].includes(prop as string),
})<{
  customVariant?: string;
  glow?: boolean;
  pulse?: boolean;
  hoverable?: boolean;
  density?: TableDensity;
  stickyHeader?: boolean;
  stripeColor?: TableStripeColor;
}>(({ theme, customVariant, glow, pulse, hoverable, density, stickyHeader, stripeColor = 'neutral' }) => {
  return tableStyles({
    theme,
    customVariant,
    glow,
    pulse,
    hoverable,
    density,
    stickyHeader,
    stripeColor,
  });
});

// The container + styled table + optional header, shared by the loading, empty
// and populated renders.
export const TableShell: React.FC<{
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
  children,
}) => (
  <StyledTableContainer>
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
  </StyledTableContainer>
);

const SKELETON_ROW_COUNT = 5;

export const LoadingSkeletonRows: React.FC<{ columns?: ColumnConfig[] }> = ({ columns }) => (
  <>
    {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
      <TableRow key={index}>
        {columns?.map((column) => (
          <TableCell key={column.key}>
            <Skeleton height={20} />
          </TableCell>
        ))}
      </TableRow>
    ))}
  </>
);

// Loading: the shell over skeleton rows, or whatever the caller supplied.
export const LoadingTable: React.FC<{
  shell: Omit<ShellProps, 'children'>;
  loadingComponent?: React.ReactNode;
  columns?: ColumnConfig[];
}> = ({ shell, loadingComponent, columns }) => (
  <TableShell {...shell}>
    <TableBody data-testid="table-loading">
      {loadingComponent || <LoadingSkeletonRows columns={columns} />}
    </TableBody>
  </TableShell>
);

// Empty: the same shell, one row wide enough to say so.
export const EmptyTable: React.FC<{
  shell: Omit<ShellProps, 'children'>;
  columns?: ColumnConfig[];
  emptyStateComponent?: React.ReactNode;
}> = ({ shell, columns, emptyStateComponent }) => (
  <TableShell {...shell}>
    <TableBody>
      <TableRow>
        <TableCell colSpan={columns?.length || 1} align="center">
          {emptyStateComponent || (
            <Box py={4} color="text.secondary">
              No data available
            </Box>
          )}
        </TableCell>
      </TableRow>
    </TableBody>
  </TableShell>
);

// On a narrow screen the columns that did not fit are still reachable here.
const ColumnToggleMenu: React.FC<{
  columns: ColumnConfig[];
  hiddenColumns: number[];
  anchor: globalThis.HTMLElement | null;
  setAnchor: (anchor: globalThis.HTMLElement | null) => void;
  setHiddenColumns: (hidden: number[]) => void;
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
                onChange={(e) =>
                  setHiddenColumns(
                    e.target.checked
                      ? hiddenColumns.filter((i) => i !== index)
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

// Populated: header and body over the caller's columns and data, plus the
// column toggle when responsive mode has hidden some.
export const AdvancedTable: React.FC<{
  table: TableProps;
  columns: ColumnConfig[];
  data: Record<string, unknown>[];
  innerRef: React.Ref<globalThis.HTMLTableElement>;
  rest: Record<string, unknown>;
  selection: {
    hiddenColumns: number[];
    isMobile: boolean;
    columnMenuAnchor: globalThis.HTMLElement | null;
    setColumnMenuAnchor: (anchor: globalThis.HTMLElement | null) => void;
    setHiddenColumns: (hidden: number[]) => void;
    handleSelectionChange: (rowKey: string | number, selected: boolean) => void;
    handleSelectAll: (selected: boolean) => void;
  };
}> = ({ table, columns, data, innerRef, rest, selection }) => (
  <Box position="relative">
    <StyledTableContainer
      virtualScrolling={table.virtualScrolling}
      containerHeight={table.containerHeight}
    >
      <StyledTable
        ref={innerRef}
        customVariant={table.variant}
        stripeColor={table.stripeColor}
        glow={table.glow}
        pulse={table.pulse}
        hoverable={table.hoverable}
        density={table.density}
        stickyHeader={table.stickyHeader}
        {...rest}
      >
        <EnhancedTableHeader
          columns={columns}
          data={data}
          sortable={table.sortable}
          sortConfig={table.sortConfig}
          onSortChange={table.onSortChange}
          selectable={table.selectable}
          selectedRows={table.selectedRows}
          onSelectAll={selection.handleSelectAll}
          density={table.density}
          stickyHeader={table.stickyHeader}
        />
        <EnhancedTableBody
          data={data}
          columns={columns}
          selectedRows={table.selectedRows}
          onRowClick={table.onRowClick}
          onRowFocus={table.onRowFocus}
          onRowBlur={table.onRowBlur}
          onSelectionChange={selection.handleSelectionChange}
          rowKeyExtractor={table.rowKeyExtractor}
          density={table.density}
          selectable={table.selectable}
          hoverable={table.hoverable}
          renderRow={table.renderRow}
          renderCell={table.renderCell}
          virtualScrolling={table.virtualScrolling}
          containerHeight={
            typeof table.containerHeight === 'number' ? table.containerHeight : undefined
          }
          rowHeight={table.rowHeight}
          overscan={table.overscan}
        />
      </StyledTable>
    </StyledTableContainer>

    {/* Column Toggle Menu for Responsive */}
    {table.responsive &&
      selection.isMobile &&
      table.showColumnToggle &&
      selection.hiddenColumns.length > 0 && (
        <ColumnToggleMenu
          columns={columns}
          hiddenColumns={selection.hiddenColumns}
          anchor={selection.columnMenuAnchor}
          setAnchor={selection.setColumnMenuAnchor}
          setHiddenColumns={selection.setHiddenColumns}
        />
      )}
  </Box>
);

// Basic table (backward compatibility)
export const BasicTable: React.FC<{
  table: TableProps;
  innerRef: React.Ref<globalThis.HTMLTableElement>;
  rest: Record<string, unknown>;
}> = ({ table, innerRef, rest }) => (
  <StyledTable
    ref={innerRef}
    customVariant={table.variant}
    stripeColor={table.stripeColor}
    glow={table.glow}
    pulse={table.pulse}
    hoverable={table.hoverable}
    density={table.density}
    stickyHeader={table.stickyHeader}
    {...rest}
  >
    {table.children}
  </StyledTable>
);
