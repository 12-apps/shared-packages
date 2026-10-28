import type { SxProps, Theme } from '@mui/material/styles/index.js';
import Box from '@mui/material/Box/index.js';
import type { FC } from 'react';
import React, { useEffect, useRef, useState } from 'react';

import { rem, sxRem } from '../../../tokens/relative';

import { moveInGrid } from './Calendar.views';

/** A pick button's smallest edge: a touch target at any width (44 design px). */
const TARGET_SIZE = sxRem(44);

export interface PickerOption {
  value: number;
  label: string;
  /** The accessible name, when the visible label is an abbreviation ("mar"). */
  ariaLabel?: string;
  disabled: boolean;
  /** The month or year the calendar is showing. */
  current: boolean;
}

const inkFor = ({ current, disabled }: PickerOption): string => {
  if (current) return 'primary.contrastText';
  return disabled ? 'text.disabled' : 'text.primary';
};

const optionSx = (option: PickerOption): SxProps<Theme> => ({
  minHeight: TARGET_SIZE,
  minWidth: 0,
  boxSizing: 'border-box',
  padding: 0,
  font: 'inherit',
  typography: 'body1',
  border: 1,
  borderColor: option.current ? 'primary.main' : 'divider',
  borderRadius: 1,
  backgroundColor: option.current ? 'primary.main' : 'transparent',
  color: inkFor(option),
  cursor: option.disabled ? 'not-allowed' : 'pointer',
  '&:hover': { backgroundColor: option.current || option.disabled ? undefined : 'action.hover' },
  '&:focus-visible': {
    outline: (theme: Theme) => `${rem(theme, 2)} solid`,
    outlineColor: 'primary.main',
    outlineOffset: sxRem(1),
  },
});

// The grid fills the box the day grid leaves (see CalendarSelectorsMonth), so
// opening it never resizes the calendar: a short grid's rows stretch to fill
// it, a long one scrolls inside it.
const gridSx = (columns: number, scrollable: boolean): SxProps<Theme> => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  gap: 1,
  boxSizing: 'border-box',
  height: '100%',
  // Room for the focus ring of the edge buttons inside the box.
  p: 0.5,
  ...(scrollable ? { alignContent: 'start', overflowY: 'auto' } : { gridAutoRows: '1fr' }),
});

export interface CalendarPickerGridProps {
  id: string;
  ariaLabel: string;
  columns: number;
  options: PickerOption[];
  testId: string;
  scrollable?: boolean;
  onPick: (value: number) => void;
  onDismiss: () => void;
}

/**
 * The month or year grid that stands in for the days. One tab stop (roving
 * `tabIndex`); arrows, Home and End move it, Enter/Space pick, Escape goes back
 * to the days unchanged. Out-of-bounds options stay focusable and say
 * `aria-disabled`, so the arrows never skip a hole a reader cannot explain.
 */
export const CalendarPickerGrid: FC<CalendarPickerGridProps> = ({
  id,
  ariaLabel,
  columns,
  options,
  testId,
  scrollable = false,
  onPick,
  onDismiss,
}) => {
  const [active, setActive] = useState(() => Math.max(options.findIndex((option) => option.current), 0));
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  // Also runs on mount: opening the grid puts focus on the shown month/year,
  // which scrolls a long year list to it.
  useEffect(() => {
    buttons.current[active]?.focus();
  }, [active]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // The calendar's own day keys must not move a day nobody can see.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
      return;
    }
    const next = moveInGrid(event.key, active, columns, options.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <Box id={id} role="group" aria-label={ariaLabel} data-testid={testId} onKeyDown={handleKeyDown} sx={gridSx(columns, scrollable)}>
      {options.map((option, index) => (
        <Box
          key={option.value}
          component="button"
          type="button"
          ref={(node: HTMLButtonElement | null) => {
            buttons.current[index] = node;
          }}
          tabIndex={index === active ? 0 : -1}
          aria-current={option.current ? 'true' : undefined}
          aria-disabled={option.disabled || undefined}
          aria-label={option.ariaLabel}
          data-testid={`${testId}-${option.value}`}
          onFocus={() => setActive(index)}
          onClick={() => {
            if (!option.disabled) onPick(option.value);
          }}
          sx={optionSx(option)}
        >
          {option.label}
        </Box>
      ))}
    </Box>
  );
};
