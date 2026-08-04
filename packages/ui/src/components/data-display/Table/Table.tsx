import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  alpha,
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  keyframes,
  Menu,
  MenuItem,
  Skeleton,
  Switch,
  Table as MuiTable,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  useMediaQuery,
  useTheme} from '@mui/material';
import { styled } from '@mui/material/styles';
import React, { useCallback,useEffect, useMemo, useState } from 'react';

import type {
  ColumnConfig,
  TableBodyProps,
  TableDensity,
  TableHeaderProps,
  TableProps,
  TableStripeColor} from './Table.types';
import { EnhancedTableBody, EnhancedTableHeader } from './TableParts';
import {
  getDensityConfig,
  getStripeColorFromTheme,
  pulseAnimation,
  tableStyles,
} from './Table.styles';

// Define pulse animation
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

// Virtual Scrolling Hook
const useResponsive = (
  columns: ColumnConfig[],
  columnPriorities?: number[]
) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.down('lg'));
  
  const [hiddenColumns, setHiddenColumns] = useState<number[]>([]);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    if (!columnPriorities) return;
    
    let columnsToHide: number[] = [];
    
    if (isMobile) {
      // Hide lowest priority columns on mobile
      columnsToHide = columnPriorities
        .map((priority, index) => ({ priority, index }))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, Math.floor(columns.length / 2))
        .map(item => item.index);
    } else if (isTablet) {
      // Hide some columns on tablet
      columnsToHide = columnPriorities
        .map((priority, index) => ({ priority, index }))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, Math.floor(columns.length / 3))
        .map(item => item.index);
    }
    
    setHiddenColumns(columnsToHide);
  }, [isMobile, isTablet, columnPriorities, columns.length]);

  const visibleColumns = columns.filter((_, index) => !hiddenColumns.includes(index));

  return {
    visibleColumns,
    hiddenColumns,
    isMobile,
    columnMenuAnchor,
    setColumnMenuAnchor,
    setHiddenColumns,
  };
};

// Enhanced Table Header Component
// Visible/hidden column split for responsive mode, plus row selection.
const useTableSelection = ({
  columns,
  data,
  responsive,
  columnPriorities,
  selectedRows,
  rowKeyExtractor,
  onSelectionChange,
}: {
  columns?: ColumnConfig[];
  data: TableProps['data'];
  responsive?: boolean;
  columnPriorities?: number[];
  selectedRows: (string | number)[];
  rowKeyExtractor?: (row: Record<string, unknown>, index: number) => string | number;
  onSelectionChange?: TableProps['onSelectionChange'];
}) => {
    
  // Use responsive hook if responsive mode is enabled
  const {
    visibleColumns,
    hiddenColumns,
    isMobile,
    columnMenuAnchor,
    setColumnMenuAnchor,
    setHiddenColumns,
  } = useResponsive(
    columns || [],
    responsive ? columnPriorities : undefined
  );

  // Handle selection changes
  const handleSelectionChange = useCallback((rowKey: string | number, selected: boolean) => {
    if (!onSelectionChange) return;
    
    let newSelection: (string | number)[];
    if (selected) {
      newSelection = [...selectedRows, rowKey];
    } else {
      newSelection = selectedRows.filter(key => key !== rowKey);
    }
    onSelectionChange(newSelection);
  }, [selectedRows, onSelectionChange]);

  const handleSelectAll = useCallback((selected: boolean) => {
    if (!onSelectionChange || !data) return;
    
    if (selected) {
      const allKeys = data.map((rowData, index) => 
        rowKeyExtractor ? rowKeyExtractor(rowData, index) : (rowData.id as string | number) || index
      );
      onSelectionChange(allKeys);
    } else {
      onSelectionChange([]);
    }
  }, [data, onSelectionChange, rowKeyExtractor]);

  // Loading state

  return {
    visibleColumns,
    hiddenColumns,
    isMobile,
    columnMenuAnchor,
    setColumnMenuAnchor,
    setHiddenColumns,
    handleSelectionChange,
    handleSelectAll,
  };
};

