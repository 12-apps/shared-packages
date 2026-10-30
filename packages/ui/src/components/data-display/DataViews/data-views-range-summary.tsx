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
 * The applied window in words, and "Limpar", under a NUMBER range's boxes.
 *
 * An inverted window is not an error the merchant must fix before the list
 * responds — it simply matches nothing, and saying so beats an empty grid with
 * no explanation (FUT-668).
 *
 * A DAY range says these on its calendar's hint line instead (FUT-4144): a row
 * of its own, held empty until the first tap so the popover would not grow,
 * left 59px of white under the hint at 1280.
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
  if (field.kind === 'day' || !isRangeSet(value)) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mt: 1.5 }}>
      <Typography component="span" sx={{ fontSize: sxRem(12), color: 'text.secondary' }}>
        {rangeChipLabel(field, value)}
      </Typography>
      <Button
        variant="text"
        size="small"
        onClick={onClear}
        data-testid={`${testId}-clear`}
        sx={{ textTransform: 'none' }}
      >
        {copy.filters.clear}
      </Button>
    </Box>
  );
}
