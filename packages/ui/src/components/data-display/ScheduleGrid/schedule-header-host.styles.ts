import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { sxRem } from '../../../tokens/relative';
import { SCHEDULE_GRID_METRICS as M } from './ScheduleGrid.metrics';

/**
 * The header row's host figures (FUT-3882): a day's adornment under its label
 * and the corner above the names. Their own module to keep the grid's styles
 * under the file-size budget.
 */

/** A day's adornment: under its label, the column's full width, in the secondary ink unless the host says otherwise. */
export const headerAdornmentSx: SxProps<Theme> = {
  mt: 0.5,
  fontSize: sxRem(M.headerSublabel),
  fontWeight: 400,
  color: 'text.secondary',
};

/** The cell above the names: the host's words, at the foot of the header row like the days' adornments. */
export const cornerSx: SxProps<Theme> = {
  alignSelf: 'end',
  fontSize: sxRem(M.headerSublabel),
  color: 'text.secondary',
  p: 0.5,
  pl: 0,
  minWidth: 0,
};
