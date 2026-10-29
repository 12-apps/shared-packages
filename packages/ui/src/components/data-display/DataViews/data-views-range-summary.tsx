'use client';

import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Typography from '@mui/material/Typography/index.js';
import React from 'react';

import { useDataViewsCopy } from './data-views-copy-context';
import { isRangeSet, rangeChipLabel } from './data-views-range-values';
import type { RangeFieldConfig, RangeValue } from './data-views-types';
import { sxRem } from '../../../tokens/relative';

/**
 * The applied window in words, and "Limpar".
 *
 * An inverted window is not an error the merchant must fix before the list
 * responds — it simply matches nothing, and saying so beats an empty grid with
 * no explanation (FUT-668).
 *
 * A DAY filter keeps the row's height while nothing is applied: its first tap
 * on the calendar applies a bound, and a row appearing then grew the popover
 * 26px and moved it 32px up at 320×568, the day under the finger with it
 * (FUT-4144 UI review round 2). The held row is invisible and inert.
 */
export function RangeSummary<T extends Record<string, unknown>>({
  field,
  value,
  onClear,
  testId,
}: {
  field: RangeFieldConfig<T>;
  value: RangeValue;
  onClear: () => void;
  testId: string;
}): React.JSX.Element | null {
  const copy = useDataViewsCopy();
  const active = isRangeSet(value);
  if (!active && field.kind !== 'day') return null;
  return (
    <Box
      aria-hidden={active ? undefined : true}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        mt: { xs: 0.5, sm: 1.5 },
        visibility: active ? undefined : 'hidden',
      }}
    >
      <Typography component="span" sx={{ fontSize: sxRem(12), color: 'text.secondary' }}>
        {active ? rangeChipLabel(field, value) : field.label}
      </Typography>
      <Button
        variant="text"
        size="small"
        onClick={active ? onClear : undefined}
        tabIndex={active ? undefined : -1}
        data-testid={active ? `${testId}-clear` : undefined}
        sx={{ textTransform: 'none' }}
      >
        {copy.filters.clear}
      </Button>
    </Box>
  );
}
