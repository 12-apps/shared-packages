'use client';

import { Box, Button, Divider, Typography } from '@mui/material';
import React from 'react';

import type { ContentToolbarProps } from './ContentToolbar.types';

const selectionButtonSx = {
  minWidth: 0,
  height: 'auto',
  borderRadius: 0.5,
  fontWeight: 600,
  py: 0.5,
  px: 1.5,
  fontSize: '0.75rem',
  textTransform: 'none',
  color: 'text.primary',
} as const;

/**
 * Shared toolbar for content pages (Favorites, Personal Space, Recents, …). The
 * left cluster owns selection chrome — **Select All**, and once items are
 * selected, **Clear All** + an "N items selected" count + an optional `actions`
 * slot. The right cluster is a free `rightControls` slot for page-specific
 * controls (ViewSelector, SortByDropdown, MultiSelectDropdown, FilterTrigger).
 *
 * Faithful, generic MUI port of the reference `ContentPageToolbar` — the
 * domain-specific default actions are intentionally left to the consumer via
 * the `actions` slot so this stays agnostic and reusable across projects.
 *
 * @example
 * ```tsx
 * <ContentToolbar
 *   hasSelection={selected.size > 0}
 *   selectedCount={selected.size}
 *   selectAll={selectAll}
 *   clearSelection={clear}
 *   rightControls={
 *     <>
 *       <ViewSelector viewMode={view} onViewModeChange={setView} zoom={zoom} onZoomChange={setZoom} />
 *       <SortByDropdown fields={FIELDS} activeField={field} onFieldChange={setField} />
 *       <MultiSelectDropdown label="Content Type" options={types} selected={typeSet} onToggle={toggle} onClear={clear} />
 *       <FilterTrigger open={panelOpen} onOpenChange={setPanelOpen} hasActiveFilters={hasFilters} />
 *     </>
 *   }
 * />
 * ```
 */
export function ContentToolbar({
  hasSelection,
  selectedCount,
  selectAll,
  clearSelection,
  rightControls,
  actions,
  selectAllTestId,
  clearAllTestId,
  edgeAlign = false,
}: ContentToolbarProps): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Box sx={{ display: 'flex', minWidth: 0, flex: 1, alignItems: 'center', gap: 1.5, ml: edgeAlign ? -1.5 : 0 }}>
        <Button
          variant="text"
          size="small"
          color="inherit"
          onClick={selectAll}
          data-testid={selectAllTestId}
          sx={selectionButtonSx}
        >
          Select All
        </Button>

        {hasSelection ? (
          <>
            <Button
              variant="text"
              size="small"
              color="inherit"
              onClick={clearSelection}
              data-testid={clearAllTestId}
              sx={selectionButtonSx}
            >
              Clear All
            </Button>
            <Divider orientation="vertical" flexItem sx={{ height: 16, alignSelf: 'center' }} />
            <Typography
              component="span"
              data-testid="selected-count-indicator"
              sx={{ fontSize: '0.875rem', color: 'text.secondary', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
            </Typography>
            {actions !== undefined && (
              <Box sx={{ ml: 0.5, display: 'flex', flexShrink: 0, alignItems: 'center' }}>{actions}</Box>
            )}
          </>
        ) : (
          actions !== undefined && (
            <Box sx={{ ml: 0.5, display: 'flex', flexShrink: 0, alignItems: 'center' }}>{actions}</Box>
          )
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mr: edgeAlign ? -1.5 : 0 }}>{rightControls}</Box>
    </Box>
  );
}
