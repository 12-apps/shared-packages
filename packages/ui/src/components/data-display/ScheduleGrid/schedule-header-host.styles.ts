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

/**
 * The cell above the names. It is the pinned mask over the names column (the
 * grid's sticky rule): it must stay a stretched grid item, the header row's
 * full height, or a day scrolled sideways shows above the names. Its words sit
 * inside it on the days' label line (the prototype's "Movimento, 11h–23h").
 */
export const cornerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  fontSize: sxRem(M.headerSublabel),
  color: 'text.secondary',
  pt: 0.5,
  pr: 0.5,
  minWidth: 0,
};
