'use client';

import ChevronDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { Box, Button, Typography } from '@mui/material';
import React, { useId } from 'react';

import type { MultiSelectOption } from './ContentToolbar.types';

/**
 * Trigger label from the current selection: `allLabel` when none/all are
 * selected, the single label when one, else "first (+N)". Uses Set iteration
 * order so the label reflects the first-clicked option.
 */
export function buildTriggerLabel<TValue extends string>(
  selected: ReadonlySet<TValue>,
  options: MultiSelectOption<TValue>[],
  allLabel: string,
): string {
  const size = selected.size;
  if (size === 0 || size === options.length) return allLabel;
  const labelMap = new Map(options.map((option) => [option.value, option.label]));
  const firstValue = selected.values().next().value as TValue;
  const firstLabel = labelMap.get(firstValue) ?? allLabel;
  if (size === 1) return firstLabel;
  return `${firstLabel} (+${size - 1})`;
}

export interface TriggerProps {
  label: string;
  triggerLabel: string;
  open: boolean;
  onOpen: (event: React.MouseEvent<HTMLElement>) => void;
  testId?: string;
}

/** Compact `Label:` text button for a horizontal toolbar (the default layout). */
export function InlineTrigger({ label, triggerLabel, open, onOpen, testId }: TriggerProps): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.875rem' }}>
      <Typography component="span" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
        {label}:
      </Typography>
      <Button
        variant="text"
        size="small"
        color="inherit"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onOpen}
        sx={{ minWidth: 0, height: 32, px: 1, gap: 0.5, color: 'text.primary', textTransform: 'none', fontWeight: 600 }}
      >
        {triggerLabel}
        <ChevronDownIcon sx={{ fontSize: 14 }} />
      </Button>
    </Box>
  );
}

/** Full-width, outlined select-style control with the label above (stacked layout). */
export function StackedTrigger({ label, triggerLabel, open, onOpen, testId }: TriggerProps): React.JSX.Element {
  // Name the button by label + value (aria-labelledby): a <button> isn't labelable.
  const baseId = useId();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography id={`${baseId}-label`} component="label" sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Button
        variant="outlined"
        color="inherit"
        fullWidth
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-labelledby={`${baseId}-label ${baseId}-value`}
        onClick={onOpen}
        endIcon={<ChevronDownIcon sx={{ fontSize: 18, color: 'text.secondary' }} />}
        sx={{
          justifyContent: 'space-between',
          height: 40,
          px: 1.5,
          color: 'text.primary',
          textTransform: 'none',
          fontWeight: 400,
          fontSize: '0.875rem',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          '&:hover': { borderColor: 'text.primary', bgcolor: 'background.paper' },
        }}
      >
        <Box
          component="span" id={`${baseId}-value`}
          sx={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {triggerLabel}
        </Box>
      </Button>
    </Box>
  );
}

/** Rounded outlined chip (`Label ▾`, `Label (N) ▾` when selected) for a filter row. */
export function PillTrigger({
  label,
  open,
  onOpen,
  testId,
  selectedCount,
}: TriggerProps & { selectedCount: number }): React.JSX.Element {
  const active = selectedCount > 0;
  return (
    <Button
      variant="outlined"
      color="inherit"
      size="small"
      data-testid={testId}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onOpen}
      endIcon={<ChevronDownIcon sx={{ fontSize: 16 }} />}
      sx={{
        borderRadius: 999,
        height: 34,
        px: 1.5,
        color: 'text.primary',
        fontWeight: 600,
        fontSize: '0.8125rem',
        textTransform: 'none',
        borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? 'action.selected' : 'background.paper',
        '&:hover': { borderColor: active ? 'primary.main' : 'text.primary', bgcolor: active ? 'action.selected' : 'action.hover' },
      }}
    >
      {label}
      {active ? ` (${selectedCount})` : ''}
    </Button>
  );
}
