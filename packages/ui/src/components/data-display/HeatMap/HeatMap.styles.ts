import { alpha, type Theme } from '@mui/material/styles/index.js';
import type { SxProps } from '@mui/material/styles/index.js';

import { sxRem } from '../../../tokens/relative';
import type { HeatMapTone } from './HeatMap.types';

/**
 * Each tone as ROLES, never values (a component reads a role). The attention
 * side is `warning` (amber): "getting late", not "failed". The calm side is
 * `info`, deliberately not `primary`: a host whose brand is red would paint
 * every good cell the colour of a fault. No-figure cells take the disabled
 * surface, so they read as "nothing to judge" rather than as either side.
 */
export function toneSx(tone: HeatMapTone, theme: Theme): { backgroundColor: string; color: string } {
  switch (tone) {
    case 'above-strong':
      return { backgroundColor: alpha(theme.palette.warning.main, 0.45), color: theme.palette.warning.dark };
    case 'above':
      return { backgroundColor: alpha(theme.palette.warning.main, 0.22), color: theme.palette.warning.dark };
    case 'below-strong':
      return { backgroundColor: alpha(theme.palette.info.main, 0.24), color: theme.palette.info.dark };
    case 'below':
      return { backgroundColor: alpha(theme.palette.info.main, 0.1), color: theme.palette.info.dark };
    default:
      return { backgroundColor: theme.palette.action.disabledBackground, color: theme.palette.text.disabled };
  }
}

/**
 * `table-layout: fixed` over the full width is what keeps the grid INSIDE its
 * container at every width: the columns share what there is, so the grid never
 * scrolls sideways (a heat map read through a sideways scroll loses its rows'
 * names).
 */
export const tableSx = {
  width: '100%',
  tableLayout: 'fixed',
  borderCollapse: 'separate',
  borderSpacing: sxRem(3),
  fontVariantNumeric: 'tabular-nums',
} satisfies SxProps<Theme>;

export const headerCellSx = {
  p: 0,
  fontSize: sxRem(11),
  fontWeight: 'fontWeightMedium',
  color: 'text.secondary',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
} satisfies SxProps<Theme>;

export const rowHeaderSx = {
  p: 0,
  pr: 0.5,
  fontSize: sxRem(11),
  fontWeight: 'fontWeightMedium',
  color: 'text.secondary',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
} satisfies SxProps<Theme>;

export const valueCellSx = {
  p: 0,
  height: sxRem(30),
  borderRadius: sxRem(4),
  fontSize: sxRem(11),
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
} satisfies SxProps<Theme>;

export const SR_ONLY_SX = {
  position: 'absolute',
  width: sxRem(1),
  height: sxRem(1),
  padding: 0,
  margin: sxRem(-1),
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} satisfies SxProps<Theme>;

export const swatchSx = {
  display: 'inline-block',
  width: sxRem(12),
  height: sxRem(12),
  borderRadius: sxRem(3),
  flexShrink: 0,
} satisfies SxProps<Theme>;
