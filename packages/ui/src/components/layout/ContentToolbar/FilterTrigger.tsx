'use client';

import FilterIcon from '@mui/icons-material/FilterListRounded';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import React from 'react';

import type { FilterTriggerProps } from './ContentToolbar.types';

/**
 * Labeled filter toggle: a "Filtros" button (styled like the sibling toolbar
 * controls) with a funnel icon and, when filters are active, a count badge — so
 * it's obvious that the list is filtered and by how many facets. The panel itself
 * is supplied by the consumer.
 */
export function FilterTrigger({
  open,
  onOpenChange,
  hasActiveFilters = false,
  activeCount = 0,
  label = 'Filtros',
  'data-testid': testId = 'toggle-filters-btn',
}: FilterTriggerProps): React.JSX.Element {
  const active = activeCount > 0 || hasActiveFilters;
  return (
    <Button
      variant="text"
      size="small"
      color="inherit"
      data-testid={testId}
      aria-expanded={open}
      aria-label={open ? 'Close filters' : 'Open filters'}
      onClick={() => onOpenChange(!open)}
      startIcon={<FilterIcon sx={{ fontSize: 16 }} />}
      sx={{
        minWidth: 0,
        height: 32,
        px: 1,
        gap: 0.25,
        textTransform: 'none',
        fontWeight: 600,
        color: active ? 'primary.main' : 'text.primary',
        bgcolor: open ? 'action.selected' : 'transparent',
      }}
    >
      {label}
      {activeCount > 0 && (
        <Box
          component="span"
          data-testid={`${testId}-count`}
          sx={{
            ml: 0.5,
            minWidth: 18,
            height: 18,
            px: 0.5,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.7rem',
            fontWeight: 700,
            lineHeight: 1,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          {activeCount}
        </Box>
      )}
    </Button>
  );
}