export const Table = React.forwardRef<globalThis.HTMLTableElement, TableProps>(
  ({
    // Basic props
    variant = 'default',
    stripeColor = 'neutral',
    glow = false,
    pulse = false,
    hoverable = false,
    loading = false,
    children,
    
    // Advanced feature props
    density = 'normal',
    stickyHeader = false,
    selectable = false,
    selectedRows = [],
    onSelectionChange,
    rowKeyExtractor,
    sortable = false,
    sortConfig,
    onSortChange,
    columns,
    data,
    virtualScrolling = false,
    rowHeight = 52,
    overscan = 5,
    responsive = false,
    columnPriorities,
    showColumnToggle = true,
    containerHeight,
    loadingComponent,
    emptyStateComponent,
    renderRow,
    renderCell,
    onRowClick,
    onRowFocus,
    onRowBlur,
    
    ...props
  }, ref) => {
    useTheme(); // Required for responsive behavior

    const {
      visibleColumns,
      hiddenColumns,
      isMobile,
      columnMenuAnchor,
      setColumnMenuAnchor,
      setHiddenColumns,
      handleSelectionChange,
      handleSelectAll,
    } = useTableSelection({
      columns,
      data,
      responsive,
      columnPriorities,
      selectedRows,
      rowKeyExtractor,
      onSelectionChange,
    });

    if (loading) {
      const loadingRows = Array.from({ length: 5 }, (_, index) => (
        <TableRow key={index}>
          {columns?.map((column) => (
            <TableCell key={column.key}>
              <Skeleton height={20} />
            </TableCell>
          ))}
        </TableRow>
      ));

      return (
        <StyledTableContainer>
          <StyledTable
            ref={ref}
            customVariant={variant}
            stripeColor={stripeColor}
            glow={glow}
            pulse={pulse}
            hoverable={hoverable}
            density={density}
            stickyHeader={stickyHeader}
            {...props}
          >
            {columns && (
              <EnhancedTableHeader
                columns={responsive ? visibleColumns : columns}
                data={[]}
                sortable={sortable}
                sortConfig={sortConfig}
                onSortChange={onSortChange}
                selectable={selectable}
                selectedRows={selectedRows}
                onSelectAll={handleSelectAll}
                density={density}
                stickyHeader={stickyHeader}
              />
            )}
            <TableBody data-testid="table-loading">
              {loadingComponent || loadingRows}
            </TableBody>
          </StyledTable>
        </StyledTableContainer>
      );
    }

    // Empty state
    if (data && data.length === 0) {
      return (
        <StyledTableContainer>
          <StyledTable
            ref={ref}
            customVariant={variant}
            stripeColor={stripeColor}
            glow={glow}
            pulse={pulse}
            hoverable={hoverable}
            density={density}
            stickyHeader={stickyHeader}
            {...props}
          >
            {columns && (
              <EnhancedTableHeader
                columns={responsive ? visibleColumns : columns}
                data={[]}
                sortable={sortable}
                sortConfig={sortConfig}
                onSortChange={onSortChange}
                selectable={selectable}
                selectedRows={selectedRows}
                onSelectAll={handleSelectAll}
                density={density}
                stickyHeader={stickyHeader}
              />
            )}
            <TableBody>
              <TableRow>
                <TableCell colSpan={(responsive ? visibleColumns : columns)?.length || 1} align="center">
                  {emptyStateComponent || (
                    <Box py={4} color="text.secondary">
                      No data available
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </StyledTable>
        </StyledTableContainer>
      );
    }

    // Advanced table with columns and data
    if (columns && data) {
      const finalColumns = responsive ? visibleColumns : columns;

      return (
        <Box position="relative">
          <StyledTableContainer
            virtualScrolling={virtualScrolling}
            containerHeight={containerHeight}
          >
            <StyledTable
              ref={ref}
              customVariant={variant}
              stripeColor={stripeColor}
              glow={glow}
              pulse={pulse}
              hoverable={hoverable}
              density={density}
              stickyHeader={stickyHeader}
              {...props}
            >
              <EnhancedTableHeader
                columns={finalColumns}
                data={data}
                sortable={sortable}
                sortConfig={sortConfig}
                onSortChange={onSortChange}
                selectable={selectable}
                selectedRows={selectedRows}
                onSelectAll={handleSelectAll}
                density={density}
                stickyHeader={stickyHeader}
              />
              <EnhancedTableBody
                data={data}
                columns={finalColumns}
                selectedRows={selectedRows}
                onRowClick={onRowClick}
                onRowFocus={onRowFocus}
                onRowBlur={onRowBlur}
                onSelectionChange={handleSelectionChange}
                rowKeyExtractor={rowKeyExtractor}
                density={density}
                selectable={selectable}
                hoverable={hoverable}
                renderRow={renderRow}
                renderCell={renderCell}
                virtualScrolling={virtualScrolling}
                containerHeight={typeof containerHeight === 'number' ? containerHeight : undefined}
                rowHeight={rowHeight}
                overscan={overscan}
              />
            </StyledTable>
          </StyledTableContainer>

          {/* Column Toggle Menu for Responsive */}
          {responsive && isMobile && showColumnToggle && hiddenColumns.length > 0 && (
            <Box position="absolute" top={8} right={8}>
              <IconButton
                onClick={(event) => setColumnMenuAnchor(event.currentTarget)}
                size="small"
              >
                <MoreVertIcon />
              </IconButton>
              <Menu
                anchorEl={columnMenuAnchor}
                open={Boolean(columnMenuAnchor)}
                onClose={() => setColumnMenuAnchor(null)}
              >
                {columns.map((column, index) => (
                  <MenuItem key={column.key}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={!hiddenColumns.includes(index)}
                          onChange={(e) => {
                            const newHidden = e.target.checked 
                              ? hiddenColumns.filter(i => i !== index)
                              : [...hiddenColumns, index];
                            setHiddenColumns(newHidden);
                          }}
                          size="small"
                        />
                      }
                      label={column.label}
                    />
                  </MenuItem>
                ))}
              </Menu>
            </Box>
          )}
        </Box>
      );
    }

    // Basic table (backward compatibility)
    return (
      <StyledTable
        ref={ref}
        customVariant={variant}
        stripeColor={stripeColor}
        glow={glow}
        pulse={pulse}
        hoverable={hoverable}
        density={density}
        stickyHeader={stickyHeader}
        {...props}
      >
        {children}
      </StyledTable>
    );
  }
);

Table.displayName = 'Table';