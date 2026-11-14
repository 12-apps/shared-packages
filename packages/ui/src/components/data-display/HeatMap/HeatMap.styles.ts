import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { sxRem } from '../../../tokens/relative';
import { HEAT_MAP_METRICS as M } from './HeatMap.metrics';

/**
 * `table-layout: fixed` over the full width is what keeps the grid INSIDE its
 * container at every width: the columns share what there is, so the grid never
 * scrolls sideways. That alone could clip a figure, so `heatMapFit` picks the
 * orientation and type step at which every figure fits whole.
 */
export const tableSx = {
  width: '100%',
  tableLayout: 'fixed',
  borderCollapse: 'separate',
  borderSpacing: sxRem(M.gap),
  fontVariantNumeric: 'tabular-nums',
} satisfies SxProps<Theme>;

/** The figures' type step: regular, or compact where the regular cannot fit. */
export function figureSize(compact: boolean): (theme: Theme) => string {
  return sxRem(compact ? M.compactFontSize : M.fontSize);
}

export function headerCellSx(compact: boolean) {
  return {
    p: 0,
    fontSize: figureSize(compact),
    fontWeight: 'fontWeightMedium',
    color: 'text.secondary',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };
}

export function rowHeaderSx(compact: boolean) {
  return {
    p: 0,
    pr: sxRem(4),
    fontSize: figureSize(compact),
    fontWeight: 'fontWeightMedium',
    color: 'text.secondary',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };
}

export function valueCellSx(compact: boolean, transposed: boolean) {
  return {
    p: 0,
    height: sxRem(transposed ? M.cellHeightTransposed : M.cellHeight),
    borderRadius: sxRem(M.radius),
    fontSize: figureSize(compact),
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };
}

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
  width: sxRem(M.swatch),
  height: sxRem(M.swatch),
  borderRadius: sxRem(M.swatchRadius),
  flexShrink: 0,
} satisfies SxProps<Theme>;
