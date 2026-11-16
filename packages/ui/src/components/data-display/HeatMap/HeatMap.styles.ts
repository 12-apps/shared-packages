import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { sxRem } from '../../../tokens/relative';
import { HEAT_MAP_METRICS as M } from './HeatMap.metrics';

/**
 * `table-layout: fixed` over the full width is what keeps the grid INSIDE its
 * container at every width: the columns share what there is, so the grid never
 * scrolls sideways. That alone could clip a figure, so `heatMapFit` picks the
 * orientation and type step at which every figure fits whole.
 */
export function tableSx(dense: boolean) {
  return {
    width: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'separate',
    borderSpacing: sxRem(dense ? M.denseGap : M.gap),
    fontVariantNumeric: 'tabular-nums',
  } satisfies SxProps<Theme>;
}

/** What the type step looks like: regular, compact where regular cannot fit, dense below that. */
export interface FigureStep {
  compact: boolean;
  dense: boolean;
}

/** The figures' type step. */
export function figureSize({ compact, dense }: FigureStep): (theme: Theme) => string {
  if (dense) return sxRem(M.denseFontSize);
  return sxRem(compact ? M.compactFontSize : M.fontSize);
}

export function headerCellSx(step: FigureStep) {
  return {
    p: 0,
    fontSize: figureSize(step),
    fontWeight: 'fontWeightMedium',
    color: 'text.secondary',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    // A dense label is centred on its column and may reach over the columns
    // beside it, whose own labels are not drawn.
    overflow: step.dense ? 'visible' : 'hidden',
    position: 'relative',
    ...(step.dense ? { height: sxRem(M.denseHeaderHeight) } : {}),
  };
}

/** A dense column label, centred on its column whatever its width. */
export const denseLabelSx = {
  position: 'absolute',
  top: 0,
  left: '50%',
  transform: 'translateX(-50%)',
} satisfies SxProps<Theme>;

export function rowHeaderSx(step: FigureStep) {
  return {
    p: 0,
    pr: sxRem(step.dense ? 2 : 4),
    fontSize: figureSize(step),
    fontWeight: 'fontWeightMedium',
    color: 'text.secondary',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

export function valueCellSx(step: FigureStep, transposed: boolean) {
  return {
    p: 0,
    height: sxRem(transposed ? M.cellHeightTransposed : M.cellHeight),
    borderRadius: sxRem(M.radius),
    fontSize: figureSize(step),
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };
}

/**
 * An unmeasured cell (FUT-4063): the same no-figure ground, with a dashed ring
 * inside its edge — the sighted reader's way to tell "not measured" from "no
 * sale", where both show a dash. The legend's swatch carries the same ring.
 */
export const unmeasuredRingSx = {
  outlineStyle: 'dashed',
  outlineWidth: sxRem(M.unmeasuredRing),
  outlineOffset: sxRem(M.unmeasuredRingInset),
  outlineColor: (theme: Theme) => theme.palette.text.secondary,
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
  width: sxRem(M.swatch),
  height: sxRem(M.swatch),
  borderRadius: sxRem(M.swatchRadius),
  flexShrink: 0,
} satisfies SxProps<Theme>;
