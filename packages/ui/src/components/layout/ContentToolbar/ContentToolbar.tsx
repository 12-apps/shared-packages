'use client';

import { Box, Button, Checkbox, Divider, Typography } from '@mui/material';
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

type SelectionClusterProps = Pick<
  ContentToolbarProps,
  'hasSelection' | 'selectedCount' | 'selectAll' | 'clearSelection' | 'actions' | 'selectAllTestId' | 'clearAllTestId' | 'edgeAlign'
>;

/** The left cluster: Select All + (when selecting) Clear All / count / actions. */
function SelectionCluster({
  hasSelection,
  selectedCount,
  selectAll,
  clearSelection,
  actions,
  selectAllTestId,
  clearAllTestId,
  edgeAlign = false,
}: SelectionClusterProps): React.JSX.Element {
  const actionsSlot = actions !== undefined && (
    <Box sx={{ ml: 0.5, display: 'flex', flexShrink: 0, alignItems: 'center' }}>{actions}</Box>
  );
  return (
    <Box
      sx={{
        display: 'flex',
        minWidth: 0,
        // Mobile: don't grow, so the controls sit on the SAME line as the checkbox
        // (no orphaned selection row). Desktop: grow to push controls right.
        flex: { xs: '0 0 auto', md: 1 },
        alignItems: 'center',
        gap: 1.5,
        ml: edgeAlign ? -1.5 : 0,
      }}
    >
      {/* Desktop: a "Select All" text button (md+). Mobile: a compact checkbox
          that toggles select-all/clear — the text would eat the tight row. */}
      <Button
        variant="text"
        size="small"
        color="inherit"
        onClick={selectAll}
        data-testid={selectAllTestId}
        sx={{ ...selectionButtonSx, display: { xs: 'none', md: 'inline-flex' } }}
      >
        Select All
      </Button>
      <Checkbox
        size="small"
        checked={hasSelection}
        onChange={(event) => (event.target.checked ? selectAll() : clearSelection())}
        data-testid={`${selectAllTestId}-checkbox`}
        inputProps={{ 'aria-label': 'Selecionar todos' }}
        sx={{ p: 0.5, display: { xs: 'inline-flex', md: 'none' } }}
      />
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
          {actionsSlot}
        </>
      ) : (
        actionsSlot
      )}
    </Box>
  );
}

/**
 * The BROWSING half of the toolbar: search + filters on the left, the page's
 * own controls on the right. Split out of {@link ContentToolbar} so that
 * function stays inside the complexity gate — it is layout only, and the
 * decision of whether to show it at all is made by the caller.
 */
function BrowsingClusters({
  leadingControls,
  rightControls,
  hasSelection,
  edgeAlign,
}: {
  leadingControls?: React.ReactNode;
  rightControls: React.ReactNode;
  hasSelection: boolean;
  edgeAlign: boolean;
}): React.JSX.Element {
  return (
    <>
      {/* minWidth:0 lets this cluster be the one that gives up width as the row
       * tightens, which is what the filter overflow measures against. */}
      {leadingControls !== undefined && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          {leadingControls}
        </Box>
      )}
      {/* ml:auto keeps the controls right-aligned even when the cluster wraps to
       * its own row (where justify-content:space-between would otherwise snap a
       * lone item to the left); it's a no-op on a shared row. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          // Same single-line rule as the row itself: this cluster wrapping
          // INTERNALLY buys a second line just as surely as the row wrapping
          // does. It bit at exactly 900px, the `md` breakpoint where the "N de
          // N" counter appears and pushes Exibir/Exportar over the edge.
          flexWrap: leadingControls === undefined ? 'wrap' : 'nowrap',
          // Tight (5px) when browsing so the controls fit one line beside the
          // checkbox; roomier (14px) in selection mode where they get their own row.
          gap: hasSelection ? '14px' : '5px',
          ml: 'auto',
          mr: edgeAlign ? -1.5 : 0,
          '& > *': { flexShrink: 0 },
        }}
      >
        {rightControls}
      </Box>
    </>
  );
}

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
  leadingControls,
  actions,
  selectAllTestId,
  clearAllTestId,
  edgeAlign = false,
  exclusiveSelection = false,
}: ContentToolbarProps): React.JSX.Element {
  // Under `exclusiveSelection` the two states are alternatives, not neighbours:
  // browsing shows the controls and no checkbox, selecting shows the checkbox
  // and no controls. Anything else double-books the row.
  const showSelection = !exclusiveSelection || hasSelection;
  const showControls = !exclusiveSelection || !hasSelection;
  return (
    // Two clusters on one line. They may wrap onto separate rows ONLY for a
    // toolbar without `leadingControls` — one carrying search + filters is
    // driven by a measured collapse ladder (see `useFilterOverflow`), and a
    // wrap there is the ladder having failed: it would silently buy a second
    // row instead of shedding a control into "Mais", which is the one outcome
    // the ladder exists to prevent.
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: leadingControls === undefined ? 'wrap' : 'nowrap',
        rowGap: 1,
      }}
    >
      {showSelection && (
        <SelectionCluster
          hasSelection={hasSelection}
          selectedCount={selectedCount}
          selectAll={selectAll}
          clearSelection={clearSelection}
          actions={actions}
          selectAllTestId={selectAllTestId}
          clearAllTestId={clearAllTestId}
          edgeAlign={edgeAlign}
        />
      )}

      {showControls && (
        <BrowsingClusters
          leadingControls={leadingControls}
          rightControls={rightControls}
          hasSelection={hasSelection}
          edgeAlign={edgeAlign}
        />
      )}
    </Box>
  );
}
